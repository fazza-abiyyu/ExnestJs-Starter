# Migration System

SQL file-based migration system.

## Migrator

Handles database migrations with up/down/reset/status operations.

### Setup

```typescript
import { Migrator } from '@exnest/va'

const migrator = new Migrator(driver, {
  migrationsDir: './migrations',
  tableName: '_va_migrations', // default
})
```

### Initialize

```typescript
await migrator.initialize()
// Creates _va_migrations table if not exists
```

### Commands

#### migrate (up)

```typescript
// Apply all pending migrations
const applied = await migrator.migrate()
console.log(applied) // ['20240101_create_users', '20240102_create_posts']
```

#### dev (create + apply)

```typescript
// Create migration file and immediately apply pending migrations
const { file, applied } = await migrator.dev(
  'add_users_table',
  'CREATE TABLE users (id SERIAL PRIMARY KEY)'
)
```

#### resolve

```typescript
// Mark a failed/stuck migration without running SQL
await migrator.resolve('20240101_create_users', 'applied')
await migrator.resolve('20240101_create_users', 'rolled-back')
```

#### rollback (down)

```typescript
// Rollback last migration
await migrator.rollback()

// Rollback last N migrations
await migrator.rollback(3)
```

#### reset

```typescript
// Rollback all applied migrations
await migrator.reset()
```

#### status

```typescript
const status = await migrator.status()
// {
//   applied: ['20240101_create_users', '20240102_create_posts'],
//   pending: ['20240103_create_comments'],
//   total: 3, appliedCount: 2, pendingCount: 1
// }
```

#### create

```typescript
const name = await migrator.createMigration('add_email_index')
// Creates: migrations/20240103120000_add_email_index.sql
```

## db push

Apply `va.schema` DDL directly without migration files:

```bash
bun run va db push
bun run va db push --schema ./va.schema
```

```typescript
import { pushCommand } from '@exnest/va/cli'

await pushCommand({ schema: './va.schema' })
// Reads DATABASE_URL, detects provider, executes DDL
```

## db pull

Introspect a live database into `va.schema` text:

```bash
bun run va db pull
bun run va db pull --output ./va.pulled.schema
bun run va db pull --schemas public,tenancy
```

```typescript
import { SchemaIntrospector } from '@exnest/va/cli'

const introspector = new SchemaIntrospector(driver, 'postgres', ['public'])
const tables = await introspector.introspect()
const schema = introspector.toSchema(tables, 'postgresql')
```

Introspection maps column types back to scalars (`varchar` → `String`,
`serial` → `Int` + `@default(autoincrement())`), primary keys to `@id`,
unique constraints to `@unique`, indexes to `@@index`, foreign keys to
`@relation(...)`, and emits `@@map` for table names. Model names are
PascalCase singular (`user_sessions` → `UserSession`).

## Migration Files

### Structure

```sql
-- Up migration
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- Down migration
DROP TABLE users;
```

### Naming Convention

```
YYYYMMDDHHMMSS_description.sql
20240101120000_create_users.sql
20240102120000_create_posts.sql
20240103120000_add_email_index.sql
```

### Parsing

The migrator parses `-- Up migration` and `-- Down migration` sections:

```sql
-- Up migration
CREATE TABLE users (id SERIAL PRIMARY KEY);

-- Down migration
DROP TABLE users;
```

## MigrationTracker

Enhanced tracking with checksums and execution time.

### Setup

```typescript
import { MigrationTracker } from '@exnest/va'

const tracker = new MigrationTracker(driver, {
  tableName: '_va_migrations',
})
```

### Methods

```typescript
// Record migration
await tracker.record('20240101_create_users', checksum, executionTimeMs)

// Remove migration record
await tracker.remove('20240101_create_users')

// Get applied migrations
const applied = await tracker.getApplied()
// [{ name: '20240101_create_users', checksum: '...', appliedAt: Date, executionTimeMs: 123 }]

// Check if migration is applied
const isApplied = await tracker.isApplied('20240101_create_users')

// Get checksum
const checksum = await tracker.getChecksum('20240101_create_users')

// Verify integrity
const isValid = await tracker.verify('20240101_create_users', currentChecksum)

// Check for conflicts
const conflicts = await tracker.hasConflicts()
```

### Checksum Verification

The tracker verifies migration integrity by comparing checksums:

1. When recording, stores SHA-256 checksum of migration SQL
2. When verifying, compares stored checksum with current file checksum
3. Detects if migration file was modified after being applied

## Auto-Detection

The `MigrateCommand` auto-detects driver from `DATABASE_URL`:

```bash
# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost/db va migrate up

# MySQL
DATABASE_URL=mysql://user:pass@localhost/db va migrate up

# SQLite
DATABASE_URL=file:./data.db va migrate up
```

## CLI Usage

```bash
# Apply all pending migrations
va migrate up

# Rollback last migration
va migrate down

# Rollback last 3 migrations
va migrate down 3

# Reset all migrations
va migrate reset

# Show migration status
va migrate status

# Create new migration
va migrate create add_users_table
```

## Best Practices

1. **One change per migration** — Keep migrations focused
2. **Test rollbacks** — Always test both up and down
3. **Never modify applied migrations** — Use new migrations for changes
4. **Use transactions** — Wrap DDL in transactions when supported
5. **Version control** — Commit migration files to git
6. **Backup before production** — Always backup before running migrations
