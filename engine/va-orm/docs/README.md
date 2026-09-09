# VA-ORM Documentation

Custom lightweight ORM untuk Exnest Framework, pengganti Prisma.

## Struktur Dokumentasi

```
docs/
├── README.md              # Index & overview (file ini)
├── 01-architecture.md     # Arsitektur & design principles
├── 02-schema.md           # Schema definition (va.schema)
├── 03-core.md             # Core infrastructure
├── 04-drivers.md          # Database drivers
├── 05-repository.md       # Repository layer (CRUD)
├── 06-raw.md              # Raw SQL (CTE, Subquery)
├── 07-pagination.md       # Pagination strategies
├── 08-migration.md        # Migration system
├── 09-integrations.md     # Framework integrations
├── 10-cli.md              # CLI tools
├── 11-testing.md          # Testing strategy
└── 12-relations.md        # Relations (include, filters, nested writes)
```

## Quick Start

```typescript
import { VaClient } from '@exnest/va'

const client = await VaClient.create({
  driver: 'postgresql',
  dsn: process.env.DATABASE_URL,
})

const users = await client.repository('user').findMany({
  where: (eb) => eb.eq('status', 'active'),
  orderBy: { column: 'createdAt', direction: 'desc' },
  limit: 10,
})
```

## Package Structure

| Package | npm name | Role |
|---------|----------|------|
| `packages/schema` | `@exnest/va-schema` | Schema parsing & validation |
| `packages/client` | `@exnest/va-client` | Runtime ORM library |
| `packages/cli` | `@exnest/va-cli` | CLI tools |

## Design Principles

1. **Schema-first** — `va.schema` dengan syntax mirip Prisma
2. **No implicit transactions** — Direct SQL, 3-7x lebih cepat dari Prisma
3. **Production-grade defaults** — Connection pooling, health checks, retry
4. **Zero overhead** — Generated code < 1MB, pure TypeScript
