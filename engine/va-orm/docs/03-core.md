# Core Infrastructure

Komponen inti VA-ORM: types, expression builder, query builder, connection pool, dan va client.

## Types (`types.ts`)

Central type definitions untuk seluruh ORM.

```typescript
// Database driver interface
interface DatabaseDriver {
  query<T>(sql: string, params?: any[]): Promise<QueryResult<T>>
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>
  transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T>
  close(): Promise<void>
  getPlaceholder(index: number): string
}

// Connection configuration
interface ConnectionConfig {
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  ssl?: boolean
  max?: number           // Max connections (default: 10)
  min?: number           // Min connections (default: 2)
  idleTimeoutMs?: number // Idle timeout (default: 10000)
  connectionTimeoutMs?: number // Acquire timeout (default: 5000)
  maxLifetimeMs?: number // Max connection lifetime (default: 0 = unlimited)
  maxUses?: number       // Max uses per connection (default: 7500)
  healthCheck?: boolean  // Periodic health checks (default: true)
  retryAttempts?: number // Retry attempts (default: 3)
  retryDelayMs?: number  // Base retry delay (default: 1000)
}

// Filter operators
type FilterOperator =
  | '=' | '!=' | '>' | '>=' | '<' | '<='
  | 'LIKE' | 'NOT LIKE' | 'ILIKE' | 'NOT ILIKE'
  | 'IN' | 'NOT IN'
  | 'IS NULL' | 'IS NOT NULL'
  | 'BETWEEN' | 'NOT BETWEEN'
```

## ExpressionBuilder (`expression.ts`)

Fluent API untuk membangun WHERE clauses.

### Basic Usage

```typescript
import { ExpressionBuilder } from '@exnest/va'

const eb = new ExpressionBuilder()
eb.eq('status', 'active')
  .and()
  .gt('age', 18)

const { sql, params } = eb.build()
// sql: "status = $1 AND age > $2"
// params: ["active", 18]
```

### Methods

**Comparison:**
```typescript
eb.eq('name', 'John')        // name = $1
eb.neq('status', 'deleted')  // status != $1
eb.gt('age', 18)             // age > $1
eb.gte('score', 80)          // score >= $1
eb.lt('price', 100)          // price < $1
eb.lte('quantity', 10)       // quantity <= $1
```

**Pattern:**
```typescript
eb.like('name', '%John%')      // name LIKE $1
eb.notLike('name', '%test%')   // name NOT LIKE $1
eb.ilike('email', '%@gmail%')  // email ILIKE $1
```

**Null checks:**
```typescript
eb.isNull('deletedAt')      // deletedAt IS NULL
eb.isNotNull('email')       // email IS NOT NULL
```

**Set operations:**
```typescript
eb.in('status', ['active', 'pending'])  // status IN ($1, $2)
eb.notIn('role', ['admin'])             // role NOT IN ($1)
```

**Range:**
```typescript
eb.between('age', 18, 65)     // age BETWEEN $1 AND $2
eb.notBetween('score', 0, 50) // score NOT BETWEEN $1 AND $2
```

**Logical connectors:**
```typescript
eb.eq('a', 1).and().eq('b', 2)   // a = $1 AND b = $2
eb.eq('a', 1).or().eq('b', 2)    // a = $1 OR b = $2
eb.eq('a', 1).not().eq('b', 2)   // a = $1 NOT b = $2
```

**Nested groups:**
```typescript
eb.eq('status', 'active')
  .group((g) => {
    g.eq('role', 'admin').or().eq('role', 'moderator')
  })
// status = $1 AND (role = $2 OR role = $3)
```

**Raw SQL:**
```typescript
eb.raw('created_at > ?', '2024-01-01')
// created_at > $1
```

### Static Factories

```typescript
const eb = ExpressionBuilder.create()
const eb = ExpressionBuilder.create((i) => `?`)  // MySQL placeholder
const eb = ExpressionBuilder.from(clauses)
```

## QueryBuilder (`query-builder.ts`)

Fluent SQL query builder untuk SELECT, INSERT, UPDATE, DELETE.

### SELECT

```typescript
const qb = new QueryBuilder(driver, 'users', 'u')

qb.select('u.id', 'u.name', 'COUNT(p.id) as postCount')
  .leftJoin('posts', 'u.id = p.userId', 'p')
  .where((eb) => {
    eb.eq('u.status', 'active').and().gt('u.age', 18)
  })
  .groupBy('u.id', 'u.name')
  .having((eb) => eb.raw('COUNT(p.id) > ?', 5))
  .orderBy('postCount', 'desc')
  .limit(10)
  .offset(0)

const { sql, params } = qb.build()
// SELECT u.id, u.name, COUNT(p.id) as postCount
// FROM users AS u
// LEFT JOIN posts AS p ON u.id = p.userId
// WHERE u.status = $1 AND u.age > $2
// GROUP BY u.id, u.name
// HAVING COUNT(p.id) > $3
// ORDER BY postCount DESC
// LIMIT 10 OFFSET 0
```

### INSERT

```typescript
const { sql, params } = QueryBuilder.insert('users', {
  name: 'John',
  email: 'john@example.com',
})
// INSERT INTO users (name, email) VALUES ($1, $2)
```

### UPDATE

```typescript
const { sql, params } = QueryBuilder.update('users', { name: 'Jane' })
  .where((eb) => eb.eq('id', 1))
// UPDATE users SET name = $1 WHERE id = $2
```

### DELETE

```typescript
const { sql, params } = QueryBuilder.delete('users')
  .where((eb) => eb.eq('id', 1))
// DELETE FROM users WHERE id = $1
```

### JOIN Types

```typescript
qb.join('posts', 'users.id = posts.userId')      // INNER JOIN
qb.leftJoin('posts', 'users.id = posts.userId')   // LEFT JOIN
qb.rightJoin('posts', 'users.id = posts.userId')  // RIGHT JOIN
qb.crossJoin('roles')                              // CROSS JOIN
```

### Execution

```typescript
const rows = await qb.execute()      // Execute and return rows
const row = await qb.first()         // Execute and return first row
const count = await qb.count()       // Execute COUNT(*)
const exists = await qb.exists()     // Execute EXISTS(...)
```

## ConnectionPool (`connection.pool.ts`)

Production-grade connection pooling.

### Usage

```typescript
import { ConnectionPool } from '@exnest/va'

const pool = new ConnectionPool({
  driver: 'postgresql',
  dsn: process.env.DATABASE_URL,
  max: 20,
  min: 5,
  idleTimeoutMs: 30000,
  connectionTimeoutMs: 5000,
  maxUses: 7500,
  maxLifetimeMs: 3600000,
  healthCheck: true,
  retryAttempts: 3,
  retryDelayMs: 1000,
})

const conn = await pool.acquire()
try {
  await conn.query('SELECT * FROM users')
} finally {
  pool.release(conn)
}

await pool.close()
```

### Features

- **Min/Max connections** — Maintains minimum pool size, scales to max
- **Waiting queue** — Queues acquire requests when pool is exhausted
- **Connection rotation** — `maxUses` and `maxLifetimeMs` prevent stale connections
- **Health checks** — Periodic `SELECT 1` to verify connection health
- **Retry with backoff** — Automatic retry with exponential/fixed backoff
- **Acquire timeout** — Fails fast when pool is exhausted
- **Pool stats** — Real-time monitoring via `pool.getStats()`

### Pool Statistics

```typescript
const stats = pool.getStats()
// { total: 10, active: 5, idle: 3, waiting: 2 }
```

### Driver Factory Registration

```typescript
import { ConnectionPool } from '@exnest/va'

// Register custom driver factory
ConnectionPool.registerFactory('postgresql', (dsn) => new MyPostgresDriver(dsn))
```

## VaClient (`va.client.ts`)

Main facade/entry point untuk seluruh ORM.

### Usage

```typescript
import { VaClient } from '@exnest/va'

const client = await VaClient.create({
  driver: 'postgresql',
  dsn: process.env.DATABASE_URL,
  pooling: true,
  connection: {
    max: 20,
    min: 5,
    healthCheck: true,
  },
  models: {
    user: { table: 'users', primaryKey: 'id' },
    post: { table: 'posts', primaryKey: 'id' },
  },
})
```

### Repository Access

```typescript
const userRepo = client.repository('user')

// CRUD operations
const user = await userRepo.create({ name: 'John', email: 'john@example.com' })
const users = await userRepo.findMany({ where: (eb) => eb.eq('status', 'active') })
const user = await userRepo.findUnique({ id: 1 })
await userRepo.update({ id: 1 }, { name: 'Jane' })
await userRepo.delete({ id: 1 })
```

### Raw SQL

```typescript
// Direct query
const users = await client.query('SELECT * FROM users WHERE status = $1', ['active'])

// Tagged template
const users = await client.sql`SELECT * FROM users WHERE status = ${'active'}`
```

### CTE

```typescript
const cte = client.cte()
cte.withRecursive('tree', 'SELECT id, parent_id FROM categories WHERE parent_id IS NULL UNION ALL ...')
const results = await cte.select('SELECT * FROM tree').execute()
```

### Transaction

```typescript
await client.transaction(async (tx) => {
  const user = await tx.repository('user').create({ name: 'John' })
  await tx.repository('post').create({ title: 'Hello', userId: user.id })
})
```
