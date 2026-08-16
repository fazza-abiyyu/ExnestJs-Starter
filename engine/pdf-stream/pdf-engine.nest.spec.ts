import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  PdfEngine,
  type StreamDocument,
  type StreamDocumentCreateInput,
  type StreamDocumentUpdatePatch,
  type DocumentStore,
  type PdfStatus,
} from './index.js';
import { createPdfEngineController } from './nest.js';

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

function nodeStreamReq(opts: {
  url: string;
  headers: Record<string, string>;
  payload?: string;
}): Readable {
  const req = Readable.from(opts.payload ?? '');
  const raw = req as unknown as {
    headers: Record<string, string>;
    url: string;
    params: Record<string, string>;
    query: Record<string, string>;
  };
  raw.headers = opts.headers;
  raw.url = opts.url;
  raw.params = {};
  raw.query = {};
  return req;
}

class FakeRes extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(key: string, value: string): this {
    this.headers[key.toLowerCase()] = value;
    return this;
  }

  send(payload: unknown): this {
    this.chunks.push(Buffer.from(payload == null ? '' : String(payload)));
    this.end();
    return this;
  }

  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    cb();
  }
}

const text = (res: FakeRes): string => Buffer.concat(res.chunks).toString('utf8');

describe('pdf-engine nest adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-engine-nest-'));
  const store = new MemoryStore();

  const docRoot = join(dir, 'docs', 'doc1');
  const sourceDir = join(docRoot, 'source');
  const pagesDir = join(docRoot, 'pages');
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(pagesDir, { recursive: true });
  writeFileSync(join(sourceDir, 'doc.pdf'), 'PDF-CONTENT');
  writeFileSync(join(pagesDir, 'page-1.png'), pngBytes);

  store.upsert({
    id: 'doc1',
    tenantId: 'default-tenant',
    name: 'doc.pdf',
    source: 'FILE',
    sourceUrl: null,
    fileName: 'doc.pdf',
    filePath: join(sourceDir, 'doc.pdf'),
    watermark: null,
    pageCount: 1,
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

  const Controller = createPdfEngineController({ engine, apiKey: 'secret' });
  const ctrl = new Controller() as {
    create(req: unknown, res: FakeRes, body?: unknown): Promise<void>;
    remove(req: unknown, res: FakeRes, id: string): Promise<void>;
    session(req: unknown, res: FakeRes, id: string, body?: unknown): Promise<void>;
    page(req: unknown, res: FakeRes, id: string, page: string): Promise<void>;
    preview(req: unknown, res: FakeRes, id: string): Promise<void>;
    preflight(res: FakeRes): void;
  };
  const base = '/api/v1/documents';
  const auth = { 'x-api-key': 'secret', 'x-tenant-id': 'default-tenant' };

  test('preflight OPTIONS returns CORS 204', () => {
    const res = new FakeRes();
    ctrl.preflight(res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('preview renders the protected viewer HTML', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: `${base}/doc1/preview`, headers: {} });
    await ctrl.preview(req, res, 'doc1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(text(res)).toContain('doc1');
  });

  test('session issues signed page URLs and sets the viewer cookie', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: `${base}/doc1/session`, headers: {} });
    await ctrl.session(req, res, 'doc1', {});
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toContain('pdf_session=');
    const body = JSON.parse(text(res)) as { value: { pages: { url: string }[] } };
    expect(body.value.pages[0].url).toContain('/pages/1?exp=');
  });

  test('page is 403 without the viewer cookie', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({
      url: `${base}/doc1/pages/1?exp=0&sig=x`,
      headers: {},
      params: undefined as never,
    } as never) as unknown as {
      params: Record<string, string>;
      query: Record<string, string>;
      headers: Record<string, string>;
    };
    req.params = { id: 'doc1', page: '1' };
    req.query = { exp: '0', sig: 'x' };
    await (ctrl as never as { page(req: unknown, res: FakeRes, id: string, page: string): Promise<void> }).page(
      req,
      res,
      'doc1',
      '1',
    );
    expect(res.statusCode).toBe(403);
  });

  test('page serves PNG with a valid session cookie', async () => {
    const cookieJar = new FakeRes();
    const cookieReq = nodeStreamReq({ url: `${base}/doc1/session`, headers: {} }) as unknown as {
      params: Record<string, string>;
    };
    cookieReq.params = { id: 'doc1' };
    await ctrl.session(cookieReq, cookieJar, 'doc1', {});
    const cookie = (cookieJar.headers['set-cookie'] ?? '').split(';')[0];
    const body = JSON.parse(text(cookieJar)) as { value: { pages: { url: string }[] } };
    const pageUrl = new URL(body.value.pages[0].url);

    const res = new FakeRes();
    const req = nodeStreamReq({ url: pageUrl.pathname, headers: { cookie } }) as unknown as {
      params: Record<string, string>;
      query: Record<string, string>;
    };
    req.params = { id: 'doc1', page: '1' };
    req.query = { exp: pageUrl.searchParams.get('exp')!, sig: pageUrl.searchParams.get('sig')! };
    await ctrl.page(req, res, 'doc1', '1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
  });

  test('URL ingest to a private address is blocked', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: base, headers: { ...auth, 'content-type': 'application/json' } });
    await ctrl.create(req, res, { sourceUrl: 'http://127.0.0.1:1/file.pdf' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(text(res)) as { error: { code: string } };
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  test('file upload backfills store record to ready', async () => {
    const payload = 'PDF-CONTENT-0123456789';
    const req = nodeStreamReq({
      url: base,
      headers: { ...auth, 'content-type': 'application/pdf', 'x-file-name': 'clip.pdf' },
      payload,
    });
    const res = new FakeRes();
    await ctrl.create(req, res);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(text(res)) as { value: { status: string; id: string } };
    expect(body.value.id).toBeTruthy();
    expect(await store.getById(body.value.id)).not.toBeNull();
  });

  test('DELETE removes the document', async () => {
    const res = new FakeRes();
    await ctrl.remove(nodeStreamReq({ url: `${base}/doc1`, headers: auth }), res, 'doc1');
    expect(res.statusCode).toBe(204);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});