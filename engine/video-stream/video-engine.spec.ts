import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VideoStreamEngine } from './engine.js';
import {
  VideoEngineError,
  type Video,
  type VideoCreateInput,
  type VideoStore,
  type VideoUpdatePatch,
} from './types.js';
import { parseRange } from './internals/range.js';
import { TokenSigner } from './internals/signer.js';
import { isPrivateAddress } from './internals/ssrf.js';
import { resolveInside } from './internals/files.js';

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
}

describe('range parser', () => {
  it('returns no-range when header is absent', () => {
    expect(parseRange(undefined, 1000).status).toBe('no-range');
  });

  it('parses a bounded range', () => {
    const r = parseRange('bytes=0-499', 1000);
    expect(r).toEqual({ status: 'ok', range: { start: 0, end: 499 } });
  });

  it('parses an open-ended range', () => {
    const r = parseRange('bytes=100-', 1000);
    expect(r).toEqual({ status: 'ok', range: { start: 100, end: 999 } });
  });

  it('parses a suffix range', () => {
    const r = parseRange('bytes=-50', 1000);
    expect(r).toEqual({ status: 'ok', range: { start: 950, end: 999 } });
  });

  it('marks unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', 1000).status).toBe('unsatisfiable');
    expect(parseRange('bytes=chunk', 1000).status).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 1000).status).toBe('unsatisfiable');
    expect(parseRange('bytes=', 1000).status).toBe('unsatisfiable');
  });
});

describe('token signer', () => {
  const signer = new TokenSigner('secret', 100);

  it('round-trips a cookie value', () => {
    const cookie = signer.cookieValue('vstream:abc');
    expect(signer.verifyCookie('vstream:abc', cookie)).toBe(true);
  });

  it('rejects a token bound to another resource', () => {
    const cookie = signer.cookieValue('vstream:abc');
    expect(signer.verifyCookie('vstream:other', cookie)).toBe(false);
  });

  it('rejects an expired token', () => {
    const { exp, sig } = signer.sign('vstream:abc');
    expect(signer.verify('vstream:abc', exp, sig, exp + 1000)).toBe(false);
  });

  it('rejects a tampered token', () => {
    const { exp, sig } = signer.sign('vstream:abc');
    const flipped = (sig[0] === 'a' ? 'b' : 'a') + sig.slice(1);
    expect(signer.verify('vstream:abc', exp, flipped)).toBe(false);
  });
});

describe('ssrf guard', () => {
  it('flags private and link-local addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.169.254')).toBe(true);
    expect(isPrivateAddress('0.0.0.0')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('fd00::1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('path guard', () => {
  it('rejects traversal', () => {
    expect(() => resolveInside('/data/videos/a', '..')).toThrow(VideoEngineError);
    expect(() => resolveInside('/data/videos/a', 'x/../../etc')).toThrow(VideoEngineError);
  });

  it('resolves inside the root', () => {
    expect(resolveInside('/data/videos/a', '0', 'index.m3u8')).toBe('/data/videos/a/0/index.m3u8');
  });
});

describe('video engine', () => {
  it('ingests a file and serves raw ranges', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-engine-'));
    const engine = new VideoStreamEngine(
      { storageDir: dir, signSecret: 'secret', ffmpegBin: 'ffmpeg' },
      new MemoryStore(),
    );

    const bytes = new TextEncoder().encode('HELLOVIDEODATA-0123456789');
    const video = await engine.ingestFile({
      tenantId: 't1',
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      stream: new Blob([bytes]).stream(),
    });

    expect(video.status).toBe('ready');
    expect(video.hlsReady).toBe(false);

    const partial = await engine.raw('t1', video.id, 'bytes=0-4');
    expect(partial.status).toBe(206);
    expect(await new Response(partial.body).text()).toBe('HELLO');

    const full = await engine.raw('t1', video.id);
    expect(full.status).toBe(200);
    expect(await new Response(full.body).text()).toBe('HELLOVIDEODATA-0123456789');

    const outOfRange = await engine.raw('t1', video.id, 'bytes=999-1000');
    expect(outOfRange.status).toBe(416);
    expect(outOfRange.headers.get('Content-Range')).toBe('bytes */25');

    rmSync(dir, { recursive: true, force: true });
  });

  it('enforces stream access control', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-engine-access-'));
    const engine = new VideoStreamEngine(
      { storageDir: dir, signSecret: 'secret' },
      new MemoryStore(),
    );

    expect(engine.verifyAccess('v1', {}, {})).toBe(false);
    const cookie = engine.issueAccessCookie('v1');
    expect(engine.verifyAccess('v1', { vstream: cookie }, {})).toBe(true);

    const { exp, sig } = new TokenSigner('secret', 1800).sign('vstream:v1');
    expect(engine.verifyAccess('v1', {}, { exp: String(exp), sig })).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('blocks fetching a private address', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'video-engine-url-'));
    const engine = new VideoStreamEngine(
      { storageDir: dir, signSecret: 'secret', ffmpegBin: 'ffmpeg' },
      new MemoryStore(),
    );

    let thrown: unknown;
    try {
      await engine.ingestUrl({ tenantId: 't1', sourceUrl: 'http://127.0.0.1:1337/v.mp4' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(VideoEngineError);

    rmSync(dir, { recursive: true, force: true });
  });
});
