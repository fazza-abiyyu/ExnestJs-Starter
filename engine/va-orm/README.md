# @v-va/orm (VA-ORM)

Lightweight, production-grade TypeScript ORM — PostgreSQL, MySQL, SQLite.
Schema-first with Prisma-like syntax, zero heavy query engine.

> **Beta** (`0.1.0-beta.x`): API stabilising. Pin your version. Tracking
> issues in the GitHub repo.

## Install

```sh
bun add @v-va/orm
# or
npm i @v-va/orm
```

Bring your own driver (peer, optional — install what you use):

```sh
bun add pg        # PostgreSQL
bun add mysql2    # MySQL
```

SQLite works on Bun with zero deps (`bun:sqlite` built in).

## Quickstart

**1. Write `va.schema`:**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

**2. Push + generate:**

```sh
bunx va db push --schema ./va.schema
bunx va generate --schema ./va.schema
```

**3. Query:**

```ts
import { VaClient } from '@v-va/orm';

const va = VaClient.create({
  driver: 'postgres',
  dsn: process.env.DATABASE_URL!,
  models: { user: { tableName: 'users' } },
});

const user = await va.repository('user').findUnique({ id: '1' });
const users = await va.repository('user').findMany({ where: { name: 'Jo' }, limit: 10 });
await va.repository('user').create({ data: { email: 'a@x.dev', name: 'A' } });
```

`@updatedAt` fields auto-refresh on write. Raw SQL, transactions,
aggregations, relations, cursor/keyset pagination included.

## Framework adapters

```ts
// NestJS
import { VaModule } from '@v-va/orm/nest';
VaModule.forRoot({ driver: 'postgres', dsn: process.env.DATABASE_URL! });

// Elysia / Bun
import { createVaSingleton } from '@v-va/orm/elysia';
const va = createVaSingleton({ driver: 'postgres', dsn: process.env.DATABASE_URL! });
```

## CLI

```sh
va validate [--schema ./va.schema]
va generate [--output ./generated] [--sql]
va migrate up | down | status      # file migrations
va db push [--dry-run]             # diff schema → DB (creates + alters drift)
va db pull                         # introspect DB → schema
```

## Links

- Repository: https://github.com/fazza-abiyyu/ExnestJs-Starter/tree/main/engine/va-orm
- Issues: https://github.com/fazza-abiyyu/ExnestJs-Starter/issues
- License: MIT
