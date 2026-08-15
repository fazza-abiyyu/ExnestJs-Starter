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

## Why this engine

This is **not** a transcoding CLI, a SaaS gateway, or a media-server front-end — it is an
in-process *HLS machine*: your videos are repackaged and served from your own
infrastructure, and the package drops into any exnest app.

- **Zero runtime deps in the kernel** — `engine.ts` only imports `node:*` + `Bun.file` and
  spawns ffmpeg directly (argv arrays, never a shell). No ffmpeg-binding or HLS library to
  vendor or break; the whole engine is a handful of plain TypeScript files.
- **Dual adapters, byte-identical contract** — Elysia (`mountVideoEngine`) and NestJS
  (`VideoEngineModule`) expose the same `{ value }` / `{ error }` envelope and the same
  headers, so you swap backend frameworks without touching the client.
- **Google Drive as a first-class source** — share links are normalized to the direct
  download URL, the >~100 MB "Virus scan warning" page is auto-confirmed, and the filename
  is picked from `Content-Disposition`. YouTube URLs resolve through an optional
  `yt-dlp` (never vendored) to a direct media URL.
- **Stateless stream auth** — segments/raw are gated by an HMAC cookie (`vstream`) or a
  signed `?exp&sig=`, verified without a DB hit per request; the SSRF guard re-checks every
  redirect hop.
- **Range-aware everywhere** — 206 / 416 / `if-range` for both segments and the raw source,
  and `serveRemoteRaw` proxies `Range` straight to a URL source so a bare URL can be played
  before it is even packaged.
- **One ffmpeg pass → N renditions** (`-var_stream_map`, auto audio detection), a
  multi-slot queue (`processSlots`, capped by `maxQueue` → 429), and crash healing on
  restart (reset `processing`, re-pack `pending`).
- **Economical by design** — `keepSource=false` deletes the source once HLS is ready
  (~75% disk saved), `renditions: 2 | 3` trades quality for cost, `processSlots=1` throttles
  CPU, and every operation is tenant-scoped (`x-tenant-id`).

What it deliberately is not: live streaming or real-time WebRTC — the latter is
`mediasoup` territory.

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
    limiter.ts                 # sliding-window rate limiter (shared by adapters)
  adapters/
    elysia.mount.ts            # self-contained Elysia wiring (CORS, cookies, rate limit)
    nest.controller.ts         # NestJS dynamic controller (same envelope/headers)
    nest.module.ts             # VideoEngineModule.forRoot({ engine, apiKey, … })
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

## NestJS adapter

Same routes, same envelope, same headers. Mount it as a feature module:

```ts
import { Module } from '@nestjs/common';
import { VideoEngineModule } from '@exnest/video-engine';

@Module({
  imports: [
    VideoEngineModule.forRoot({
      engine,
      apiKey: process.env.VIDEO_API_KEY!, // required for create/list/update/delete
      corsOrigin: '*',
      basePath: '/api/v1/videos',
      maxIngestPerTenantMinute: 10,        // 0 = unlimited
    }),
  ],
})
export class VideoModule {}
```

Notes:
- The controller is built by `createVideoEngineController(options)` (exported) and registered
  dynamically by `VideoEngineModule.forRoot(...)`; require `@nestjs/common >=8 <12` (peer dep).
- Platform: Express (`@nestjs/platform-express`). Streaming segments/raw pipe the engine's web
  `Response` into the express `res` via `node:stream`; JSON ingest uses `@Body()` so the host's
  body parser must handle `application/json`, file ingest reads the raw request stream.
- The engine itself is Bun-first (`Bun.file`, web streams) — run the Nest app with `bun` or keep
  `raw`/URL-only features on Node. Stream access, packages, GDrive, SSRF, rate-limit are shared
  kernel code, identical to the Elysia adapter.

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

### YouTube (optional)

YouTube URLs (`youtube.com`, `youtu.be`, `music.youtube.com`, …) are resolved to a direct,
playable media URL through an optional `yt-dlp` binary — nothing is vendored. If `yt-dlp` is
missing the ingest fails with `YOUTUBE_UNAVAILABLE`; if present, the resolved direct URL is
stored as `sourceUrl` and the video's real title is adopted automatically, then the normal
download/stream → HLS pipeline runs (progressive mode included).

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
| `progressive` | boolean | `false` | stream a remote URL straight into ffmpeg (stdin) — HLS segments are served as soon as the first ones land, no full download first |
| `youtubeBin` | string | `yt-dlp` | optional binary that resolves YouTube URLs to a direct media URL; when missing, YouTube ingests fail with `YOUTUBE_UNAVAILABLE` |

Renditions: 1080p@5 Mbps / 720p@2.8 Mbps / 480p@1.4 Mbps, AAC 128 kbps stereo, GOP 48,
4 s segments, VOD.

### Progressive mode

With `progressive: true`, a URL ingest never waits for the full download: the response body is
piped straight into ffmpeg on stdin (`-i pipe:0`) and HLS playlists/segments are published as
soon as each 4 s chunk is encoded — `usable()` lets `manifest`/`segment` serve while the video
is still in `processing`. The byte cap (`maxBytes`) kills the job if the source out-grows the
limit; interrupted progressive rows are marked `failed` on restart (re-submit to recover), and
non-progressive behavior is unchanged. Note: a piped input cannot be probed up front, so audio
is assumed present for progressive jobs.

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
bun install                     # devDeps: @nestjs/common, bun-types, elysia, …
bun test                        # kernel unit + Elysia e2e + Nest adapter (MemoryStore, no DB)
bunx tsc --noEmit -p tsconfig.json     # typecheck
```