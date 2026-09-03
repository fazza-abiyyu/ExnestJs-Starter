# Repository Layer

Generic Repository untuk CRUD operations.

## Repository<T>

Generic repository untuk satu model/table.

### Setup

```typescript
import { Repository } from '@exnest/va'

const userRepo = new Repository<{
  id: number
  name: string
  email: string
  status: string
  createdAt: Date
}>(driver, {
  table: 'users',
  primaryKey: 'id',
  softDeleteColumn: 'deletedAt', // optional
})
```

### CRUD Operations

#### create

```typescript
const user = await userRepo.create({
  name: 'John',
  email: 'john@example.com',
})
// INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *
```

#### createMany

```typescript
const count = await userRepo.createMany([
  { name: 'John', email: 'john@example.com' },
  { name: 'Jane', email: 'jane@example.com' },
])
// INSERT INTO users (name, email) VALUES ($1, $2), ($3, $4)
```

#### findUnique

```typescript
const user = await userRepo.findUnique({ id: 1 })
// SELECT * FROM users WHERE id = $1 LIMIT 1
```

#### findFirst

```typescript
const user = await userRepo.findFirst({
  where: (eb) => eb.eq('status', 'active'),
  orderBy: { column: 'createdAt', direction: 'desc' },
})
// SELECT * FROM users WHERE status = $1 ORDER BY createdAt DESC LIMIT 1
```

#### findMany

```typescript
const users = await userRepo.findMany({
  where: (eb) => {
    eb.eq('status', 'active').and().gt('age', 18)
  },
  orderBy: [
    { column: 'name', direction: 'asc' },
    { column: 'createdAt', direction: 'desc' },
  ],
  limit: 10,
  offset: 0,
})
```

#### update

```typescript
await userRepo.update({ id: 1 }, { name: 'Jane' })
// UPDATE users SET name = $1 WHERE id = $2
```

#### updateMany

```typescript
const count = await userRepo.updateMany(
  { status: 'active' },
  { status: 'inactive' }
)
// UPDATE users SET status = $1 WHERE status = $2
```

#### upsert

```typescript
const user = await userRepo.upsert(
  { email: 'john@example.com' },  // where
  { name: 'John', email: 'john@example.com' },  // create
  { name: 'John Updated' }  // update
)
// INSERT INTO users (name, email) VALUES ($1, $2)
// ON CONFLICT (email) DO UPDATE SET name = $3
```

#### delete

```typescript
await userRepo.delete({ id: 1 })
// DELETE FROM users WHERE id = $1

// With soft delete (if configured)
await userRepo.delete({ id: 1 })
// UPDATE users SET deletedAt = NOW() WHERE id = $1
```

#### deleteMany

```typescript
const count = await userRepo.deleteMany({
  where: (eb) => eb.eq('status', 'inactive'),
})
```

### Query Helpers

#### count

```typescript
const total = await userRepo.count({
  where: (eb) => eb.eq('status', 'active'),
})
// SELECT COUNT(*) FROM users WHERE status = $1
```

#### exists

```typescript
const exists = await userRepo.exists({
  where: (eb) => eb.eq('email', 'john@example.com'),
})
// SELECT EXISTS(SELECT 1 FROM users WHERE email = $1)
```

### Pagination

#### Offset Pagination

```typescript
const result = await userRepo.paginate({
  page: 1,
  limit: 10,
  where: (eb) => eb.eq('status', 'active'),
  orderBy: { column: 'createdAt', direction: 'desc' },
})
// { items: User[], total: number, page: number, totalPages: number, hasNext: boolean }
```

#### Cursor Pagination

```typescript
const result = await userRepo.cursorPaginate({
  cursor: 'eyJpZCI6MTB9',
  limit: 10,
  cursorColumn: 'id',
  direction: 'forward',
})
// { items: User[], nextCursor: string | null, hasMore: boolean }
```

### Query Builder Access

```typescript
// Get QueryBuilder for custom queries
const qb = userRepo.query()
const users = await qb
  .select('u.id', 'u.name', 'COUNT(p.id) as postCount')
  .leftJoin('posts', 'u.id = p.userId', 'p')
  .groupBy('u.id', 'u.name')
  .execute()

// Get ExpressionBuilder for custom expressions
const eb = userRepo.expression()
```

### Transaction

```typescript
await userRepo.transaction(async (tx) => {
  const user = await tx.create({ name: 'John' })
  await tx.update({ id: user.id }, { status: 'active' })
})
```

### Raw Query

```typescript
const users = await userRepo.raw('SELECT * FROM users WHERE status = $1', ['active'])
const user = await userRepo.rawOne('SELECT * FROM users WHERE id = $1', [1])
await userRepo.rawExecute('UPDATE users SET status = $1', ['active'])
```

## BatchRepository<T>

Chunked bulk operations untuk dataset besar.

### Setup

```typescript
import { BatchRepository } from '@exnest/va'

const batchRepo = new BatchRepository(userRepo, {
  batchSize: 100, // default: 100
})
```

### Methods

```typescript
// Batch create
const count = await batchRepo.createMany(users)

// Batch update
const count = await batchRepo.updateMany(
  { where: { status: 'active' } },
  { status: 'inactive' }
)

// Batch delete
const count = await batchRepo.deleteMany({
  where: { status: 'inactive' }
})

// Batch upsert
const count = await batchRepo.upsertMany(
  users,
  (item) => ({ email: item.email }), // where
  (item) => item, // create
  (item) => item  // update
)
```

## AggregationRepository<T>

SQL aggregation operations.

### Setup

```typescript
import { AggregationRepository } from '@exnest/va'

const aggRepo = new AggregationRepository(driver, 'users')
```

### Methods

```typescript
// Aggregate with multiple functions
const result = await aggRepo.aggregate({
  _count: true,
  _sum: ['salary', 'bonus'],
  _avg: ['salary'],
  _min: ['age'],
  _max: ['age'],
  where: (eb) => eb.eq('status', 'active'),
})
// { _count: 100, _sum: { salary: 5000000, bonus: 500000 }, _avg: { salary: 50000 }, ... }

// Simple count
const total = await aggRepo.count({
  where: (eb) => eb.eq('status', 'active'),
})

// Group by
const groups = await aggRepo.groupBy({
  by: ['department', 'role'],
  select: ['department', 'role'],
  _count: true,
  _avg: ['salary'],
  where: (eb) => eb.eq('status', 'active'),
  having: (eb) => eb.raw('COUNT(*) > ?', 5),
  orderBy: { column: 'department', direction: 'asc' },
})
```
