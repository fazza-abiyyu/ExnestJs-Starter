import { PdfEngineError, type StreamDocument } from '../types.js';
import { PdfEngine } from '../engine.js';
import { SlidingWindowLimiter } from '../internals/limiter.js';

export interface MountPdfEngineOptions {
  engine: PdfEngine;
  apiKey?: string;
  corsOrigin?: string;
  basePath?: string;
  maxIngestPerTenantMinute?: number;
}

export const PDF_VIEWER_PATH = 'viewer';

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'x-api-key, x-tenant-id, x-file-name, content-type',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function parseSessionCookie(header: string): string | undefined {
  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === 'pdf_session') return rawValue.join('=');
  }
  return undefined;
}

function mergeHeaders(
  base: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  return { ...base, ...extra };
}

function jsonBody(status: number, payload: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: mergeHeaders({ 'content-type': 'application/json;charset=utf-8' }, extra ?? {}),
  });
}

function errorBody(err: unknown): { code: string; message: string; status: number } {
  if (err instanceof PdfEngineError) {
    return { code: err.code, message: err.message, status: err.status };
  }
  const message = err instanceof Error ? err.message : 'Internal Server Error';
  return { code: 'INTERNAL_ERROR', message, status: 500 };
}

function respond(err: unknown): Response {
  const e = errorBody(err);
  return jsonBody(e.status, { error: e });
}

function toDocumentResponse(
  context: { request: Request },
  doc: StreamDocument,
  basePath: string,
): Record<string, unknown> {
  const origin = new URL(context.request.url).origin;
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

type MountCtx = {
  request: Request;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  set: { status?: number; headers?: unknown };
};

export function mountPdfEngine(app: any, options: MountPdfEngineOptions): any {
  const { engine } = options;
  const basePath = options.basePath ?? '/api/v1/documents';
  const apiKey = options.apiKey ?? '';
  const corsOrigin = options.corsOrigin ?? '*';
  const limiter = new SlidingWindowLimiter(options.maxIngestPerTenantMinute ?? 10);

  const requireApiKey = (ctx: MountCtx): string => {
    const tenantId = ctx.headers['x-tenant-id'] ?? 'default-tenant';
    if (apiKey && ctx.headers['x-api-key'] !== apiKey) {
      throw new PdfEngineError('UNAUTHORIZED', 'Missing or invalid x-api-key header', 401);
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
      const docs = await engine.list(tenantId);
      return jsonBody(200, {
        value: docs.map((d) => toDocumentResponse(ctx, d, basePath)),
        count: docs.length,
      });
    } catch (err) {
      return respond(err);
    }
  });

  app.post(basePath, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      if (!limiter.tryAcquire(tenantId)) {
        throw new PdfEngineError('TOO_MANY_REQUESTS', 'Ingest rate limit reached', 429);
      }

      const contentType = ctx.headers['content-type'] ?? '';
      let name: string | undefined;
      let watermark: string | undefined;
      let doc: StreamDocument;

      if (contentType.includes('application/json')) {
        const body = (ctx.body ?? {}) as {
          sourceUrl?: string;
          name?: string;
          watermark?: string;
        };
        if (!body.sourceUrl) {
          throw new PdfEngineError('BAD_REQUEST', 'sourceUrl is required for DRIVE source', 400);
        }
        name = typeof ctx.query.name === 'string' ? ctx.query.name : body.name;
        watermark = typeof body.watermark === 'string' ? body.watermark : undefined;
        doc = await engine.ingestUrl({ tenantId, name, sourceUrl: body.sourceUrl, watermark });
      } else {
        const form = (ctx.body ?? {}) as { file?: File; watermark?: string };
        if (!form.file || typeof form.file.arrayBuffer !== 'function') {
          throw new PdfEngineError('BAD_REQUEST', 'file is required for upload', 400);
        }
        name =
          typeof ctx.query.name === 'string' ? ctx.query.name : form.file.name || 'document.pdf';
        watermark = typeof form.watermark === 'string' ? form.watermark : undefined;
        doc = await engine.ingestFile({
          tenantId,
          name,
          fileName: form.file.name || 'document.pdf',
          watermark,
          stream: form.file.stream(),
        });
      }

      ctx.set.status = 201;
      return jsonBody(201, { value: toDocumentResponse(ctx, doc, basePath) });
    } catch (err) {
      return respond(err);
    }
  });

  app.get(`${basePath}/:id`, async (ctx: MountCtx) => {
    try {
      const tenantId = requireApiKey(ctx);
      const doc = await engine.status(tenantId, ctx.params.id);
      return jsonBody(200, { value: toDocumentResponse(ctx, doc, basePath) });
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

  app.post(`${basePath}/:id/session`, async (ctx: MountCtx) => {
    try {
      const body = (ctx.body ?? {}) as { ttl?: number };
      const origin = new URL(ctx.request.url).origin;
      const session = await engine.pageSessionById(ctx.params.id, {
        baseUrl: `${origin}${basePath}`,
        ttlSeconds: typeof body.ttl === 'number' ? body.ttl : undefined,
      });
      const cookie = engine.sessionCookie(ctx.params.id, session.expires_in);
      const setCookie = `pdf_session=${cookie}; Path=${basePath}/; HttpOnly; SameSite=Strict; Max-Age=${session.expires_in}`;
      return jsonBody(
        200,
        { value: session },
        { 'set-cookie': setCookie, 'Access-Control-Allow-Credentials': 'true' },
      );
    } catch (err) {
      return respond(err);
    }
  });

  const pageHandler = async (ctx: MountCtx): Promise<Response> => {
    try {
      const page = Number(ctx.params.page);
      if (!Number.isInteger(page) || page < 1) {
        throw new PdfEngineError('PAGE_OUT_OF_RANGE', 'Page number is out of range', 400);
      }
      if (!engine.verifyPage(ctx.params.id, page, { exp: ctx.query.exp, sig: ctx.query.sig })) {
        throw new PdfEngineError('FORBIDDEN', 'Missing or invalid page token', 403);
      }
      const cookie = parseSessionCookie(ctx.headers.cookie ?? '');
      if (!engine.verifySessionCookie(ctx.params.id, cookie)) {
        throw new PdfEngineError('FORBIDDEN', 'Missing or invalid viewer session', 403);
      }
      const data = await engine.pageImage(ctx.params.id, page);
      const headers = mergeHeaders(corsHeaders(corsOrigin), {
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Length': String(data.byteLength),
      });
      return new Response(data as unknown as BodyInit, { status: 200, headers });
    } catch (err) {
      return respond(err);
    }
  };

  app.get(`${basePath}/:id/pages/:page`, pageHandler);

  app.get(`${basePath}/:id/preview`, async (ctx: MountCtx) => {
    try {
      await engine.assertPreviewable(ctx.params.id);
      const origin = new URL(ctx.request.url).origin;
      const html = engine.previewHtml(ctx.params.id, `${origin}${basePath}`);
      return new Response(html, {
        status: 200,
        headers: mergeHeaders(corsHeaders(corsOrigin), {
          'Content-Type': 'text/html;charset=utf-8',
          'Cache-Control': 'no-store',
        }),
      });
    } catch (err) {
      return respond(err);
    }
  });

  return app;
}
