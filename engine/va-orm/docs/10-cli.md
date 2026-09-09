# CLI Tools

Command-line tools untuk VA-ORM.

## Installation

```bash
# From project root
bun run va <command>

# Or link globally (after build)
npm link
va <command>
```

## Commands

### va validate

Validate schema file.

```bash
bun run va validate
bun run va validate --schema ./va.schema
```

#### Output

```
✓ Schema is valid
```

#### Process

1. Read schema file (default: `./va.schema`)
2. Parse with `SchemaParser.parse()`
3. Validate with `SchemaValidator.validate()`
4. Display errors (red) and warnings (yellow)
5. Exit code 1 if errors found

### va generate

Generate TypeScript types, client, and SQL from schema.

```bash
bun run va generate
bun run va generate --schema ./va.schema --output ./generated
bun run va generate --sql  # Also generate schema.sql
```

#### Output Files

```
generated/
├── types.ts        # TypeScript interfaces
├── client.ts       # VaClient subclass
└── schema.sql      # DDL (if --sql flag)
```

#### types.ts

Generates relation-aware TypeScript for each model:

```typescript
export interface User {
  id: number;
  email: string;
  name?: string;
  posts: Post[];
}

export type UserWhereInput = {
  AND?: UserWhereInput[];
  status?: string | { equals?: string; in?: string[]; contains?: string };
  posts?: {
    some?: PostWhereInput;
    every?: PostWhereInput;
    none?: PostWhereInput;
  };
};

export type UserSelect = {
  id?: boolean;
  email?: boolean;
};

export type UserInclude = {
  posts?: boolean | { where?: PostWhereInput; take?: number; include?: PostInclude };
};

export type UserCreateInput = {
  email: string;
  posts?: { create?: PostCreateWithoutAuthorInput | PostCreateWithoutAuthorInput[] };
};
```

Input types are `type` aliases (not `interface`) so they stay assignable to
the runtime `WhereInput`/`IncludeMap`. Nested `create` uses `XxxWithout<Rel>`
variants so required FK fields are not demanded when created through the relation.

#### client.ts

Generates VaClient subclass with typed per-model delegates. The schema AST
is embedded so the relation registry works without extra files:

```typescript
import { VaClientGenerated } from './generated/client'

const client = new VaClientGenerated({ connectionString: process.env.DATABASE_URL })

const users = await client.user.findMany({
  where: { posts: { some: { title: 'Hello' } } },
  select: { name: true },
  include: { posts: true },
})
// Fully typed: unknown fields/relations are compile errors
```

Generated code follows Exnest style (`.prettierrc`: single quotes,
semicolons, trailing commas, 2-space indent, 100 cols) — `prettier --check`
passes on `types.ts` and `client.ts` without reformatting.

## Verifying generated output

```bash
# 1. Generate from any schema
bun run va generate --output ./generated --sql

# 2. Style check (needs prettier)
bunx prettier --check generated/types.ts generated/client.ts

# 3. Type check (map the packages to source)
bunx tsc --noEmit -p tsconfig.check.json
```

#### schema.sql

Generates DDL SQL statements:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  role VARCHAR(255) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TYPE Role AS ENUM ('USER', 'ADMIN');
```

### va migrate

Database migration commands.

```bash
bun run va migrate up              # Apply pending migrations
bun run va migrate down            # Rollback last migration
bun run va migrate down --steps 3  # Rollback last 3 migrations
bun run va migrate reset           # Rollback all migrations
bun run va migrate status          # Show migration status
bun run va migrate create <name>   # Create new migration
bun run va migrate dev <name>      # Create + apply migration
bun run va migrate resolve <name> --to applied|rolled-back
bun run va db push                 # Push va.schema DDL directly
bun run va db pull                 # Introspect database to schema
```

#### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:pass@localhost/db

# Auto-detected from URL protocol:
# postgresql:// → PostgresDriver
# mysql:// → MysqlDriver
# file: → SqliteDriver
```

#### Status Output

```
Migration Status:
  Applied: 2
  Pending: 1

Applied:
  ✓ 20240101120000_create_users
  ✓ 20240102120000_create_posts

Pending:
  ○ 20240103120000_create_comments
```

## Programmatic API

```typescript
import { validateCommand, generateCommand, migrateCommand } from '@exnest/va/cli'

// Validate
await validateCommand({ schema: './va.schema' })

// Generate
await generateCommand({
  schema: './va.schema',
  output: './generated',
  sql: true,
})

// Migrate
await migrateCommand({
  command: 'up',
  migrationsDir: './migrations',
})
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Validation errors or migration failed |

## Color Output

- ✓ Green: Success messages
- ✗ Red: Errors
- ⚠ Yellow: Warnings
- ○ Blue: Info/pending items
