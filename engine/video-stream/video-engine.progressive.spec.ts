import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  Packager,
  RENDITIONS_3,
  VideoStreamEngine,
  type Video,
  type VideoCreateInput,
  type VideoStore,
  type VideoUpdatePatch,
} from './index.js';

function fakeFfmpegScript(dir: string): string {
  const path = join(dir, 'fakeffmpeg');
  const script = `#!/bin/sh
cat > /dev/null
mkdir -p 0
printf '#EXTM3U\\n#EXT-X-VERSION:3\\n#EXTINF:4.0,\\nsegment_00000.ts\\n' > 0/index.m3u8
printf 'PIPE-SEGMENT-CONTENT' > 0/segment_00000.ts
exit 0
`;
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

function payloadStream(chunks: string[]): ReadableStream<Uint8Array> {
  const node = Readable.from(chunks.map((c) => Buffer.from(c)));
  return Readable.toWeb(node) as unknown as ReadableStream<Uint8Array>;
}

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

describe('video-engine progressive (stream-into-ffmpeg)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-engine-progressive-'));
  const bin = fakeFfmpegScript(dir);

  test('packager swallows a stdin stream and publishes HLS files', async () => {
    const hls = join(dir, 'job1');
    mkdirSync(join(hls, '0'), { recursive: true });
    const packager = new Packager(1);
    await packager.enqueue({
      hlsDir: hls,
      ffmpegBin: bin,
      renditions: RENDITIONS_3,
      stdin: payloadStream(['CHUNK-A-', 'CHUNK-B-', 'CHUNK-C']),
      maxBytes: 1_000_000,
    });
    expect(existsSync(join(hls, '0', 'index.m3u8'))).toBe(true);
    expect(readFileSync(join(hls, '0', 'index.m3u8'), 'utf8')).toContain('segment_00000.ts');
    expect(readFileSync(join(hls, '0', 'segment_00000.ts'), 'utf8')).toBe('PIPE-SEGMENT-CONTENT');
  });

  test('packager rejects when the stream exceeds maxBytes', async () => {
    const hls = join(dir, 'job2');
    mkdirSync(join(hls, '0'), { recursive: true });
    const packager = new Packager(1);
    expect(
      packager.enqueue({
        hlsDir: hls,
        ffmpegBin: bin,
        renditions: RENDITIONS_3,
        stdin: payloadStream(['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA']),
        maxBytes: 4,
      }),
    ).rejects.toThrow(/exceeds/);
  });

  test('engine serves mid-stream HLS while a URL is processing (progressive on)', async () => {
    const store = new MemoryStore();
    const videoRoot = join(dir, 'videos', 'p1');
    const hls = join(videoRoot, 'hls', '0');
    mkdirSync(hls, { recursive: true });
    writeFileSync(join(hls, 'index.m3u8'), '#EXTM3U\nsegment_00000.ts\n');
    writeFileSync(join(hls, 'segment_00000.ts'), 'EARLY-SEGMENT');
    store.upsert({
      id: 'p1',
      tenantId: 'default-tenant',
      title: 'https://example.com/clip.mp4',
      source: 'URL',
      sourceUrl: 'https://example.com/clip.mp4',
      fileName: null,
      filePath: null,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      status: 'processing',
      attempt: 1,
      hlsReady: false,
      readyAt: null,
      errorMsg: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const engine = new VideoStreamEngine(
      { storageDir: dir, signSecret: 's', ffmpegBin: bin, progressive: true },
      store,
    );

    const master = await engine.manifest('default-tenant', 'p1');
    expect(master).toContain('0/index.m3u8');

    const playlist = await engine.segment('default-tenant', 'p1', '0/index.m3u8', {});
    expect(playlist.status).toBe(200);
    expect(await playlist.text()).toContain('segment_00000.ts');

    const seg = await engine.segment('default-tenant', 'p1', '0/segment_00000.ts', {});
    expect(seg.status).toBe(200);
    expect(await seg.text()).toBe('EARLY-SEGMENT');
  });

  test('progressive off keeps the hard 409 until packaged', async () => {
    const store = new MemoryStore();
    const videoRoot = join(dir, 'videos', 'p2');
    const hls = join(videoRoot, 'hls', '0');
    mkdirSync(hls, { recursive: true });
    writeFileSync(join(hls, 'index.m3u8'), '#EXTM3U\nsegment_00000.ts\n');
    store.upsert({
      id: 'p2',
      tenantId: 'default-tenant',
      title: 'x',
      source: 'URL',
      sourceUrl: 'https://example.com/c.mp4',
      fileName: null,
      filePath: null,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      status: 'processing',
      attempt: 1,
      hlsReady: false,
      readyAt: null,
      errorMsg: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const engine = new VideoStreamEngine(
      { storageDir: dir, signSecret: 's', ffmpegBin: bin },
      store,
    );

    expect(engine.manifest('default-tenant', 'p2')).rejects.toMatchObject({
      code: 'VIDEO_NOT_READY',
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});