# Exnest Framework

A resource-oriented software framework with OData, available for multiple runtimes in a single monorepo.

## Structure

- `packages/nestjs` — Enterprise implementation (NestJS)
- `packages/elysia` — Fast implementation (Elysia + Bun)

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
