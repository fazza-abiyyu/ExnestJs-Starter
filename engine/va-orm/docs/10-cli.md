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

Generates TypeScript interfaces for each model:

```typescript
export interface User {
  id: number
  email: string
  name?: string
  role: string
  createdAt: Date
}

export interface UserCreateInput {
  email: string
  name?: string
}

export interface UserUpdateInput {
  id?: number | { increment: number } | { decrement: number }
  email?: string | { set: string }
  name?: string | { set: string }
}

export interface UserWhereInput {
  id?: number | { equals: number } | { not: number } | { in: number[] }
  email?: string | { equals: string } | { contains: string } | { startsWith: string }
  name?: string | { equals: string } | { contains: string }
}
```

#### client.ts

Generates VaClient subclass with typed repository accessors:

```typescript
import { VaClient, Repository } from '@exnest/va-client'

export class GeneratedClient extends VaClient {
  constructor(options: VaClientOptions) {
    super(options)
    this.registerModel('user', { table: 'users', primaryKey: 'id' })
  }

  get user(): Repository<User> {
    return this.repository<User>('user')
  }
}
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
