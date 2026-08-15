import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VideoStreamEngine,
  isYouTubeUrl,
  type Video,
  type VideoCreateInput,
  type VideoStore,
  type VideoUpdatePatch,
} from './index.js';

function fakeYtdlp(dir: string): string {
  const path = join(dir, 'fake-yt-dlp');
  writeFileSync(
    path,
    '#!/bin/sh\nprintf "Fake YT Title\\nhttps://example.com/v.mp4\\n"\nexit 0\n',
    { mode: 0o755 },
  );
  return path;
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

describe('video-engine youtube support', () => {
  const dir = mkdtempSync(join(tmpdir(), 'video-engine-youtube-'));

  test('isYouTubeUrl detects youtube links', () => {
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isYouTubeUrl('https://drive.google.com/file/d/abc')).toBe(false);
    expect(isYouTubeUrl('not a url')).toBe(false);
  });

  test('youtube ingest without a resolver fails clearly', async () => {
    const store = new MemoryStore();
    const engine = new VideoStreamEngine({ storageDir: dir, signSecret: 's' }, store);
    await engine.start();
    expect(engine.ingestUrl({ tenantId: 't', sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })).rejects.toMatchObject(
      { code: 'YOUTUBE_UNAVAILABLE' },
    );
  });

  test('youtube ingest resolves to a direct URL and adopts the title', async () => {
    const store = new MemoryStore();
    const engine = new VideoStreamEngine(
      { storageDir: dir, signSecret: 's', youtubeBin: fakeYtdlp(dir) },
      store,
    );
    await engine.start();

    const video = await engine.ingestUrl({
      tenantId: 't',
      sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(video.sourceUrl).toBe('https://example.com/v.mp4');
    expect(video.title).toBe('Fake YT Title');
    expect(video.status).toBe('ready');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
});