# Architecture

Arsitektur VA-ORM dan design principles.

## High-Level Architecture

```
va.schema (text file)
    │
    ▼ (SchemaParser)
SchemaAST
    │
    ├──▶ TypeGenerator  ──▶ types.ts (interfaces)
    ├──▶ ClientGenerator ──▶ client.ts (VaClient subclass)
    └──▶ SqlGenerator   ──▶ schema.sql (DDL)
```

## Runtime Architecture

```
VaClient (facade)
    │
    ├── ConnectionPool
    │       ├── PooledConnection[]
    │       │     ├── PostgresDriver  (pg Pool)
    │       │     ├── MysqlDriver     (mysql2/promise)
    │       │     └── SqliteDriver    (bun:sqlite)
    │       └── waitingQueue + health checks
    │
    ├── Repository<T> (per model)
    │     ├── QueryBuilder
    │     └── ExpressionBuilder
    │
    ├── RawQuery
    ├── CTEBuilder
    └── SubqueryBuilder
```

## Module Dependencies

```
schema (standalone)
    │
    ▼
core/types.ts (defines all interfaces)
    │
    ├── expression.ts ──▶ WhereClause, FilterOperator
    ├── query-builder.ts ──▶ expression.ts + DatabaseDriver
    ├── connection.pool.ts ──▶ DatabaseDriver
    └── va.client.ts ──▶ connection.pool + repository + raw
```

## Export Structure

```typescript
// Main client
import { VaClient, Repository, QueryBuilder } from '@exnest/va'

// CLI
import { validate, generate, migrate } from '@exnest/va/cli'

// NestJS
import { VaModule, VaService } from '@exnest/va/nest'

// Elysia
import { VaSingleton, vaPlugin } from '@exnest/va/elysia'
```

## Comparison with Prisma

| Aspect | Prisma | VA |
|--------|--------|----|
| Engine | Rust binary (74MB) | Pure TypeScript (<1MB) |
| Query overhead | 3-7x (implicit BEGIN/COMMIT) | 1.2-1.5x (direct SQL) |
| Cold start | 180ms | <50ms |
| Schema syntax | `prisma.schema` | `va.schema` (compatible) |
| Connection pool | Basic defaults | Production-grade defaults |
