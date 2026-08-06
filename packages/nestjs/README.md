# Exnest Framework Starter

A production-ready NestJS starter with OData V4, modular architecture, and multi-tenancy support.

## Features

- **NestJS 11** with Express (v5)
- **OData V4** response patterns (`@odata.context`, `@odata.count`, `@odata.nextLink`)
- **Prisma ORM** (PostgreSQL, v7)
- **Multi-tenant** by design (tenant isolation at service level)
- **Config-driven endpoints** — declarative `EndpointConfig` registry
- **Auto-generated** Postman collection, OpenAPI spec, and module scaffolding
- **i18n-ready** error handling with `ODataError`
- **Layered architecture**: Controller → Service → Prisma

## Quick Start

```bash
npm install
npx prisma migrate dev
npm run start:dev
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run gen:module` | Scaffold a new CRUD module |
| `npm run postman:gen` | Generate Postman collection |
| `npm run openapi:gen` | Generate OpenAPI spec |
| `npm run test` | Run unit tests |
| `npm run test:e2e` | Run e2e tests |

## Architecture

```
src/
├── infrastructure/     # Config, database, shared utilities
├── lib/                # Core framework (OData, exceptions, endpoints)
├── modules/            # Feature modules (health, metadata, user-defined)
└── endpoints/          # Route registry
```

## Naming Convention

Change the app name in `package.json` `name` field — it propagates to health checks, DB defaults, output filenames, and emails.
