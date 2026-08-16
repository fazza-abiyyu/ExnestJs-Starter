import { Body, Controller, Delete, Get, Options, Param, Post, Query, Req, Res, type Type } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { PdfEngineError, type StreamDocument as PdfDocument } from '../types.js';
import { PdfEngine } from '../engine.js';
import { SlidingWindowLimiter } from '../internals/limiter.js';

export interface NestPdfEngineOptions {
  engine: PdfEngine;
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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key, x-tenant-id, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function errorBody(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof PdfEngineError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { code: 'INTERNAL_ERROR', message, status: 500 };
}

function header(req: ExpressRequest, key: string): string | undefined {
  const value = req.headers[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}

function queryString(req: ExpressRequest, key: string): string | undefined {
  const value = req.query?.[key];
  return typeof value === 'string' ? value : undefined;
}

function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === 'pdf_session') {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

function toDocumentResponse(basePath: string, doc: PdfDocument, origin: string): Record<string, unknown> {
  return {
    id: doc.id,
    tenant_id: doc.tenantId,
    name: doc.name,
    source: doc.source,
    source_url: doc.sourceUrl,
    watermark: doc.watermark,
    page_count: doc.pageCount,
    status: doc.status,
    attempt: doc.attempt,
    error_msg: doc.errorMsg,
    preview_url: `${origin}${basePath}/${doc.id}/preview`,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  };
}

export function createPdfEngineController(
  options: NestPdfEngineOptions,
): Type<object> {
  const { engine } = options;
  const basePath = options.basePath ?? '/api/v1/documents';
  const corsOrigin = options.corsOrigin ?? '*';
  const apiKey = options.apiKey ?? '';
  const limiter = new SlidingWindowLimiter(options.maxIngestPerTenantMinute ?? 10);

  const requireApiKey = (req: ExpressRequest): string => {
    const tenantId = header(req, 'x-tenant-id') ?? 'default-tenant';
    if (apiKey && header(req, 'x-api-key') !== apiKey) {
      throw new PdfEngineError('UNAUTHORIZED', 'Missing or invalid x-api-key header', 401);
    }
    return tenantId;
  };

  const json = (res: ExpressResponse, status: number, payload: unknown): void => {
    for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
    res.status(status);
    res.setHeader('content-type', 'application/json;charset=utf-8');
    res.send(JSON.stringify(payload));
  };

  const respondError = (res: ExpressResponse, err: unknown): void => {
    const e = errorBody(err);
    json(res, e.status, { error: e });
  };

  @Controller(basePath)
  class PdfEngineController {
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
        const docs = await engine.list(tenantId);
        json(res, 200, {
          value: docs.map((d) => toDocumentResponse(basePath, d, '')),
          count: docs.length,
        });
      } catch (err) {
        respondError(res, err);
      }
    }

    @Post()
    async create(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Body() body?: unknown): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        if (!limiter.tryAcquire(tenantId)) {
          throw new PdfEngineError('TOO_MANY_REQUESTS', 'Ingest rate limit reached', 429);
        }

        const contentType = header(req, 'content-type') ?? '';
        let doc: PdfDocument;
        if (contentType.includes('application/json')) {
          const payload = (body ?? {}) as { sourceUrl?: string; name?: string; watermark?: string };
          if (!payload.sourceUrl) {
            throw new PdfEngineError('BAD_REQUEST', 'sourceUrl is required for DRIVE source', 400);
          }
          doc = await engine.ingestUrl({
            tenantId,
            name: payload.name,
            sourceUrl: payload.sourceUrl,
            watermark: payload.watermark,
          });
        } else {
          const fileName = header(req, 'x-file-name') ?? 'document.pdf';
          doc = await engine.ingestFile({
            tenantId,
            name: queryString(req, 'name'),
            fileName,
            watermark: undefined,
            stream: ReadableToWeb(req),
          });
        }
        json(res, 201, { value: toDocumentResponse(basePath, doc, '') });
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id')
    async status(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        const tenantId = requireApiKey(req);
        const doc = await engine.status(tenantId, id);
        json(res, 200, { value: toDocumentResponse(basePath, doc, '') });
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

    @Post(':id/session')
    async session(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string, @Body() body?: unknown): Promise<void> {
      try {
        const payload = (body ?? {}) as { ttl?: number };
        const origin = `http://${header(req, 'host') ?? 'localhost'}`;
        const session = await engine.pageSessionById(id, {
          baseUrl: `${origin}${basePath}`,
          ttlSeconds: typeof payload.ttl === 'number' ? payload.ttl : undefined,
        });
        const cookie = engine.sessionCookie(id, session.expires_in);
        for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
        res.status(200);
        res.setHeader('content-type', 'application/json;charset=utf-8');
        res.setHeader(
          'set-cookie',
          `pdf_session=${cookie}; Path=${basePath}/; HttpOnly; SameSite=Strict; Max-Age=${session.expires_in}`,
        );
        res.send(JSON.stringify({ value: session }));
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id/pages/:page')
    async page(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string, @Param('page') pageRaw: string): Promise<void> {
      try {
        const page = Number(pageRaw);
        if (!Number.isInteger(page) || page < 1) {
          throw new PdfEngineError('PAGE_OUT_OF_RANGE', 'Page number is out of range', 400);
        }
        if (!engine.verifyPage(id, page, { exp: queryString(req, 'exp'), sig: queryString(req, 'sig') })) {
          throw new PdfEngineError('FORBIDDEN', 'Missing or invalid page token', 403);
        }
        const cookie = parseSessionCookie(header(req, 'cookie'));
        if (!engine.verifySessionCookie(id, cookie)) {
          throw new PdfEngineError('FORBIDDEN', 'Missing or invalid viewer session', 403);
        }
        const data = await engine.pageImage(id, page);
        for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
        res.status(200);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Length', String(data.byteLength));
        res.end(Buffer.from(data));
      } catch (err) {
        respondError(res, err);
      }
    }

    @Get(':id/preview')
    async preview(@Req() req: ExpressRequest, @Res() res: ExpressResponse, @Param('id') id: string): Promise<void> {
      try {
        await engine.assertPreviewable(id);
        const origin = `http://${header(req, 'host') ?? 'localhost'}`;
        const html = engine.previewHtml(id, `${origin}${basePath}`);
        for (const [key, value] of Object.entries(corsHeaders(corsOrigin))) res.setHeader(key, value);
        res.status(200);
        res.setHeader('Content-Type', 'text/html;charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(html);
      } catch (err) {
        respondError(res, err);
      }
    }
  }

  return PdfEngineController;
}

function ReadableToWeb(req: ExpressRequest): ReadableStream<Uint8Array> | null {
  return Readable.toWeb(req as unknown as Readable) as unknown as ReadableStream<Uint8Array>;
}