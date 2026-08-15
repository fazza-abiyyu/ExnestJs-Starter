import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import {
  VideoStreamEngine,
  createVideoEngineController,
  type Video,
  type VideoCreateInput,
  type VideoStore,
  type VideoUpdatePatch,
} from './index.js';

class MemoryStore implements VideoStore {
  private rows = new Map<string, Video>();

  async create(input: VideoCreateInput): Promise<Video> {
    const video: Video = {
      ...input,
      sourceUrl: input.sourceUrl ?? null,
      fileName: input.fileName ?? null,
      filePath: input.filePath ?? null,
      status: 'pending',
      attempt: 0,
      hlsReady: false,
      readyAt: null,
      errorMsg: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(video.id, video);
    return video;
  }

  async get(tenantId: string, id: string): Promise<Video | null> {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async list(tenantId: string): Promise<Video[]> {
    return [...this.rows.values()].filter((v) => v.tenantId === tenantId);
  }

  async update(id: string, patch: VideoUpdatePatch): Promise<Video> {
    const current = this.rows.get(id);
    if (!current) throw new Error('missing');
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.rows.set(id, next);
    return next;
  }

  async findByStatus(status: Video['status']): Promise<Video[]> {
    return [...this.rows.values()].filter((v) => v.status === status);
  }

  async resetProcessing(): Promise<void> {
    for (const [id, row] of this.rows) {
      if (row.status === 'processing') this.rows.set(id, { ...row, status: 'pending' });
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    this.rows.delete(id);
  }

  upsert(video: Video): void {
    this.rows.set(video.id, video);
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
  sent: unknown = null;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(key: string, value: string): this {
    this.headers[key.toLowerCase()] = value;
    return this;
  }

  send(payload: unknown): this {
    this.sent = payload;
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

describe('video-engine nest adapter', () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-engine-nest-'));
  const store = new MemoryStore();

  const videoDir = join(dir, 'videos', 'vid1');
  const sourceDir = join(videoDir, 'source');
  const hlsDir = join(videoDir, 'hls', '0');
  const sourceContent = 'TS-PAYLOAD-FOR-SEGMENT';
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(hlsDir, { recursive: true });
  writeFileSync(join(sourceDir, 'v.mp4'), sourceContent);
  writeFileSync(
    join(hlsDir, 'index.m3u8'),
    '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:4.0,\nsegment_00000.ts\n',
  );
  writeFileSync(join(hlsDir, 'segment_00000.ts'), sourceContent);

  store.upsert({
    id: 'vid1',
    tenantId: 'default-tenant',
    title: 'intros',
    source: 'FILE',
    sourceUrl: null,
    fileName: 'v.mp4',
    filePath: join(sourceDir, 'v.mp4'),
    mimeType: 'video/mp4',
    sizeBytes: Buffer.byteLength(sourceContent),
    status: 'ready',
    attempt: 1,
    hlsReady: true,
    readyAt: new Date(),
    errorMsg: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const engine = new VideoStreamEngine(
    { storageDir: dir, signSecret: 'test-secret', signTtlSeconds: 1800, ffmpegBin: 'ffmpeg' },
    store,
  );

  const Controller = createVideoEngineController({ engine, apiKey: 'secret' });
  const ctrl = new Controller() as {
    create(req: unknown, res: FakeRes, body?: unknown): Promise<void>;
    update(req: unknown, res: FakeRes, id: string, body?: unknown): Promise<void>;
    remove(req: unknown, res: FakeRes, id: string): Promise<void>;
    master(req: unknown, res: FakeRes, id: string): Promise<void>;
    segment(req: unknown, res: FakeRes, id: string): Promise<void>;
    raw(req: unknown, res: FakeRes, id: string): Promise<void>;
    preflight(res: FakeRes): void;
  };
  const base = '/api/v1/videos';
  const auth = { 'x-api-key': 'secret', 'x-tenant-id': 'default-tenant' };

  test('preflight OPTIONS returns CORS 204', () => {
    const res = new FakeRes();
    ctrl.preflight(res);
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  test('master.m3u8 issues the stream cookie', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: `${base}/vid1/stream/master.m3u8`, headers: {} });
    await ctrl.master(req, res, 'vid1');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('mpegurl');
    expect(res.headers['set-cookie']).toContain('vstream=');
    expect(text(res)).toContain('0/index.m3u8');
    expect(text(res)).toContain('BANDWIDTH=');
  });

  test('segments are 403 without the token', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: `${base}/vid1/stream/0/segment_00000.ts`, headers: {} });
    await ctrl.segment(req, res, 'vid1');
    expect(res.statusCode).toBe(403);
    const body = JSON.parse(text(res)) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  test('segments stream with the cookie', async () => {
    const master = new FakeRes();
    await ctrl.master(nodeStreamReq({ url: `${base}/vid1/stream/master.m3u8`, headers: {} }), master, 'vid1');
    const cookie = (master.headers['set-cookie'] ?? '').split(';')[0];

    const playlist = new FakeRes();
    await ctrl.segment(
      nodeStreamReq({ url: `${base}/vid1/stream/0/index.m3u8`, headers: { cookie } }),
      playlist,
      'vid1',
    );
    expect(playlist.statusCode).toBe(200);
    expect(text(playlist)).toContain('segment_00000.ts');

    const seg = new FakeRes();
    await ctrl.segment(
      nodeStreamReq({ url: `${base}/vid1/stream/0/segment_00000.ts`, headers: { cookie } }),
      seg,
      'vid1',
    );
    expect(seg.statusCode).toBe(200);
    expect(text(seg)).toBe(sourceContent);
  });

  test('raw supports Range', async () => {
    const master = new FakeRes();
    await ctrl.master(nodeStreamReq({ url: `${base}/vid1/stream/master.m3u8`, headers: {} }), master, 'vid1');
    const cookie = (master.headers['set-cookie'] ?? '').split(';')[0];
    const res = new FakeRes();
    await ctrl.raw(
      nodeStreamReq({ url: `${base}/vid1/raw`, headers: { cookie, range: 'bytes=0-4' } }),
      res,
      'vid1',
    );
    expect(res.statusCode).toBe(206);
    expect(text(res)).toBe('TS-PA');
  });

  test('URL ingest to a private address is blocked', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: base, headers: { ...auth, 'content-type': 'application/json' } });
    await ctrl.create(req, res, { sourceUrl: 'http://127.0.0.1:1/v.mp4' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(text(res)) as { error: { code: string } };
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  test('file upload persists and is ready (raw fallback)', async () => {
    const payload = 'UPLOAD-CONTENT-0123456789';
    const req = nodeStreamReq({
      url: base,
      headers: { ...auth, 'content-type': 'video/mp4', 'x-file-name': 'clip.mp4' },
      payload,
    });
    const res = new FakeRes();
    await ctrl.create(req, res);
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(text(res)) as { value: { status: string; id: string } };
    expect(body.value.status).toBe('ready');
    expect(existsSync(join(dir, 'videos', body.value.id, 'source', 'clip.mp4'))).toBe(true);
  });

  test('PATCH updates the title', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: `${base}/vid1`, headers: { ...auth, 'content-type': 'application/json' } });
    await ctrl.update(req, res, 'vid1', { title: 'Renamed Intro' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(text(res)) as { value: { title: string } };
    expect(body.value.title).toBe('Renamed Intro');
  });

  test('PATCH rejects an empty title', async () => {
    const res = new FakeRes();
    const req = nodeStreamReq({ url: `${base}/vid1`, headers: { ...auth, 'content-type': 'application/json' } });
    await ctrl.update(req, res, 'vid1', { title: '   ' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(text(res)) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('DELETE removes the video', async () => {
    const res = new FakeRes();
    await ctrl.remove(nodeStreamReq({ url: `${base}/vid1`, headers: auth }), res, 'vid1');
    expect(res.statusCode).toBe(204);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});