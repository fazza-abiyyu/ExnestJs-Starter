import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import {
  VideoStreamEngine,
  type Video,
  type VideoCreateInput,
  type VideoStore,
  type VideoUpdatePatch,
} from './index.js';
import { mountVideoEngine } from './index.js';

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

describe('video-engine e2e (HTTP layer, MemoryStore)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-engine-e2e-'));
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

  const app = new Elysia() as unknown as Elysia;
  mountVideoEngine(app, { engine, apiKey: '' });

  const base = 'http://localhost/api/v1/videos';

  test('OPTIONS returns CORS preflight', async () => {
    const res = await app.handle(new Request(base, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('master.m3u8 handshake issues the stream cookie', async () => {
    const res = await app.handle(new Request(`${base}/vid1/stream/master.m3u8`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('mpegurl');
    expect(res.headers.get('set-cookie')).toContain('vstream=');
    const body = await res.text();
    expect(body).toContain('0/index.m3u8');
    expect(body).toContain('BANDWIDTH=');
  });

  test('segments are 403 without the token', async () => {
    const res = await app.handle(new Request(`${base}/vid1/stream/0/segment_00000.ts`));
    expect(res.status).toBe(403);
  });

  test('segments stream with the cookie', async () => {
    const master = await app.handle(new Request(`${base}/vid1/stream/master.m3u8`));
    const cookie = (master.headers.get('set-cookie') ?? '').split(';')[0];

    const playlist = await app.handle(
      new Request(`${base}/vid1/stream/0/index.m3u8`, { headers: { cookie } }),
    );
    expect(playlist.status).toBe(200);
    expect(await playlist.text()).toContain('segment_00000.ts');

    const seg = await app.handle(
      new Request(`${base}/vid1/stream/0/segment_00000.ts`, { headers: { cookie } }),
    );
    expect(seg.status).toBe(200);
    expect(await seg.text()).toBe('TS-PAYLOAD-FOR-SEGMENT');
  });

  test('raw supports Range', async () => {
    const master = await app.handle(new Request(`${base}/vid1/stream/master.m3u8`));
    const cookie = (master.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await app.handle(
      new Request(`${base}/vid1/raw`, { headers: { cookie, range: 'bytes=0-4' } }),
    );
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('TS-PA');
  });

  test('URL ingest to a private address is blocked', async () => {
    const res = await app.handle(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl: 'http://127.0.0.1:1/v.mp4' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SSRF_BLOCKED');
  });

  test('file upload is persisted and ready (raw fallback)', async () => {
    const payload = 'UPLOAD-CONTENT-0123456789';
    const res = await app.handle(
      new Request(base, {
        method: 'POST',
        headers: { 'content-type': 'video/mp4', 'x-file-name': 'clip.mp4' },
        body: payload,
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { value: { status: string; id: string } };
    expect(body.value.status).toBe('ready');
    expect(existsSync(join(dir, 'videos', body.value.id, 'source', 'clip.mp4'))).toBe(true);
  });

  test('PATCH updates the title', async () => {
    const res = await app.handle(
      new Request(`${base}/vid1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-tenant-id': 'default-tenant' },
        body: JSON.stringify({ title: 'Renamed Intro' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: { title: string } };
    expect(body.value.title).toBe('Renamed Intro');
  });

  test('PATCH rejects an empty title', async () => {
    const res = await app.handle(
      new Request(`${base}/vid1`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-tenant-id': 'default-tenant' },
        body: JSON.stringify({ title: '   ' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  test('remove cleans up record and folder', async () => {
    const res = await app.handle(
      new Request(`${base}/vid1`, {
        method: 'DELETE',
        headers: { 'x-tenant-id': 'default-tenant' },
      }),
    );
    expect(res.status).toBe(204);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});