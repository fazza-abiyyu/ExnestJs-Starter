import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  PdfEngineError,
  type StreamDocument,
  type DocumentStore,
  type PdfEngineConfig,
} from './types.js';
import { TokenSigner } from './internals/signer.js';
import { SsrfGuard } from './internals/ssrf.js';
import {
  docDir,
  docPagesDir,
  docSourceDir,
  ensureDir,
  pageFileExists,
  pageFilePath,
  removeDir,
  sourceFilePath,
} from './internals/files.js';
import { Rasterizer } from './internals/raster.js';
import { writeStreamToFile } from './internals/fileio.js';
import { renderPreviewHtml } from './preview.js';

const DRIVE_CONFIRM_FIELDS = ['id', 'export', 'confirm', 'uuid'] as const;

function driveConfirmUrl(html: string, baseUrl: string): string | null {
  if (!/<input[^>]*name="confirm"/i.test(html)) return null;
  const action =
    /<form[^>]*id="download-form"[^>]*action="([^"]*)"/i.exec(html)?.[1] ??
    /<form[^>]*action="([^"]*)"/i.exec(html)?.[1];
  if (!action) return null;
  const params = new URLSearchParams();
  for (const match of html.matchAll(
    /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi,
  )) {
    const [, name, value] = match as unknown as [string, string, string];
    if ((DRIVE_CONFIRM_FIELDS as readonly string[]).includes(name)) {
      params.set(name, value);
    }
  }
  if (!params.get('id') || !params.get('confirm')) return null;
  const url = new URL(action, baseUrl);
  for (const [key, value] of params) url.searchParams.set(key, value);
  return url.toString();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'document.pdf';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'document.pdf';
}

export class PdfEngine {
  private readonly config: PdfEngineConfig;
  private readonly store: DocumentStore;
  private readonly signer: TokenSigner;
  private readonly guard: SsrfGuard;
  private readonly rasterizer: Rasterizer;
  private readonly rasterScale: number;

  constructor(config: PdfEngineConfig, store: DocumentStore) {
    this.config = config;
    this.store = store;
    this.signer = new TokenSigner(config.signSecret, config.signTtlSeconds ?? 300);
    this.guard = new SsrfGuard({ blockPrivate: true });
    this.rasterizer = new Rasterizer(
      config.processSlots ?? 1,
      Math.max(30_000, config.proxyTimeoutMs ?? 30_000) * 10,
    );
    this.rasterScale = config.rasterScale ?? 1.5;
  }

  get maxQueue(): number {
    return this.config.maxQueue ?? 5;
  }

  get maxBytes(): number {
    return this.config.maxBytes ?? 50 * 1024 * 1024;
  }

  async start(): Promise<void> {
    await this.resumePending();
  }

  shutdown(): void {
    this.rasterizer.killAll();
  }

  private docRoot(id: string): string {
    return docDir(this.config.storageDir, id);
  }

  private async getRequired(tenantId: string, id: string): Promise<StreamDocument> {
    const doc = await this.store.get(tenantId, id);
    if (!doc) {
      throw new PdfEngineError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }
    return doc;
  }

  private async getRequiredById(id: string): Promise<StreamDocument> {
    const doc = await this.store.getById(id);
    if (!doc) {
      throw new PdfEngineError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }
    return doc;
  }

  issuePageToken(documentId: string, page: number, ttlSeconds?: number): string {
    return this.signer.querySignature(`pdf:${documentId}:${page}`, ttlSeconds);
  }

  signedPageUrl(documentId: string, page: number, baseUrl: string, ttlSeconds?: number): string {
    const base = baseUrl.replace(/\/+$/, '');
    return `${base}/${documentId}/pages/${page}?${this.issuePageToken(documentId, page, ttlSeconds)}`;
  }

  /** The signed page query is `exp` + `sig`; page URLs double as the bearer credential. */
  verifyPage(documentId: string, page: number, query: Record<string, string | undefined>): boolean {
    const resource = `pdf:${documentId}:${page}`;
    const exp = Number(query.exp);
    const sig = query.sig ?? '';
    return this.signer.verify(resource, exp, sig);
  }

  /** Viewer session cookie value: signed `exp.sig` bound to the document. */
  sessionCookie(documentId: string, ttlSeconds?: number): string {
    const { exp, sig } = this.signer.sign(`pdf:session:${documentId}`, ttlSeconds);
    return `${exp}.${sig}`;
  }

  /** Requires a valid, unexpired session cookie for the same document. */
  verifySessionCookie(documentId: string, value: string | undefined): boolean {
    if (!value) return false;
    const idx = value.indexOf('.');
    if (idx <= 0) return false;
    const exp = Number(value.slice(0, idx));
    const sig = value.slice(idx + 1);
    return this.signer.verify(`pdf:session:${documentId}`, exp, sig);
  }

  async ingestFile(input: {
    tenantId: string;
    name?: string;
    fileName: string;
    watermark?: string;
    stream: ReadableStream<Uint8Array> | null;
  }): Promise<StreamDocument> {
    if (!input.stream) {
      throw new PdfEngineError('EMPTY_BODY', 'Request body is required', 400);
    }

    const id = randomUUID();
    const root = this.docRoot(id);
    await ensureDir(docSourceDir(root));

    const fileName = sanitizeFileName(input.fileName);
    const filePath = sourceFilePath(root, fileName);
    await writeStreamToFile(filePath, input.stream, this.maxBytes);

    const doc = await this.store.create({
      id,
      tenantId: input.tenantId,
      name: input.name ?? fileName,
      source: 'FILE',
      fileName,
      filePath,
      watermark: input.watermark ?? null,
    });

    void this.processDocument(doc);

    return (await this.store.get(input.tenantId, id)) ?? doc;
  }

  async ingestUrl(input: {
    tenantId: string;
    name?: string;
    sourceUrl: string;
    watermark?: string;
  }): Promise<StreamDocument> {
    const normalized = this.normalizeSourceUrl(input.sourceUrl);
    await this.guard.assertSafeUrl(normalized);

    const id = randomUUID();
    const doc = await this.store.create({
      id,
      tenantId: input.tenantId,
      name: input.name ?? `drive-${id.slice(0, 8)}.pdf`,
      source: 'DRIVE',
      sourceUrl: normalized,
      watermark: input.watermark ?? null,
    });

    void this.processDocument(doc);
    return doc;
  }

  async status(tenantId: string, id: string): Promise<StreamDocument> {
    return this.getRequired(tenantId, id);
  }

  async list(tenantId: string): Promise<StreamDocument[]> {
    return this.store.list(tenantId);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.getRequired(tenantId, id);
    await this.store.remove(tenantId, id);
    await removeDir(this.docRoot(id));
  }

  async pageSession(
    tenantId: string,
    id: string,
    input: { baseUrl: string; ttlSeconds?: number },
  ): Promise<{ expires_in: number; pages: { page: number; url: string }[] }> {
    const doc = await this.getRequired(tenantId, id);
    if (doc.status !== 'ready') {
      throw new PdfEngineError('DOCUMENT_NOT_READY', 'Document has not been processed yet', 409);
    }

    const ttl = input.ttlSeconds ?? this.config.signTtlSeconds ?? 300;
    const base = input.baseUrl.replace(/\/+$/, '');
    const pages = Array.from({ length: doc.pageCount }, (_, index) => {
      const page = index + 1;
      return { page, url: this.signedPageUrl(doc.id, page, base, ttl) };
    });
    return { expires_in: ttl, pages };
  }

  async pageSessionById(
    id: string,
    input: { baseUrl: string; ttlSeconds?: number },
  ): Promise<{ expires_in: number; pages: { page: number; url: string }[] }> {
    const doc = await this.getRequiredById(id);
    if (doc.status !== 'ready') {
      throw new PdfEngineError('DOCUMENT_NOT_READY', 'Document has not been processed yet', 409);
    }

    const ttl = input.ttlSeconds ?? this.config.signTtlSeconds ?? 300;
    const base = input.baseUrl.replace(/\/+$/, '');
    const pages = Array.from({ length: doc.pageCount }, (_, index) => {
      const page = index + 1;
      return { page, url: this.signedPageUrl(doc.id, page, base, ttl) };
    });
    return { expires_in: ttl, pages };
  }

  async pageImage(id: string, page: number): Promise<Uint8Array> {
    const doc = await this.store.getById(id);
    if (!doc) {
      throw new PdfEngineError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }
    if (doc.status !== 'ready') {
      throw new PdfEngineError('DOCUMENT_NOT_READY', 'Document has not been processed yet', 409);
    }
    if (page < 1 || page > doc.pageCount) {
      throw new PdfEngineError('PAGE_OUT_OF_RANGE', 'Page number is out of range', 400);
    }

    const root = this.docRoot(id);
    const path = pageFilePath(root, page);
    if (!pageFileExists(root, page)) {
      throw new PdfEngineError('PAGE_NOT_RENDERED', 'Page has not been rendered', 409);
    }
    return new Uint8Array(await readFile(path));
  }

  previewHtml(documentId: string, apiBaseUrl: string): string {
    return renderPreviewHtml(documentId, apiBaseUrl);
  }

  async assertPreviewable(documentId: string): Promise<void> {
    const doc = await this.store.getById(documentId);
    if (!doc) {
      throw new PdfEngineError('DOCUMENT_NOT_FOUND', 'Document not found', 404);
    }
    if (doc.status !== 'ready') {
      throw new PdfEngineError('DOCUMENT_NOT_READY', 'Document has not been processed yet', 409);
    }
  }

  async resumePending(): Promise<void> {
    await this.store.resetProcessing();
    const pending = await this.store.findByStatus('pending');
    for (const doc of pending) {
      void this.processDocument(doc);
    }
    const failed = await this.store.findByStatus('processing');
    for (const doc of failed) {
      await this.store.update(doc.id, {
        status: 'failed',
        errorMsg: 'interrupted processing; re-submit to recover',
      });
    }
  }

  private async processDocument(doc: StreamDocument): Promise<void> {
    if (doc.attempt >= 2) return;

    if (this.rasterizer.pending >= this.maxQueue) {
      await this.store.update(doc.id, { status: 'failed', errorMsg: 'processing queue is full' });
      return;
    }

    let attempts = doc.attempt;
    for (;;) {
      attempts++;
      await this.store.update(doc.id, { status: 'processing', attempt: attempts });
      try {
        if (doc.source === 'DRIVE') {
          if (!doc.sourceUrl) throw new PdfEngineError('EMPTY_SOURCE', 'No source URL', 400);
          const downloaded = await this.downloadToStore(doc);
          doc = downloaded;
        }
        if (!doc.filePath) {
          throw new PdfEngineError('EMPTY_SOURCE', 'No local source file', 400);
        }
        const root = this.docRoot(doc.id);
        await ensureDir(docPagesDir(root));
        const { pageCount } = await this.rasterizer.enqueue({
          sourcePath: doc.filePath,
          outDir: docPagesDir(root),
          scale: this.rasterScale,
          watermark: doc.watermark,
        });

        await this.store.update(doc.id, {
          status: 'ready',
          pageCount,
          readyAt: new Date(),
          errorMsg: null,
          attempt: attempts,
        });
        return;
      } catch (err) {
        const lastAttempt = attempts >= 2;
        if (lastAttempt) {
          await this.store.update(doc.id, {
            status: 'failed',
            errorMsg: errorMessage(err),
            attempt: attempts,
          });
          return;
        }
      }
    }
  }

  private async downloadToStore(doc: StreamDocument): Promise<StreamDocument> {
    if (!doc.sourceUrl) throw new PdfEngineError('EMPTY_SOURCE', 'No source URL', 400);

    const { res } = await this.fetchGuarded(doc.sourceUrl, this.config.proxyTimeoutMs ?? 30_000);
    if (!res.body) {
      throw new PdfEngineError('EMPTY_SOURCE', 'Source returned no body', 400);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('text/html') && !contentType.includes('application/pdf')) {
      throw new PdfEngineError('NOT_PDF', 'Google Drive URL does not point to a PDF file', 422);
    }

    const disposition = res.headers.get('content-disposition');
    const dispositionName = disposition
      ? /filename="?([^";]+)"?/i.exec(disposition)?.[1]
      : undefined;
    const fileName = sanitizeFileName(
      dispositionName ?? new URL(doc.sourceUrl).pathname.split('/').pop() ?? 'document.pdf',
    );

    const root = this.docRoot(doc.id);
    await ensureDir(docSourceDir(root));
    const filePath = sourceFilePath(root, fileName);
    const size = await writeStreamToFile(filePath, res.body, this.maxBytes);
    if (size === 0) {
      throw new PdfEngineError('NOT_PDF', 'Downloaded file is empty', 422);
    }

    const updated = await this.store.update(doc.id, {
      fileName,
      filePath,
      sourceUrl: doc.sourceUrl,
    });
    return updated;
  }

  private async fetchGuarded(
    rawUrl: string,
    timeoutMs: number,
    headers: Record<string, string> = {},
  ): Promise<{ res: Response; finalUrl: string }> {
    let current = rawUrl;
    const maxRedirects = 8;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      await this.guard.assertSafeUrl(current);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(current, { redirect: 'manual', signal: controller.signal, headers });
      } finally {
        clearTimeout(timer);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          throw new PdfEngineError('REDIRECT', 'Redirect without location header', 400);
        }
        current = new URL(location, current).toString();
        continue;
      }
      if (res.status === 200 && (res.headers.get('content-type') ?? '').includes('text/html')) {
        const html = await res.text();
        const retained = new Response(html, { status: res.status, headers: res.headers });
        const confirmed = driveConfirmUrl(html, current);
        if (confirmed) {
          current = confirmed;
          continue;
        }
        return { res: retained, finalUrl: current };
      }
      return { res, finalUrl: current };
    }
    throw new PdfEngineError('REDIRECT', 'Too many redirects', 400);
  }

  private normalizeSourceUrl(rawUrl: string): string {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return rawUrl;
    }
    const host = url.hostname.toLowerCase();
    if (host !== 'drive.google.com' && host !== 'docs.google.com') {
      return rawUrl;
    }
    const match = /(?:\/file\/d\/|\/open\?id=|\/uc\?id=|\bid=)([0-9A-Za-z_-]{12,})/i.exec(url.href);
    if (!match?.[1]) return rawUrl;
    const direct = new URL('https://drive.usercontent.google.com/download');
    direct.searchParams.set('id', match[1]);
    direct.searchParams.set('export', 'download');
    return direct.toString();
  }
}
