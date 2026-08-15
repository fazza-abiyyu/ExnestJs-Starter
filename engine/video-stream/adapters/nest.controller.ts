import {
  Body,
  Controller,
  Delete,
  Get,
  Options,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  type Type,
} from '@nestjs/common';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { VideoEngineError, type Video } from '../types.js';
import { VideoStreamEngine } from '../engine.js';
import { SlidingWindowLimiter } from '../internals/limiter.js';

const M3U8 = 'application/vnd.apple.mpegurl';

export interface NestVideoEngineOptions {
  engine: VideoStreamEngine;
  apiKey?: string;
  corsOrigin?: string;
  basePath?: string;
  maxIngestPerTenantMinute?: number;
}

type ExpressRequest = IncomingMessage & {
  params: Record<string, string>;
  query: Record<string, unknown>;
};
type ExpressResponse = ServerResponse & {
  status(code: number): ExpressResponse;
  send(payload: unknown): ExpressResponse;
  end(): ExpressResponse;
  [key: string]: unknown;
};

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key, x-tenant-id, x-file-name, content-type, range',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function errorBody(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof VideoEngineError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { code: 'INTERNAL_ERROR', message, status: 500 };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function readCookie(req: ExpressRequest): Record<string, string | undefined> {
  const header = req.headers.cookie as string | undefined;
  return parseCookies(header);
}

function queryString(req: ExpressRequest, key: string): string | undefined {
  const value = req.query?.[key];
  return typeof value === 'string' ? value : undefined;
}

function header(req: ExpressRequest, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

function toVideoResponse(basePath: string, video: Video, origin: string): Record<string, unknown> {
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

function toNodeStream(web: unknown): Readable {
  if (web && typeof (web as { getReader?: unknown }).getReader === 'function') {
    return Readable.fromWeb(web as never);
  }
  return web as Readable;
}

export function createVideoEngineController(
  options: NestVideoEngineOptions,
): Type<object> {
  const { engine } = options;
  const basePath = options.basePath ?? '/api/v1/videos';
  const corsOrigin = options.corsOrigin ?? '*';
  const apiKey = options.apiKey ?? '';
  const limiter = new SlidingWindowLimiter(options.maxIngestPerTenantMinute ?? 10);

  const requireApiKey = (req: ExpressRequest): string => {
    const tenantId = header(req, 'x-tenant-id') ?? 'default-tenant';
    if (apiKey && header(req, 'x-api-key') !== apiKey) {
      throw new VideoEngineError('UNAUTHORIZED', 'Missing or invalid x-api-key header', 401);
    }
    return tenantId;
  };

  const requireAccess = (req: ExpressRequest, videoId: string): string => {
    const tenantId = header(req, 'x-tenant-id') ?? 'default-tenant';
    const cookies = readCookie(req);
    const authorized = engine.verifyAccess(videoId, cookies, {
      exp: queryString(req, 'exp'),
      sig: queryString(req, 'sig'),
    });
    if (!authorized) {
      throw new VideoEngineError('FORBIDDEN', 'Missing or invalid stream token', 403);
    }
    return tenantId;
  };

  const json = (res: ExpressResponse, status: number, payload: unknown): void => {
    const headers = corsHeaders(corsOrigin);
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
    res.status(status);
    res.setHeader('content-type', 'application/json;charset=utf-8');
    res.send(JSON.stringify(payload));
  };

  const respondError = (res: ExpressResponse, err: unknown): void => {
    const e = errorBody(err);
    json(res, e.status, { error: e });
  };

  const sendHttpResponse = async (res: ExpressResponse, response: Response): Promise<void> => {
    for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = toNodeStream(response.body);
      const writable = res as unknown as Writable;
      await new Promise<void>((resolve, reject) => {
        nodeStream.pipe(writable).once('finish', resolve).once('error', reject);
      });
    } else {
      res.end();
    }
  };

  @Controller(basePath)
  class VideoEngineController {
    @Options('*')
    preflight(@Res() res: ExpressResponse): void {
      res.status(204);
      for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
      res.end();
    }

    @Get()
    async list(@Req() req: ExpressRequest, @Res() res: ExpressResponse): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        const videos = await engine.list(tenantId);
        json(res, 200, { value: videos.map((v) => toVideoResponse(basePath, v, '')), count: videos.length });
      } catch (err) {
        respondError(res, err);
      }
    }

    @Post()
    async create(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Body() body?: unknown): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        if (!limiter.tryAcquire(tenantId)) {
          throw new VideoEngineError('TOO_MANY_REQUESTS', 'Ingest rate limit reached', 429);
        }

        const contentType = header(req, 'content-type') ?? '';
        let video: Video;
        if (contentType.includes('application/json')) {
          const payload = (body ?? {}) as { sourceUrl?: string; title?: string };
          if (!payload.sourceUrl) {
            throw new VideoEngineError('BAD_REQUEST', 'sourceUrl is required for URL source', 400);
          }
          video = await engine.ingestUrl({ tenantId, title: payload.title, sourceUrl: payload.sourceUrl });
        } else {
          video = await engine.ingestFile({
            tenantId,
            title: queryString(req, 'title'),
            fileName: header(req, 'x-file-name') ?? 'video.bin',
            mimeType: contentType || 'application/octet-stream',
            stream: Readable.toWeb(req as unknown as Readable) as unknown as ReadableStream<Uint8Array>,
          });
        }
        json(res, 201, { value: toVideoResponse(basePath, video, '') });
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id')
    async status(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        const video = await engine.status(tenantId, id);
        json(res, 200, { value: toVideoResponse(basePath, video, '') });
      } catch (err) {
        respondError(res, err);
      }
    }

    @Patch(':id')
    async update(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string, @Body() body?: unknown): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        const payload = (body ?? {}) as { title?: string };
        const video = await engine.updateVideo(tenantId, id, { title: payload.title });
        json(res, 200, { value: toVideoResponse(basePath, video, '') });
      } catch (err) {
        respondError(res, err);
      }
    }

    @Delete(':id')
    async remove(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        await engine.remove(tenantId, id);
        res.status(204);
        res.end();
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id/stream/master.m3u8')
    async master(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        const body = await engine.manifest(requireTenant(req), id);
        const cookie = engine.issueAccessCookie(id);
        for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
        res.status(200);
        res.setHeader('content-type', M3U8);
        res.setHeader('cache-control', 'no-store');
        res.setHeader('set-cookie', `vstream=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800`);
        res.send(body);
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id/stream/*')
    async segment(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        const tenantId = requireAccess(req, id);
        const relPath = relativeStreamPath(req, id, basePath);
        const response = await engine.segment(tenantId, id, relPath, {
          rangeHeader: header(req, 'range'),
          ifRange: header(req, 'if-range'),
        });
        await sendHttpResponse(res, response);
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id/raw')
    async raw(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        const tenantId = requireAccess(req, id);
        const response = await engine.raw(tenantId, id, header(req, 'range'));
        await sendHttpResponse(res, response);
      } catch (err) {
        respondError(res, err);
      }
    }
  }

  function requireTenant(req: ExpressRequest): string {
    return header(req, 'x-tenant-id') ?? 'default-tenant';
  }

  function relativeStreamPath(req: ExpressRequest, id: string, pathPrefix: string): string {
    const raw = (req.url ?? '/').split('?')[0];
    const prefix = `${pathPrefix}/${id}/stream/`;
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
    if (raw.startsWith(`${pathPrefix}/`)) return raw.slice(`${pathPrefix}/${id}/stream/`.length);
    return raw;
  }

  return VideoEngineController;
}