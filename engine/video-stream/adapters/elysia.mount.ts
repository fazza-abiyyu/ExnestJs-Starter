import { VideoEngineError, type Video } from '../types.js';
import { VideoStreamEngine } from '../engine.js';
import { SlidingWindowLimiter } from '../internals/limiter.js';

const M3U8 = 'application/vnd.apple.mpegurl';

export interface MountVideoEngineOptions {
  engine: VideoStreamEngine;
  apiKey?: string;
  corsOrigin?: string;
  basePath?: string;
  maxIngestPerTenantMinute?: number;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key, x-tenant-id, x-file-name, content-type, range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function mergeHeaders(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  return { ...base, ...extra };
}

function jsonBody(status: number, payload: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: mergeHeaders({ 'content-type': 'application/json;charset=utf-8' }, extra ?? {}),
  });
}

function errorBody(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof VideoEngineError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { code: 'INTERNAL_ERROR', message, status: 500 };
}

function respond(err: unknown): Response {
  const e = errorBody(err);
  return jsonBody(e.status, { error: e });
}

function toVideoResponse(context: { request: Request }, video: Video, basePath: string): Record<string, unknown> {
  const origin = new URL(context.request.url).origin;
  const manifestUrl = video.hlsReady ? `${origin}${basePath}/${video.id}/stream/master.m3u8` : null;
  return {
    id: video.id,
    tenant_id: video.tenantId,
    title: video.title,
    source: video.source,
    source_url: video.sourceUrl,
    mime_type: video.mimeType,
    size_bytes: video.sizeBytes,
    status: video.status,
    hls_ready: video.hlsReady,
    error_msg: video.errorMsg,
    manifest_url: manifestUrl,
    raw_url: `${origin}${basePath}/${video.id}/raw`,
    created_at: video.createdAt.toISOString(),
    updated_at: video.updatedAt.toISOString(),
  };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

type MountCtx = {
  request: Request;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  set: { status?: number; headers?: unknown };
};

export function mountVideoEngine(app: any, options: MountVideoEngineOptions): any {
  const { engine } = options;
  const basePath = options.basePath ?? '/api/v1/videos';
  const apiKey = options.apiKey ?? '';
  const corsOrigin = options.corsOrigin ?? '*';
  const limiter = new SlidingWindowLimiter(options.maxIngestPerTenantMinute ?? 10);

  const requireApiKey = (ctx: MountCtx): string => {
    const tenantId = ctx.headers['x-tenant-id'] ?? 'default-tenant';
    if (apiKey && ctx.headers['x-api-key'] !== apiKey) {
      throw new VideoEngineError('UNAUTHORIZED', 'Missing or invalid x-api-key header', 401);
    }
    return tenantId;
  };

  const requireAccess = (ctx: MountCtx, videoId: string): string => {
    const tenantId = ctx.headers['x-tenant-id'] ?? 'default-tenant';
    const cookies = parseCookies(ctx.headers.cookie);
    const authorized = engine.verifyAccess(videoId, cookies, {
      exp: ctx.query.exp,
      sig: ctx.query.sig,
    });
    if (!authorized) {
      throw new VideoEngineError('FORBIDDEN', 'Missing or invalid stream token', 403);
    }
    return tenantId;
  };

  app.onRequest((ctx: MountCtx) => {
    if (ctx.request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) });
    }
  });

  app.get(basePath, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      const videos = await engine.list(tenantId);
      return jsonBody(200, {
        value: videos.map((v) => toVideoResponse(ctx, v, basePath)),
        count: videos.length,
      });
    } catch (err) {
      return respond(err);
    }
  });

  app.post(basePath, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      if (!limiter.tryAcquire(tenantId)) {
        throw new VideoEngineError('TOO_MANY_REQUESTS', 'Ingest rate limit reached', 429);
      }

      const contentType = ctx.headers['content-type'] ?? '';
      let video: Video;
      if (contentType.includes('application/json')) {
        const body = (ctx.body ?? {}) as { sourceUrl?: string; title?: string };
        if (!body.sourceUrl) {
          throw new VideoEngineError('BAD_REQUEST', 'sourceUrl is required for URL source', 400);
        }
        video = await engine.ingestUrl({ tenantId, title: body.title, sourceUrl: body.sourceUrl });
      } else {
        video = await engine.ingestFile({
          tenantId,
          title: typeof ctx.query.title === 'string' ? ctx.query.title : undefined,
          fileName: ctx.headers['x-file-name'] ?? 'video.bin',
          mimeType: contentType || 'application/octet-stream',
          stream: ctx.request.body,
        });
      }

      ctx.set.status = 201;
      return jsonBody(201, { value: toVideoResponse(ctx, video, basePath) });
    } catch (err) {
      return respond(err);
    }
  });

  app.get(`${basePath}/:id`, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      const video = await engine.status(tenantId, ctx.params.id);
      return jsonBody(200, { value: toVideoResponse(ctx, video, basePath) });
    } catch (err) {
      return respond(err);
    }
  });

  app.patch(`${basePath}/:id`, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      const body = (ctx.body ?? {}) as { title?: string };
      const video = await engine.updateVideo(tenantId, ctx.params.id, { title: body.title });
      return jsonBody(200, { value: toVideoResponse(ctx, video, basePath) });
    } catch (err) {
      return respond(err);
    }
  });

  app.delete(`${basePath}/:id`, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      await engine.remove(tenantId, ctx.params.id);
      ctx.set.status = 204;
      return new Response(null, { status: 204 });
    } catch (err) {
      return respond(err);
    }
  });

  const masterHandler = async (ctx: MountCtx): Promise<Response> => {
    try {
      const tenantId = ctx.headers['x-tenant-id'] ?? 'default-tenant';
      const body = await engine.manifest(tenantId, ctx.params.id);
      const cookie = engine.issueAccessCookie(ctx.params.id);
      const headers = mergeHeaders(corsHeaders(corsOrigin), {
        'Content-Type': M3U8,
        'Cache-Control': 'no-store',
        'Set-Cookie': `vstream=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800`,
      });
      return new Response(body, { status: 200, headers });
    } catch (err) {
      return respond(err);
    }
  };

  const segmentHandler = async (ctx: MountCtx): Promise<Response> => {
    try {
      const tenantId = requireAccess(ctx, ctx.params.id);
      const response = await engine.segment(tenantId, ctx.params.id, ctx.params['*'], {
        rangeHeader: ctx.headers.range,
        ifRange: ctx.headers['if-range'],
      });
      return new Response(response.body, {
        status: response.status,
        headers: mergeHeaders(corsHeaders(corsOrigin), Object.fromEntries(response.headers)),
      });
    } catch (err) {
      return respond(err);
    }
  };

  const rawHandler = async (ctx: MountCtx): Promise<Response> => {
    try {
      const tenantId = requireAccess(ctx, ctx.params.id);
      const response = await engine.raw(tenantId, ctx.params.id, ctx.headers.range);
      return new Response(response.body, {
        status: response.status,
        headers: mergeHeaders(corsHeaders(corsOrigin), Object.fromEntries(response.headers)),
      });
    } catch (err) {
      return respond(err);
    }
  };

  app.get(`${basePath}/:id/stream/master.m3u8`, masterHandler);
  app.get(`${basePath}/:id/stream/*`, segmentHandler);
  app.get(`${basePath}/:id/raw`, rawHandler);

  return app;
}