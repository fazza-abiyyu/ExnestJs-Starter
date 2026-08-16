import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  PdfEngine,
  type StreamDocument,
  type StreamDocumentCreateInput,
  type StreamDocumentUpdatePatch,
  type DocumentStore,
  type PdfStatus,
} from './index.js';
import { mountPdfEngine } from './elysia.js';

class MemoryStore implements DocumentStore {
  private rows = new Map<string, StreamDocument>();

  async create(input: StreamDocumentCreateInput): Promise<StreamDocument> {
    const doc: StreamDocument = {
      id: input.id,
      tenantId: input.tenantId,
      name: input.name,
      source: input.source,
      sourceUrl: input.sourceUrl ?? null,
      fileName: input.fileName ?? null,
      filePath: input.filePath ?? null,
      watermark: input.watermark ?? null,
      pageCount: 0,
      status: 'pending',
      attempt: 0,
      readyAt: null,
      errorMsg: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(doc.id, doc);
    return doc;
  }

  async get(tenantId: string, id: string): Promise<StreamDocument | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async getById(id: string): Promise<StreamDocument | null> {
    return this.rows.get(id) ?? null;
  }

  async list(tenantId: string): Promise<StreamDocument[]> {
    return [...this.rows.values()].filter((d) => d.tenantId === tenantId);
  }

  async update(id: string, patch: StreamDocumentUpdatePatch): Promise<StreamDocument> {
    const current = this.rows.get(id);
    if (!current) throw new Error('missing');
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return next;
  }

  async findByStatus(status: PdfStatus): Promise<StreamDocument[]> {
    return [...this.rows.values()].filter((d) => d.status === status);
  }

  async resetProcessing(): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.status === 'processing') this.rows.set(id, { ...row, status: 'pending' });
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.tenantId === tenantId) this.rows.delete(id);
  }

  upsert(doc: StreamDocument): void {
    this.rows.set(doc.id, doc);
  }
}

async function makePdf(path: string): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const page = doc.addPage();
    page.drawText(`Doc Page ${i}`, { x: 100, y: 700, font, size: 24 });
  }
  writeFileSync(path, await doc.save());
}

describe('pdf-engine e2e (HTTP layer, MemoryStore)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-engine-e2e-'));
  const store = new MemoryStore();

  const docId = 'doc1';
  const docRoot = join(dir, 'docs', docId);
  const sourceDir = join(docRoot, 'source');
  const pagesDir = join(docRoot, 'pages');

  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(join(sourceDir, 'doc.pdf'), 'PDF-CONTENT');
  writeFileSync(join(pagesDir, 'page-1.png'), pngBytes);
  writeFileSync(join(pagesDir, 'page-2.png'), pngBytes);

  store.upsert({
    id: docId,
    tenantId: 'default-tenant',
    name: 'doc.pdf',
    source: 'FILE',
    sourceUrl: null,
    fileName: 'doc.pdf',
    filePath: join(sourceDir, 'doc.pdf'),
    watermark: null,
    pageCount: 2,
    status: 'ready',
    attempt: 1,
    readyAt: new Date(),
    errorMsg: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const engine = new PdfEngine(
    { storageDir: dir, signSecret: 'test-secret', signTtlSeconds: 300 },
    store,
  );

  const app = new Elysia() as unknown as Elysia;
  mountPdfEngine(app, { engine, apiKey: '' });

  const base = 'http://localhost/api/v1/documents';

  test('OPTIONS returns CORS preflight', async () => {
    const res = await app.handle(new Request(base, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('preview renders the protected viewer HTML', async () => {
    const res = await app.handle(new Request(`${base}/doc1/preview`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('doc1');
    expect(body).toContain('session');
  });

  test('session issues signed page URLs and the viewer cookie', async () => {
    const res = await app.handle(
      new Request(`${base}/doc1/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('pdf_session=');
    const body = (await res.json()) as { value: { pages: { page: number; url: string }[] } };
    expect(body.value.pages).toHaveLength(2);
    expect(body.value.pages[0].url).toContain('/pages/1?exp=');
  });

  test('pages are 403 without the viewer session cookie', async () => {
    const session = await app.handle(
      new Request(`${base}/doc1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const body = (await session.json()) as { value: { pages: { url: string }[] } };
    const url = body.value.pages[0].url;
    const res = await app.handle(new Request(url));
    expect(res.status).toBe(403);
  });

  test('pages serve PNG with the cookie', async () => {
    const session = await app.handle(
      new Request(`${base}/doc1/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const cookie = (session.headers.get('set-cookie') ?? '').split(';')[0];
    const body = (await session.json()) as { value: { pages: { url: string }[] } };
    const res = await app.handle(
      new Request(body.value.pages[1].url, { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test('URL ingest to a private address is blocked', async () => {
    const res = await app.handle(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl: 'http://127.0.0.1:1/file.pdf' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  test('file upload rasterizes a real PDF and marks it ready', async () => {
    const pdfPath = join(dir, 'upload-me.pdf');
    await makePdf(pdfPath);
    const pdfBytes = await Bun.file(pdfPath).arrayBuffer();

    const boundary = '----pdf-engine-e2e';
    const pdfArr = new Uint8Array(pdfBytes);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.docs"\r\nContent-Type: application/pdf\r\n\r\n`,
    );
    const trailer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = new Uint8Array(head.length + pdfArr.length + trailer.length);
    body.set(new Uint8Array(head), 0);
    body.set(pdfArr, head.length);
    body.set(new Uint8Array(trailer), head.length + pdfArr.length);

    const res = await app.handle(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-file-name': 'upload.e2e' },
        body,
      }),
    );
    expect(res.status).toBe(201);
    const bodyJson = (await res.json()) as { value: { status: string; id: string; source: string } };
    expect(bodyJson.value.source).toBe('FILE');

    await new Promise((r) => setTimeout(r, 4000));
    const all = await store.findByStatus('ready');
    const final = all.find((d) => d.id === bodyJson.value.id);
    expect(final?.status).toBe('ready');
    expect(final?.pageCount).toBe(2);
    expect(existsSync(join(dir, 'docs', bodyJson.value.id, 'pages', 'page-1.png'))).toBe(true);
  });

  test('remove cleans up record and folder', async () => {
    const res = await app.handle(
      new Request(`${base}/doc1`, { method: 'DELETE', headers: { 'x-tenant-id': 'default-tenant' } }),
    );
    expect(res.status).toBe(204);
    expect(existsSync(docRoot)).toBe(false);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});