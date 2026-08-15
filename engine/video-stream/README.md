# @exnest/video-engine

A **universal, self-contained** HLS video streaming machine for the exnest ecosystem.
It lives *outside* the framework cores (`packages/*`) so any exnest app — Elysia or
NestJS — can drop it in. No runtime npm deps beyond the runtime itself (Bun) and, for the
optional HTTP adapter, Elysia.

You hand it a video from two sources — **a file on the server** (`FILE`) or **a remote
URL** (`URL`, Google Drive included) — and it turns it into **adaptive-bitrate HLS**
(up to 3 renditions), stored locally and served as small static segments on demand.

- **Framework-agnostic kernel** — no imports from any host app. Only Bun/Node built-ins.
  Works the same under exnest (Elysia or NestJS) or a bare Bun server.
- **Persistence via `VideoStore`** — bring your own DB (the `PrismaVideoStore` adapter is
  included, and the `Video` Prisma model is in `prisma-model.prisma`).
- **Economical by design** — `processSlots=1`, ingest rate-limit, `keepSource=false`
  deletes the source file after packaging (~75% disk saved).
- **Static-file-light serving** — one small segment per request, never the whole video in
  memory.

## Layout

```
video-stream/                  # this package (engine/video-stream in the monorepo)
  index.ts                     # entry — engine, types, adapters
  types.ts                     # Video, VideoStore, VideoEngineConfig, VideoEngineError
  engine.ts                    # VideoStreamEngine — the machine (facade)
  internals/
    packager.ts                # ffmpeg HLS queue (N slots, VOD, audio detection)
    signer.ts                  # HMAC token (cookie or ?exp&sig)
    ssrf.ts                    # URL/IP guard (blocks private/loopback/link-local/metadata)
    range.ts                   # HTTP Range parser (206 / 416)
    files.ts                   # path traversal guard + safe FS helpers
  adapters/
    elysia.mount.ts            # self-contained Elysia wiring (CORS, cookies, rate limit)
    prisma.store.ts            # PrismaVideoStore
  prisma-model.prisma          # the Video model to copy into your schema
  *.spec.ts                    # unit + HTTP e2e tests (bun test)
  README.md
```

## Install

1. Copy the `video-stream/` folder into your project (or reference it from the monorepo).
2. Copy the `Video` model from `prisma-model.prisma` into your Prisma schema and run
   `db:generate`.
3. Construct the engine with a store. See `.env.example` for the full list of `VIDEO_*`
   env vars the host app is expected to supply:

```ts
import { VideoStreamEngine, PrismaVideoStore } from '@exnest/video-engine';

const engine = new VideoStreamEngine(
  {
    storageDir: './uploads',
    signSecret: process.env.VIDEO_SIGNED_SECRET!, // REQUIRED in production
    ffmpegBin: 'ffmpeg',
    maxBytes: 2 * 1024 * 1024 * 1024,
    processSlots: 1,
    maxQueue: 5,
    proxyTimeoutMs: 30_000,
    renditions: 3,       // 2 | 3
    keepSource: false,   // delete the source file once HLS is ready
  },
  new PrismaVideoStore(prisma),
);

await engine.start(); // probe ffmpeg + resume interrupted jobs
```

`ffmpeg` and `ffprobe` are required for packaging. Without them the engine still serves
`raw` (progressive stream + Range).

4. Route it (Elysia):

```ts
import { mountVideoEngine } from '@exnest/video-engine';
mountVideoEngine(app, {
  engine,
  apiKey: process.env.VIDEO_API_KEY,   // required for create/list/delete
  corsOrigin: '*',
  basePath: '/api/v1/videos',
  maxIngestPerTenantMinute: 10,        // 0 = unlimited
});
```

The adapter is **self-contained** — it returns (and errors with) a simple
`{ "value": … }` / `{ "error": { "code", "message", "status" } }` envelope and defines its
own CORS + rate limiting, so it never depends on the host's OData/exception plumbing.
Non-Elysia hosts just call the `engine.*` methods from their own controllers.

## HTTP routes (Elysia adapter)

`x-tenant-id` scopes every operation (default: `default-tenant`).

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/videos` | `x-api-key` + rate limited |
| GET | `/api/v1/videos` | `x-api-key` |
| GET | `/api/v1/videos/:id` | `x-api-key` |
| PATCH | `/api/v1/videos/:id` | `x-api-key` — `{ "title": "…" }` |
| DELETE | `/api/v1/videos/:id` | `x-api-key` |
| GET | `/api/v1/videos/:id/stream/master.m3u8` | none — issues `vstream` cookie |
| GET | `/api/v1/videos/:id/stream/*` | cookie or `?exp&sig` |
| GET | `/api/v1/videos/:id/raw` | cookie or `?exp&sig` + `Range` |

### Ingest a file

```
POST /api/v1/videos?title=Intro
x-file-name: intro.mp4
Content-Type: video/mp4
x-api-key: …
<body bytes>
```

### Ingest a URL (Google Drive included)

```
POST /api/v1/videos
Content-Type: application/json
x-api-key: …

{ "sourceUrl": "https://drive.google.com/file/d/{ID}/view?usp=sharing" }
```

URLs are SSRF-guarded on every redirect hop (public IPs only). Drive share links are
normalized to the direct-download form, and the >~100 MB "Virus scan warning" page is
auto-confirmed.

## Engine API

```ts
await engine.start();                             // probe ffmpeg + resume pending
await engine.ingestFile({ tenantId, title?, fileName, mimeType?, stream });
await engine.ingestUrl({ tenantId, title?, sourceUrl });
await engine.status(tenantId, id);
await engine.updateVideo(tenantId, id, { title });
await engine.list(tenantId);
await engine.remove(tenantId, id);
await engine.manifest(tenantId, id);              // master.m3u8 text
await engine.segment(tenantId, id, relPath, opts);// -> Response (Range-aware)
await engine.raw(tenantId, id, rangeHeader?);     // source or remote-range proxy
engine.issueAccessCookie(videoId);
engine.verifyAccess(videoId, cookies, query);
```

## Config reference

| Option | Type | Default | Notes |
| --- | --- | --- | --- |
| `storageDir` | string | — | base folder (`videos/{id}/…`) |
| `signSecret` | string | — | HMAC key for stream cookie / signed URLs |
| `signTtlSeconds` | number | `1800` | cookie expiry |
| `ffmpegBin` | string | `ffmpeg` | ffprobe derived by suffix swap |
| `maxBytes` | number | `2 GiB` | per-ingest cap |
| `processSlots` | number | `1` | concurrent ffmpeg workers |
| `maxQueue` | number | `5` | ingest rejected with 429 when full |
| `proxyTimeoutMs` | number | `30_000` | per-hop fetch/ffmpeg timeout |
| `renditions` | `2 \| 3` | `3` | `3` = 1080p/720p/480p, `2` = 720p/480p |
| `keepSource` | boolean | `true` | delete source after successful packaging |

Renditions: 1080p@5 Mbps / 720p@2.8 Mbps / 480p@1.4 Mbps, AAC 128 kbps stereo, GOP 48,
4 s segments, VOD.

## Status lifecycle

```
pending ──► processing ──► ready          (hlsReady = true)
                 │
                 └─────────► failed        (errorMsg set)
```

Each job retries once before `failed`. `engine.start()` resets crashed `processing` rows
and re-packs `pending` rows, so restarts heal interrupted work. One ffmpeg runs at a time
(`processSlots`); queue depth is capped by `maxQueue`.

## Security

- `SsrfGuard`: http(s) only, no URL credentials, no private/loopback/link-local/metadata
  (incl. `169.254.169.254`). Re-checked on every redirect hop.
- `resolveInside` rejects `..` and any escape from the per-video directory.
- Stream access needs the signed `vstream` cookie or a matching `?exp&sig=`.
- ffmpeg/ffprobe spawn with argv arrays (never a shell); input paths are engine-generated.

## Testing

```bash
bun test                      # unit + e2e (MemoryStore, no DB needed)
bunx tsc --noEmit -p tsconfig.json   # typecheck
```

To run inside the monorepo without installing: symlink `node_modules` to
`packages/elysia/node_modules`.