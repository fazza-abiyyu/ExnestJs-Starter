# Exnest Framework

A resource-oriented software framework with OData, available for multiple runtimes in a single monorepo.

## Structure

- `packages/nestjs` — Enterprise implementation (NestJS)
- `packages/elysia` — Fast implementation (Elysia + Bun)
- `engine/` — framework-agnostic engines (plugins), each optionally consumed by any exnest app

## Engines

Standalone, framework-agnostic "machines" that an app can drop in without touching the
framework cores. Each engine is npm-consumable (Bun and Node ≥ 18) with per-framework
adapters (`/nest`, `/elysia`, …), so the same kernel runs on any backend.

### Video Engine

Adaptive-bitrate **HLS video streaming** — ingest a file, remote URL, Google Drive, or
YouTube link, and get multi-rendition (1080p/720p/480p) HLS with audio, signed stream
access, SSRF guard, and tenant scoping. Stored + served locally as small static segments.

- Package: [`engine/video-stream/`](engine/video-stream/)
- Details: [`engine/video-stream/README.md`](engine/video-stream/README.md)

> This section grows as new engines land (queue, transcode, live, …) — one folder per
> engine, same boundary: kernel clean of frameworks, adapters optional.

## Quickstart

```sh
# NestJS (enterprise)
cd packages/nestjs
npm install
npm run start:dev

# Elysia (fast)
cd packages/elysia
bun install
bun run dev
```

See each package's `README.md` for framework-specific details.

## Using a Single Framework

Each package is standalone (own `package.json`, lockfile, and `.gitignore`), so just go into its folder without interference from the other:

```sh
cd packages/nestjs && npm install && npm run start:dev
cd packages/elysia && bun install && bun run dev
```

To use one outside the monorepo, pick the approach that fits:

**Plain copy (fresh, no history)**

```sh
cp -R packages/elysia /path/to/new-project
cd /path/to/new-project && rm -rf .git && git init
```

**Extract with `git subtree` (carries the package's commit history to a new repo)**

```bash
git subtree split --prefix=packages/elysia -b elysia-only
git remote add elysia-repo https://github.com/user/ExnestElysia.git
git push elysia-repo elysia-only:main
```

Note: this keeps the monorepo structure intact and makes it easy to maintain both implementations side by side.
