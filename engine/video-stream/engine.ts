import { randomUUID } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { VideoEngineError, type Video, type VideoStore, type VideoEngineConfig } from './types.js';
import { TokenSigner } from './internals/signer.js';
import { SsrfGuard } from './internals/ssrf.js';
import { parseRange } from './internals/range.js';
import {
  ensureDir,
  isFileAt,
  removeDir,
  resolveInside,
  sourceFilePath,
  videoDir,
  videoHlsDir,
  videoSourceDir,
} from './internals/files.js';
import { Packager, RENDITIONS_2, RENDITIONS_3, type RenditionSpec } from './internals/packager.js';

const M3U8 = 'application/vnd.apple.mpegurl';
const TS = 'video/mp2t';

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

function detectBinary(bin: string, versionArg = '-version'): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, [versionArg]);
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

export function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
  } catch {
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? 'video.bin';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64);
  return cleaned.length > 0 ? cleaned : 'video.bin';
}

export class VideoStreamEngine {
  private readonly config: Required<Pick<VideoEngineConfig, 'storageDir' | 'signSecret'>> &
    VideoEngineConfig;
  private readonly store: VideoStore;
  private readonly signer: TokenSigner;
  private readonly guard: SsrfGuard;
  private readonly packager: Packager;
  private readonly renditionSpec: RenditionSpec[];
  private readonly keepSource: boolean;
  private readonly progressive: boolean;
  private ffmpegAvailable = false;

  constructor(config: VideoEngineConfig, store: VideoStore) {
    this.config = config;
    this.store = store;
    this.signer = new TokenSigner(config.signSecret, config.signTtlSeconds ?? 1800);
    this.guard = new SsrfGuard({ blockPrivate: true });
    this.packager = new Packager(config.processSlots ?? 1, config.proxyTimeoutMs ?? 30000);
    this.renditionSpec = (config.renditions ?? 3) === 2 ? RENDITIONS_2 : RENDITIONS_3;
    this.keepSource = config.keepSource ?? true;
    this.progressive = config.progressive ?? false;
  }

  get hasFfmpeg(): boolean {
    return this.ffmpegAvailable;
  }

  get maxQueue(): number {
    return this.config.maxQueue ?? 5;
  }

  get maxBytes(): number {
    return this.config.maxBytes ?? 2 * 1024 * 1024 * 1024;
  }

  async start(): Promise<void> {
    if (this.config.ffmpegBin) {
      this.ffmpegAvailable = await detectBinary(this.config.ffmpegBin);
    }
    await this.resumePending();
  }

  shutdown(): void {
    this.packager.killAll();
  }

  private videoRoot(id: string): string {
    return videoDir(this.config.storageDir, id);
  }

  private async getRequired(tenantId: string, id: string): Promise<Video> {
    const video = await this.store.get(tenantId, id);
    if (!video) {
      throw new VideoEngineError('VIDEO_NOT_FOUND', 'Video not found', 404);
    }
    return video;
  }

  /** A video is playable once fully packaged, or (progressive only) while a remote URL is
   *  still streaming through ffmpeg but at least one rendition playlist has landed. */
  private usable(video: Video): boolean {
    if (video.status === 'ready' && video.hlsReady) return true;
    return (
      this.progressive &&
      video.status === 'processing' &&
      video.source === 'URL' &&
      this.hasAnyPlaylist(video)
    );
  }

  private hasAnyPlaylist(video: Video): boolean {
    const hls = videoHlsDir(this.videoRoot(video.id));
    for (let i = 0; i < this.renditionSpec.length; i++) {
      if (isFileAt(resolveInside(hls, String(i), 'index.m3u8'))) return true;
    }
    return false;
  }

  issueAccessCookie(videoId: string): string {
    return this.signer.cookieValue(`vstream:${videoId}`);
  }

  verifyAccess(
    videoId: string,
    cookies: Record<string, string | undefined>,
    query: Record<string, string | undefined>,
  ): boolean {
    const resource = `vstream:${videoId}`;
    if (this.signer.verifyCookie(resource, cookies.vstream)) return true;
    const exp = Number(query.exp);
    const sig = query.sig ?? '';
    return this.signer.verify(resource, exp, sig);
  }

  async ingestFile(input: {
    tenantId: string;
    title?: string;
    fileName: string;
    mimeType?: string;
    stream: ReadableStream<Uint8Array> | null;
  }): Promise<Video> {
    const id = randomUUID();
    const root = this.videoRoot(id);
    await ensureDir(videoSourceDir(root));

    const fileName = sanitizeFileName(input.fileName);
    const filePath = sourceFilePath(root, fileName);
    const size = await this.writeToFile(filePath, input.stream, this.maxBytes);

    const video = await this.store.create({
      id,
      tenantId: input.tenantId,
      title: input.title || fileName,
      source: 'FILE',
      fileName,
      filePath,
      mimeType: input.mimeType || 'application/octet-stream',
      sizeBytes: size,
    });

    await this.startPackaging(video);
    return (await this.store.get(input.tenantId, id)) ?? video;
  }

  async ingestUrl(input: { tenantId: string; title?: string; sourceUrl: string }): Promise<Video> {
    const normalized = this.normalizeSourceUrl(input.sourceUrl);
    let sourceUrl = normalized;
    let resolvedTitle: string | undefined;

    if (isYouTubeUrl(normalized)) {
      const resolved = await this.resolveYoutubeUrl(normalized);
      resolvedTitle = resolved.title;
    }

    await this.guard.assertSafeUrl(sourceUrl);

    const id = randomUUID();
    const video = await this.store.create({
      id,
      tenantId: input.tenantId,
      title: input.title ?? normalized,
      source: 'URL',
      sourceUrl,
      fileName: null,
      filePath: null,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
    });

    let current = video;
    if (resolvedTitle) {
      const updated = await this.store.update(id, { title: resolvedTitle });
      current = (await this.store.get(input.tenantId, id)) ?? updated;
    }

    if (!this.ffmpegAvailable) {
      await this.store.update(id, { status: 'ready', hlsReady: false, readyAt: new Date() });
      return (await this.store.get(input.tenantId, id)) ?? current;
    }
    if (this.progressive) {
      void this.streamPack(current);
      return current;
    }
    void this.downloadAndProcess(current);
    return current;
  }

  async status(tenantId: string, id: string): Promise<Video> {
    return this.getRequired(tenantId, id);
  }

  async updateVideo(tenantId: string, id: string, input: { title?: string }): Promise<Video> {
    const video = await this.getRequired(tenantId, id);
    if (input.title === undefined || input.title.trim().length === 0) {
      throw new VideoEngineError('BAD_REQUEST', 'title is required', 400);
    }
    return this.store.update(id, { title: input.title.trim() });
  }

  async list(tenantId: string): Promise<Video[]> {
    return this.store.list(tenantId);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.getRequired(tenantId, id);
    await this.store.remove(tenantId, id);
    await removeDir(this.videoRoot(id));
  }

  async manifest(tenantId: string, id: string): Promise<string> {
    const video = await this.getRequired(tenantId, id);
    if (!this.usable(video)) {
      throw new VideoEngineError('VIDEO_NOT_READY', 'Video has not been packaged yet', 409);
    }

    const hls = videoHlsDir(this.videoRoot(id));
    const lines: string[] = ['#EXTM3U', '#EXT-X-VERSION:3'];
    for (let i = 0; i < this.renditionSpec.length; i++) {
      const playlist = resolveInside(hls, String(i), 'index.m3u8');
      if (!isFileAt(playlist)) continue;
      const r = this.renditionSpec[i];
      lines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth * 1000},RESOLUTION=${r.width}x${r.height},NAME="${r.height}p"`,
      );
      lines.push(`${i}/index.m3u8`);
    }
    if (lines.length === 2) {
      throw new VideoEngineError('VIDEO_NOT_READY', 'No playable renditions found', 409);
    }
    lines.push('#EXT-X-ENDLIST');
    return lines.join('\n');
  }

  async segment(
    tenantId: string,
    id: string,
    relPath: string,
    options: { rangeHeader?: string; ifRange?: string; mimeType?: string },
  ): Promise<Response> {
    const video = await this.getRequired(tenantId, id);
    if (!this.usable(video)) {
      throw new VideoEngineError('VIDEO_NOT_READY', 'Video has not been packaged yet', 409);
    }

    const decoded = decodeURIComponent(relPath ?? '');
    if (decoded.length === 0 || decoded.includes('..')) {
      throw new VideoEngineError('PATH_TRAVERSAL', 'Forbidden path', 403);
    }
    const contentType = decoded.endsWith('.m3u8') ? M3U8 : TS;
    const filePath = resolveInside(videoHlsDir(this.videoRoot(id)), decoded);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new VideoEngineError('SEGMENT_NOT_FOUND', 'File not found', 404);
    }
    return this.serveFile(file, options.rangeHeader, contentType);
  }

  async raw(tenantId: string, id: string, rangeHeader?: string): Promise<Response> {
    const video = await this.getRequired(tenantId, id);

    if (video.source === 'URL' && !video.filePath) {
      return this.serveRemoteRaw(video, rangeHeader);
    }

    if (!video.filePath) {
      throw new VideoEngineError('VIDEO_NOT_READY', 'Video has no local source', 409);
    }
    const file = Bun.file(video.filePath);
    if (!(await file.exists())) {
      throw new VideoEngineError('SOURCE_NOT_FOUND', 'Source file not found', 404);
    }
    return this.serveFile(file, rangeHeader, video.mimeType || 'application/octet-stream');
  }

  async resumePending(): Promise<void> {
    if (!this.ffmpegAvailable) return;
    await this.store.resetProcessing();
    const pending = await this.store.findByStatus('pending');
    for (const video of pending) {
      if (video.source === 'URL' && !video.filePath) {
        await this.store.update(video.id, {
          status: 'failed',
          errorMsg: 'interrupted progressive ingest; re-submit to recover',
        });
        continue;
      }
      void this.processVideo(video);
    }
  }

  private async writeToFile(
    filePath: string,
    stream: ReadableStream<Uint8Array> | null,
    maxBytes: number,
  ): Promise<number> {
    if (!stream) {
      throw new VideoEngineError('EMPTY_BODY', 'Request body is required', 400);
    }
    const sink = Bun.file(filePath).writer();
    const reader = stream.getReader();
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value?.byteLength ?? 0;
        if (maxBytes > 0 && total > maxBytes) {
          throw new VideoEngineError(
            'PAYLOAD_TOO_LARGE',
            `Payload exceeds maximum size of ${maxBytes} bytes`,
            413,
          );
        }
        await sink.write(value);
      }
    } finally {
      try {
        if (typeof reader?.releaseLock === 'function') reader.releaseLock();
      } catch {
        // reader may not expose releaseLock on some runtimes
      }
      try {
        await sink.end();
      } catch {
        // file may have been cleaned up by the caller
      }
    }
    return total;
  }

  private async startPackaging(video: Video): Promise<void> {
    if (!this.ffmpegAvailable) {
      await this.store.update(video.id, { status: 'ready', hlsReady: false, readyAt: new Date() });
      return;
    }
    if (this.packager.pending >= this.maxQueue) {
      throw new VideoEngineError('QUEUE_FULL', 'Ingest queue is full, try again later', 429);
    }
    void this.processVideo(video);
  }

  private async streamPack(video: Video): Promise<void> {
    if (!video.sourceUrl) return;
    try {
      const { res } = await this.fetchGuarded(video.sourceUrl, this.config.proxyTimeoutMs ?? 30000);
      if (!res.body) {
        throw new VideoEngineError('EMPTY_SOURCE', 'Source returned no body', 400);
      }
      const root = this.videoRoot(video.id);
      const hls = videoHlsDir(root);
      await ensureDir(hls);
      await this.store.update(video.id, { status: 'processing' });

      const disposition = res.headers.get('content-disposition');
      const dispositionName = disposition
        ? /filename="?([^";]+)"?/i.exec(disposition)?.[1]
        : undefined;
      const fileName = sanitizeFileName(
        dispositionName ?? new URL(video.sourceUrl).pathname.split('/').pop() ?? 'source.bin',
      );

      await this.packager.enqueue({
        hlsDir: hls,
        ffmpegBin: this.config.ffmpegBin ?? 'ffmpeg',
        renditions: this.renditionSpec,
        timeoutMs: this.config.proxyTimeoutMs ?? 30000,
        stdin: res.body,
        maxBytes: this.maxBytes,
      });

      await this.store.update(video.id, {
        fileName,
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
        status: 'ready',
        hlsReady: true,
        readyAt: new Date(),
        errorMsg: null,
        ...(video.title === video.sourceUrl ? { title: fileName } : {}),
      });
    } catch (err) {
      await this.store.update(video.id, {
        status: 'failed',
        hlsReady: false,
        errorMsg: errorMessage(err),
      });
    }
  }

  private async downloadAndProcess(video: Video): Promise<void> {
    if (!video.sourceUrl) return;
    try {
      if (isYouTubeUrl(video.sourceUrl)) {
        await this.downloadYoutubeAndProcess(video);
        return;
      }
      const { res } = await this.fetchGuarded(video.sourceUrl, this.config.proxyTimeoutMs ?? 30000);
      if (!res.body) {
        throw new VideoEngineError('EMPTY_SOURCE', 'Source returned no body', 400);
      }
      const root = this.videoRoot(video.id);
      await ensureDir(videoSourceDir(root));
      const disposition = res.headers.get('content-disposition');
      const dispositionName = disposition
        ? /filename="?([^";]+)"?/i.exec(disposition)?.[1]
        : undefined;
      const fileName = sanitizeFileName(
        dispositionName ?? new URL(video.sourceUrl).pathname.split('/').pop() ?? 'source.bin',
      );
      const filePath = sourceFilePath(root, fileName);
      const size = await this.writeToFile(filePath, res.body, this.maxBytes);

      const updated = await this.store.update(video.id, {
        fileName,
        filePath,
        sizeBytes: size,
        mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
        ...(video.title === video.sourceUrl ? { title: fileName } : {}),
      });
      await this.processVideo(updated);
    } catch (err) {
      await this.store.update(video.id, {
        status: 'failed',
        hlsReady: false,
        errorMsg: errorMessage(err),
      });
    }
  }

  private async downloadYoutubeAndProcess(video: Video): Promise<void> {
    const { default: youtubedl } = await import('youtube-dl-exec').catch(() => {
      throw new VideoEngineError(
        'YOUTUBE_UNAVAILABLE',
        'YouTube download requires the "youtube-dl-exec" package to be installed',
        501,
      );
    });
    if (!video.sourceUrl) return;
    const timeoutMs = Math.max(this.config.proxyTimeoutMs ?? 30000, 10 * 60_000);
    const root = this.videoRoot(video.id);
    const sourceDir = videoSourceDir(root);
    await ensureDir(sourceDir);
    const destTemplate = `${join(sourceDir, 'source')}.%(ext)s`;
    const child = youtubedl.exec(video.sourceUrl, {
      format: 'best[ext=mp4]/best',
      output: destTemplate,
      noPart: true,
      noWarnings: true,
      callHome: false,
      noCheckCertificates: true,
      noPlaylist: true,
      jsRuntimes: 'node',
    });
    try {
      await this.withTimeout(async () => {
        const res = await child;
        if (res.exitCode !== 0) {
          throw new VideoEngineError(
            'YOUTUBE_DOWNLOAD',
            `Download failed: ${String(res.stderr ?? '')
              .trim()
              .slice(0, 400)}`,
            400,
          );
        }
      }, timeoutMs, () => child.kill?.('SIGKILL'));
    } catch (cause) {
      throw new VideoEngineError(
        'YOUTUBE_DOWNLOAD',
        `Failed to download YouTube video: ${cause instanceof Error ? cause.message : String(cause)}`,
        400,
      );
    }
    const produced = readdirSync(sourceDir).find(
      (name) => name.startsWith('source.') && !name.endsWith('.part'),
    );
    if (!produced) {
      throw new VideoEngineError('YOUTUBE_DOWNLOAD', 'Downloaded file not found', 400);
    }
    const filePath = join(sourceDir, produced);
    const sizeBytes = statSync(filePath).size;
    const updated = await this.store.update(video.id, {
      fileName: produced,
      filePath,
      sizeBytes,
      mimeType: 'video/mp4',
    });
    await this.processVideo(updated);
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
          throw new VideoEngineError('REDIRECT', 'Redirect without location header', 400);
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
    throw new VideoEngineError('REDIRECT', 'Too many redirects', 400);
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

  /** Validate a YouTube URL is playable and adopt its title using the `youtube-dl-exec`
   *  npm package — it installs and manages the underlying `yt-dlp` binary itself, so no
   *  operator-side tooling is needed. The original URL is kept as `sourceUrl` and the media
   *  is downloaded later (also via the library) before packaging. If the package is missing,
   *  ingest fails with a clear `YOUTUBE_UNAVAILABLE`. */
  private async resolveYoutubeUrl(
    rawUrl: string,
  ): Promise<{ url: string; title: string | undefined }> {
    const { default: youtubedl } = await import('youtube-dl-exec').catch(() => {
      throw new VideoEngineError(
        'YOUTUBE_UNAVAILABLE',
        'YouTube resolution requires the "youtube-dl-exec" package to be installed',
        501,
      );
    });
    const timeoutMs = this.config.proxyTimeoutMs ?? 30_000;
    const args = {
      dumpSingleJson: true,
      format: 'best[ext=mp4]/best',
      noWarnings: true,
      callHome: false,
      noCheckCertificates: true,
      noPlaylist: true,
      jsRuntimes: 'node' as const,
    };
    const child: any = youtubedl.exec(rawUrl, args);
    let raw: string;
    try {
      raw = await this.withTimeout(
        async () => {
          const res = await child;
          const stdout: string = typeof res === 'string' ? res : (res?.stdout ?? '');
          return stdout.split(/\r?\n/).find((line: string) => line.trim()) ?? '';
        },
        timeoutMs,
        () => child.kill?.('SIGKILL'),
      );
    } catch (cause) {
      throw new VideoEngineError(
        'YOUTUBE_RESOLVE',
        `Failed to resolve YouTube URL: ${cause instanceof Error ? cause.message : String(cause)}`,
        400,
      );
    }
    let out: { title?: string; url?: unknown; requested_formats?: Array<{ url?: unknown }> };
    try {
      out = JSON.parse(raw);
    } catch {
      throw new VideoEngineError(
        'YOUTUBE_RESOLVE',
        'Unexpected resolver output for this video',
        400,
      );
    }
    const direct =
      typeof out.url === 'string'
        ? out.url
        : out.requested_formats?.find((f) => typeof f.url === 'string')?.url;
    if (typeof direct !== 'string' || !/^https?:\/\//i.test(direct)) {
      throw new VideoEngineError(
        'YOUTUBE_RESOLVE',
        'No downloadable stream found for this video',
        400,
      );
    }
    return { url: direct, title: out.title || undefined };
  }

  private withTimeout<T>(
    run: () => Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(`command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      run().then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  private serveFile(file: BunFile, rangeHeader: string | undefined, contentType: string): Response {
    const size = file.size;
    const parsed = parseRange(rangeHeader, size);
    const headers: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
    };

    if (parsed.status === 'unsatisfiable') {
      headers['Content-Range'] = `bytes */${size}`;
      return new Response(null, { status: 416, headers });
    }

    if (parsed.status === 'ok' && parsed.range) {
      const { start, end } = parsed.range;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      headers['Content-Length'] = String(end - start + 1);
      return new Response(file.slice(start, end + 1).stream(), { status: 206, headers });
    }

    headers['Content-Length'] = String(size);
    return new Response(file.stream(), { status: 200, headers });
  }

  private async serveRemoteRaw(video: Video, rangeHeader: string | undefined): Promise<Response> {
    if (!video.sourceUrl) {
      throw new VideoEngineError('SOURCE_NOT_FOUND', 'No source URL', 404);
    }
    const headers: Record<string, string> = {};
    if (rangeHeader) headers['Range'] = rangeHeader;
    const { res } = await this.fetchGuarded(
      video.sourceUrl,
      this.config.proxyTimeoutMs ?? 30000,
      headers,
    );

    const headerNames = [
      'content-range',
      'content-length',
      'content-type',
      'accept-ranges',
      'etag',
      'last-modified',
    ];
    for (const name of headerNames) {
      const value = res.headers.get(name);
      if (value) headers[name] = value;
    }
    return new Response(res.body, { status: res.status, headers });
  }

  private async processVideo(video: Video): Promise<void> {
    if (video.attempt >= 2) return;

    let attempts = video.attempt;
    for (;;) {
      attempts++;
      await this.store.update(video.id, { status: 'processing', attempt: attempts });

      const hls = videoHlsDir(this.videoRoot(video.id));
      await ensureDir(hls);
      try {
        await this.packager.enqueue({
          sourcePath: video.filePath!,
          hlsDir: hls,
          ffmpegBin: this.config.ffmpegBin ?? 'ffmpeg',
          renditions: this.renditionSpec,
          timeoutMs: this.config.proxyTimeoutMs ?? 30000,
        });
        await this.store.update(video.id, {
          status: 'ready',
          hlsReady: true,
          readyAt: new Date(),
          errorMsg: null,
          attempt: attempts,
        });
        if (!this.keepSource) {
          await removeDir(videoSourceDir(this.videoRoot(video.id)));
        }
        return;
      } catch (err) {
        const lastAttempt = attempts >= 2;
        if (lastAttempt) {
          await this.store.update(video.id, {
            status: 'failed',
            hlsReady: false,
            errorMsg: errorMessage(err),
            attempt: attempts,
          });
          return;
        }
      }
    }
  }
}

type BunFile = ReturnType<typeof Bun.file>;
