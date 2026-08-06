# ExnestTs - ElysiaJs

The Elysia + Bun foundation of Exnest. Same modular architecture and conventions
as the NestJS `exnest-framework`, but built on [Elysia](https://elysiajs.com) with the
Bun runtime.

## Quick Start

```bash
bun install
cp .env.example .env        # set DATABASE_URL
bun run db:generate         # generate Prisma client
bun run db:push             # push schema to DB
bun run dev                 # http://localhost:3000
```

## Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Start dev server (watch) |
| `bun run start` | Start server |
| `bun run test` | Run unit tests (`bun test`) |
| `bun run gen:module` | Scaffold a new CRUD module |
| `bun run openapi:gen` | Generate OpenAPI spec |
| `bun run postman:gen` | Generate Postman collection |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:push` | Push schema to DB |
| `bun run db:studio` | Open Prisma Studio |

## Architecture

```
elysia/
├── prisma/                 # Prisma schema
├── scripts/                # Module + openapi + postman generators
└── src/
    ├── index.ts            # Entry (Elysia .listen)
    ├── app.ts              # App builder (mounts modules + error handler)
    ├── infrastructure/
    │   ├── config/         # env-based config
    │   └── database/       # PrismaClient singleton
    ├── lib/
    │   ├── endpoint/        # RouteConfig + mountRoutes (declarative routing)
    │   ├── exception/       # ODataError + error handler
    │   └── odata/          # ODataResponse, i18n, pagination
    ├── modules/            # Feature modules (customers)
    │   └── registry.ts     # module builder list (# wire in app.ts)
    └── endpoints/
        ├── registry.ts     # aggregated RouteConfig[] (for codegen)
        └── <feature>/     # per-feature routes
```

## Module Naming Convention (per feature like `customers`)

| File | Purpose |
|------|---------|
| `index.ts` | Barrel re-export |
| `<name>.module.ts` | `build<Name>Module(app)` — wires service + controller + mounts routes |
| `<name>.controller.ts` | Handler bag (plain class) using `HandlerContext` |
| `<name>.service.ts` | Business logic, Prisma access |
| `<name>.dto.ts` | Zod schemas + derived DTO types |
| `<name>.interface.ts` | Raw DB shape + response interfaces |
| `<name>.i18n.ts` | Translations via `odataI18n.register()` |
| `<name>.service.spec.ts` | Unit tests (`bun test`) |

Generate a new module with:

```bash
bun run gen:module <feature-name>
```

This scaffolds the module + endpoint set, registers the builder in
`src/modules/registry.ts`, the routes in `src/endpoints/registry.ts`, and appends the
Prisma model. Run `bun run db:generate` afterwards.

## OData Conventions

- Responses via `ODataResponse.collection(...)` / `.item(...)` with `@odata.context`, `@odata.count`, `@odata.nextLink`
- Errors thrown as `ODataError(code, message, status, lang)` from the service
- `x-tenant-id` header selects the tenant (fallback `default-tenant`)
- `?lang=id|en` switches i18n error messages

## Tests

```bash
bun run test     # 13 tests (CustomersService + ODataResponse)
```