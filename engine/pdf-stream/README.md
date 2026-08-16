# @exnest/pdf-engine

A **universal, self-contained** PDF streaming machine for the exnest ecosystem.
It lives *outside* the framework cores (`packages/*`) so any exnest app — Elysia or
NestJS — can drop it in. No runtime npm deps beyond the rasterizer (`@napi-rs/canvas`
+ `pdfjs-dist`) and the optional Elysia/NestJS adapters.

You hand it a PDF from two sources — **a file on the server** (`FILE`) or **a Google
Drive link** (`DRIVE`) — and it rasterizes every page into a PNG, watermarks it, and
serves each page behind a signed, expiring token **plus** a signed viewer cookie. The
original PDF is never downloadable; all you ship to the client are images.

- **Framework-agnostic kernel** — no imports from any host app. Only Bun/Node built-ins.
  Works the same under exnest (Elysia or NestJS) or a bare Bun server.
- **Persistence via `DocumentStore`** — bring your own DB (the `PrismaDocumentStore`
  adapter is included, and the `StreamDocument` Prisma model is in `prisma-model.prisma`).
- **Protection by design** — the page `<img>` tags are gated by an HMAC query token
  (`?exp&sig=`) *and* an HttpOnly `pdf_session` cookie that the viewer iframe obtains
  by POSTing `/session`. Scraping the URLs out of devtools/HTML is useless without the
  cookie; both expire (`signTtlSeconds`) and are `no-store`.
- **Economical by design** — `processSlots=1`, ingest rate-limit, `maxQueue` → 429.

## Why this engine

This is **not** a PDF-to-image CLI or a canned watermark library — it is an in-process
*PDF machine*: your documents are rasterized and served from your own infrastructure,
and the package drops into any exnest app.

- **Rasterized, leak-resistant output** — pdfjs-dist renders each page to PNG
  (`@napi-rs/canvas`) at `rasterScale` (default 1.5×), and a diagonal watermark is drawn
  across every page, so no PDF bytes ever reach the browser. What you lose with
  rasterization (text selection, native zoom) is the point: it defeats copy/paste and
  "scrape the HTML into a PDF" — the strongest practical PDF protection short of DRM.
- **Dual adapters, byte-identical contract** — Elysia (`mountPdfEngine`) and NestJS
  (`PdfEngineModule`) expose the same `{ value }` / `{ error }` envelope and the same
  headers, so you swap backend frameworks without touching the client.
- **Google Drive as a first-class source** — share links are normalized to the direct
  `drive.usercontent.google.com` download URL, the >~100 MB "Virus scan warning" page is
  auto-confirmed, and the filename is picked from `Content-Disposition`.
- **Session-bound viewer** — `POST /:id/session` hands out one signed URL per page *and*
  sets an HttpOnly `pdf_session` cookie tied to that document. A page without the cookie
  is 403 even with a valid token, so a URL copied to another browser or a plain `curl`
  fails. `SameSite=Strict` + short TTL keep copied links short-lived.
- **Static-file-light serving** — one small PNG per request, never the whole PDF in
  memory (the rasterized pages are small static files). Source file stays on disk under
  `storage/docs/{id}/source`.
- **SSRF-guarded Drive fetch** — every redirect hop is re-checked against private /
  loopback / link-local / metadata addresses.

What it deliberately is not: a PDF *renderer* (no SVG/vector output), DRM, or a
watermark-only overlay — the watermark is burned into the rasterized pixels, and
screenshotting a detail is the practical limit of any viewer (by design, see Security).

## Layout

```
pdf-stream/                   # this package (engine/pdf-stream in the monorepo)
  index.ts                    # entry — engine, types, adapters
  types.ts                    # PdfEngineConfig, StreamDocument, DocumentStore, PdfEngineError
  engine.ts                   # PdfEngine — the machine (facade)
  preview.ts                  # protected viewer <iframe> HTML
  internals/
    raster.ts                 # pdfjs-dist → PNG rasterizer (N slots, watermark, timeout)
    signer.ts                 # HMAC token (?exp&sig page tokens + session cookie)
    ssrf.ts                   # URL/IP guard (blocks private/loopback/link-local/metadata)
    files.ts                  # path traversal guard + safe FS helpers
    fileio.ts                 # capped stream→file writer (maxBytes → 413)
    limiter.ts                # sliding-window rate limiter (shared by adapters)
  adapters/
    elysia.mount.ts           # self-contained Elysia wiring (CORS, cookies, rate limit)
    nest.controller.ts        # NestJS dynamic controller (same envelope/headers)
    nest.module.ts            # PdfEngineModule.forRoot({ engine, apiKey, … })
    prisma.store.ts           # PrismaDocumentStore
  prisma-model.prisma         # the StreamDocument model to copy into your schema
  *.spec.ts                   # unit + HTTP e2e tests (bun test)
  README.md
```

## Install

Runs on **Bun and Node.js (>=18)**. Requires `@napi-rs/canvas` and `pdfjs-dist` (runtime
deps), `ffmpeg` is not needed. Consume it from npm (packed tarball, `file:`/`git+`
dependency — `prepare` runs the build), or copy `pdf-stream/` from the monorepo.

```bash
bunx tsc -p tsconfig.build.json   # build dist/ (run by `prepare` on git deps)
```

Entry points (via package `exports`):

| Import | Contents |
| --- | --- |
| `@exnest/pdf-engine` | core: `PdfEngine`, types, `PrismaDocumentStore`, internals — no framework deps |
| `@exnest/pdf-engine/nest` | `createPdfEngineController`, `PdfEngineModule` |
| `@exnest/pdf-engine/elysia` | `mountPdfEngine`, `MountPdfEngineOptions` |

1. Copy the `StreamDocument` model from `prisma-model.prisma` into your Prisma schema
   and run `db:generate`.
2. Construct the engine with a store. See `.env.example` for the full list of `PDF_*`
   env vars the host app is expected to supply:

```ts
import { PdfEngine, PrismaDocumentStore } from '@exnest/pdf-engine';

const engine = new PdfEngine(
  {
    storageDir: './storage',
    signSecret: process.env.PDF_SIGNED_SECRET!, // REQUIRED in production
    signTtlSeconds: 300,
    maxBytes: 50 * 1024 * 1024,
    processSlots: 1,
    maxQueue: 5,
    proxyTimeoutMs: 30_000,
    rasterScale: 1.5,
  },
  new PrismaDocumentStore(prisma),
);

await engine.start(); // resume pending + heal interrupted jobs
```

3. Route it (Elysia):

```ts
import { mountPdfEngine } from '@exnest/pdf-engine/elysia';
mountPdfEngine(app, {
  engine,
  apiKey: process.env.PDF_API_KEY,   // required for create/list/delete
  corsOrigin: '*',
  basePath: '/api/v1/documents',
  maxIngestPerTenantMinute: 10,      // 0 = unlimited
});
```

The adapter is **self-contained** — it returns (and errors with) a simple
`{ "value": … }` / `{ "error": { "code", "message", "status" } }` envelope and defines its
own CORS + rate limiting, so it never depends on the host's OData/exception plumbing.
Non-Elysia hosts just call the `engine.*` methods from their own controllers.

## NestJS adapter

Same routes, same envelope, same headers. Mount it as a feature module:

```ts
import { Module } from '@nestjs/common';
import { PdfEngineModule } from '@exnest/pdf-engine/nest';

@Module({
  imports: [
    PdfEngineModule.forRoot({
      engine,
      apiKey: process.env.PDF_API_KEY!, // required for create/list/delete
      corsOrigin: '*',
      basePath: '/api/v1/documents',
      maxIngestPerTenantMinute: 10,     // 0 = unlimited
    }),
  ],
})
export class DocumentModule {}
```

Notes:
- The controller is built by `createPdfEngineController(options)` (exported) and
  registered dynamically by `PdfEngineModule.forRoot(...)`; require `@nestjs/common >=8 <12`
  (peer dep).
- Platform: Express (`@nestjs/platform-express`). JSON ingest uses `@Body()` so the host's
  body parser must handle `application/json`; file ingest reads the raw request stream.
- The engine is Bun-first (`Bun.file`, web streams) — run the Nest app with `bun` or keep
  `FILE` ingests served via the Elysia adapter.

## HTTP routes (Elysia adapter)

`x-tenant-id` scopes create/list/status/delete (default: `default-tenant`). The viewer
routes (`session`, `pages`, `preview`) are tenantless by design — the signed token + cookie
is the credential.

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/documents` | `x-api-key` + rate limited |
| GET | `/api/v1/documents` | `x-api-key` |
| GET | `/api/v1/documents/:id` | `x-api-key` |
| DELETE | `/api/v1/documents/:id` | `x-api-key` |
| POST | `/api/v1/documents/:id/session` | none — sets `pdf_session` cookie |
| GET | `/api/v1/documents/:id/pages/:page?exp&sig` | cookie **+** signed token |
| GET | `/api/v1/documents/:id/preview` | none — asserts status is `ready` |

### Ingest a file

```
POST /api/v1/documents?name=Contract
Content-Type: multipart/form-data
  field "file" = contract.pdf
  field "watermark" (optional)
x-api-key: …
```

### Ingest a Google Drive link

```
POST /api/v1/documents
Content-Type: application/json
x-api-key: …

{ "sourceUrl": "https://drive.google.com/file/d/{ID}/view?usp=sharing", "watermark": "ACME" }
```

URLs are SSRF-guarded on every redirect hop (public IPs only). Drive share links are
normalized to the direct-download form, and the >~100 MB "Virus scan warning" page is
auto-confirmed.

### Viewing a document

The client just points an `<iframe>` at the `preview_url`:

1. The preview page POSTs `/api/v1/documents/:id/session` → gets one signed URL per page
   and sets the `pdf_session` cookie.
2. The `<iframe>` renders `<img src="…/pages/N?exp&sig">` — the browser sends the cookie,
   both checks pass, PNG loads.
3. Tokens/cookie expire after `signTtlSeconds`; the viewer re-sessions automatically on
   the next load.

## Engine API

```ts
await engine.start();              // resume pending + heal interrupted processing
await engine.ingestFile({ tenantId, name?, fileName, watermark?, stream });
await engine.ingestUrl({ tenantId, name?, sourceUrl, watermark? });
await engine.status(tenantId, id);
await engine.list(tenantId);
await engine.remove(tenantId, id);
await engine.pageSession(tenantId, id, { baseUrl, ttlSeconds? }); // tenant-scoped
await engine.pageSessionById(id, { baseUrl, ttlSeconds? });       // viewer path
await engine.pageImage(id, page);   // PNG bytes (tenantless; token+store gate route)
engine.previewHtml(id, apiBaseUrl);
await engine.assertPreviewable(id);
engine.signedPageUrl(id, page, baseUrl, ttlSeconds?);
engine.verifyPage(id, page, { exp, sig });
engine.sessionCookie(id, ttlSeconds?);   // -> "exp.sig"
engine.verifySessionCookie(id, value);   // -> boolean
engine.issuePageToken(id, page, ttlSeconds?);
```

## Config reference

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `storageDir` | string | — | base folder (`docs/{id}/…`) |
| `signSecret` | string | — | HMAC key for page tokens + viewer cookie |
| `signTtlSeconds` | number | `300` | token/cookie expiry |
| `maxBytes` | number | `50 MB` | per-ingest cap (413 over) |
| `processSlots` | number | `1` | concurrent rasterizers |
| `maxQueue` | number | `5` | ingest rejected with 429 when full |
| `proxyTimeoutMs` | number | `30_000` | per-hop Drive fetch timeout |
| `rasterScale` | number | `1.5` | 1 = 72 dpi, 1.5 = 108 dpi, 2 = 144 dpi |

## Status lifecycle

```
pending ──► processing ──► ready          (pageCount > 0, PNGs on disk)
                  │
                  └─────────► failed        (errorMsg set)
```

Each DRIVE job retries once before `failed`. `engine.start()` resets crashed `processing`
rows, re-runs `pending`, and marks interrupted `processing` rows as `failed`. One
rasterizer runs at a time (`processSlots`); queue depth is capped by `maxQueue`.

## Security

- `SsrfGuard`: http(s) only, no URL credentials, no private/loopback/link-local/metadata
  (incl. `169.254.169.254`). Re-checked on every redirect hop.
- `resolveInside` rejects `..` and any escape from the per-document directory.
- A page is only served when **both** the signed `?exp&sig` token **and** a valid
  `pdf_session` cookie for that document are present; the cookie is `HttpOnly`,
  `SameSite=Strict`, and `Max-Age`-bounded. URLs scraped from devtools/HTML are dead
  without the cookie and expire anyway.
- Rasterized pages are the only output — the original PDF never leaves
  `storage/docs/{id}/source`.
- Screenshooting/recording cannot be prevented (the image is on screen) — the watermark
  is there to prove who leaked which document. That ceiling is inherent to any
  viewable-on-screen document.

## Testing

```bash
bun install                     # devDeps: @nestjs/common, bun-types, elysia, pdf-lib, …
bun test                        # kernel unit + Elysia e2e (MemoryStore, real PDF raster)
bunx tsc --noEmit -p tsconfig.json     # typecheck
```