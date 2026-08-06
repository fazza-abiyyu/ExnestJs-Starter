# Exnest Framework

Framework perangkat lunak berorientasi resource dengan OData, tersedia untuk beberapa runtime dalam satu monorepo.

## Structure

- `packages/nestjs` — implementasi Enterprise (NestJS)
- `packages/elysia` — implementasi Cepat (Elysia + Bun)

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

Lihat `README.md` masing-masing package untuk detail per framework.