# Database Drivers

Driver adapter untuk PostgreSQL, MySQL, dan SQLite.

## DatabaseDriver Interface

```typescript
interface DatabaseDriver {
  query<T>(sql: string, params?: any[]): Promise<QueryResult<T>>
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>
  transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T>
  close(): Promise<void>
  getPlaceholder(index: number): string
}
```

## PostgreSQL (`PostgresDriver`)

Menggunakan `pg` Pool.

### Installation

```bash
bun add pg
bun add -D @types/pg
```

### Usage

```typescript
import { PostgresDriver } from '@exnest/va/client/drivers/postgres'

const driver = new PostgresDriver({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 5000,
  ssl: { rejectUnauthorized: false },
  applicationName: 'my-app',
})
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | `string` | - | PostgreSQL connection URL |
| `max` | `number` | `10` | Max pool connections |
| `idleTimeoutMs` | `number` | `10000` | Idle connection timeout |
| `connectionTimeoutMs` | `number` | `5000` | Acquire timeout |
| `ssl` | `object \| boolean` | `false` | SSL configuration |
| `applicationName` | `string` | `'va-client'` | Application name |

### Placeholder

```sql
-- PostgreSQL uses $1, $2, $3, ...
SELECT * FROM users WHERE id = $1 AND status = $2
```

### Transaction

```typescript
async transaction<T>(fn: (driver) => Promise<T>): Promise<T> {
  const client = await this.pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(this)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
```

## MySQL (`MysqlDriver`)

Menggunakan `mysql2/promise`.

### Installation

```bash
bun add mysql2
```

### Usage

```typescript
import { MysqlDriver } from '@exnest/va/client/drivers/mysql'

const driver = new MysqlDriver({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'password',
  database: 'mydb',
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
})
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | `'localhost'` | MySQL host |
| `port` | `number` | `3306` | MySQL port |
| `user` | `string` | - | Username |
| `password` | `string` | - | Password |
| `database` | `string` | - | Database name |
| `connectionLimit` | `number` | `20` | Max pool connections |
| `waitForConnections` | `boolean` | `true` | Wait for available connection |
| `queueLimit` | `number` | `0` | Max queued requests (0 = unlimited) |

### Placeholder

```sql
-- MySQL uses ?
SELECT * FROM users WHERE id = ? AND status = ?
```

### Transaction

```typescript
async transaction<T>(fn: (driver) => Promise<T>): Promise<T> {
  const conn = await this.pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(this)
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}
```

## SQLite (`SqliteDriver`)

Menggunakan `bun:sqlite`.

### Installation

```bash
# No additional packages needed — bun:sqlite is built-in
```

### Usage

```typescript
import { SqliteDriver } from '@exnest/va/client/drivers/sqlite'

const driver = new SqliteDriver({
  filename: './data.db',
  readonly: false,
  create: true,
})
```

### Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `filename` | `string` | `':memory:'` | Database file path |
| `readonly` | `boolean` | `false` | Open in read-only mode |
| `create` | `boolean` | `true` | Create file if not exists |

### Features

- **WAL mode** — Enabled by default for better concurrent reads
- **Foreign keys** — Enabled by default
- **Synchronous** — All operations are synchronous (wrapped in async)

### Placeholder

```sql
-- SQLite uses ?
SELECT * FROM users WHERE id = ? AND status = ?
```

### Transaction

```typescript
async transaction<T>(fn: (driver) => Promise<T>): Promise<T> {
  return this.db.transaction(() => fn(this))()
}
```

## Driver Comparison

| Feature | PostgreSQL | MySQL | SQLite |
|---------|------------|-------|--------|
| Placeholder | `$1, $2, ...` | `?` | `?` |
| Connection pooling | `pg Pool` | `mysql2/promise` | Single connection |
| SSL support | Yes | Yes | No |
| Concurrent writes | Yes | Yes | WAL mode |
| Best for | Production | Production | Development/Testing |

## Custom Driver

Implement `DatabaseDriver` interface:

```typescript
import { DatabaseDriver, QueryResult } from '@exnest/va'

class MyDriver implements DatabaseDriver {
  async query<T>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    // Implement query
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    // Implement execute
  }

  async transaction<T>(fn: (driver: MyDriver) => Promise<T>): Promise<T> {
    // Implement transaction
  }

  async close(): Promise<void> {
    // Implement close
  }

  getPlaceholder(index: number): string {
    return `$${index}` // or `?` for MySQL/SQLite
  }
}
```
