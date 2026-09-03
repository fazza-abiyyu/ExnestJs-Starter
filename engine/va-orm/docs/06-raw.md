# Raw SQL

Raw SQL execution, CTE, dan subquery builders.

## RawQuery

Direct SQL execution dengan parameterized queries.

### Usage

```typescript
import { RawQuery } from '@exnest/va'

const raw = new RawQuery(driver)

// Query rows
const users = await raw.query('SELECT * FROM users WHERE status = $1', ['active'])

// Query single row
const user = await raw.queryOne('SELECT * FROM users WHERE id = $1', [1])

// Execute (INSERT/UPDATE/DELETE)
const result = await raw.execute('UPDATE users SET status = $1 WHERE id = $2', ['inactive', 1])
// { rowCount: 1 }
```

### Tagged Template

```typescript
// sql tagged template
const users = await raw.sql`SELECT * FROM users WHERE status = ${'active'}`
const user = await raw.sqlOne`SELECT * FROM users WHERE id = ${1}`
```

### Transaction

```typescript
await raw.transaction(async (tx) => {
  await tx.execute('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1])
  await tx.execute('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2])
})
```

## CTEBuilder

Common Table Expression builder untuk complex queries.

### Basic CTE

```typescript
const cte = new CTEBuilder(driver)

cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
const { sql, params } = cte.select('SELECT * FROM active_users WHERE age > $1', [18])
// WITH active_users AS (SELECT * FROM users WHERE status = $1)
// SELECT * FROM active_users WHERE age > $2
```

### Recursive CTE

```typescript
cte.withRecursive(
  'category_tree',
  `SELECT id, name, parent_id FROM categories WHERE parent_id IS NULL
   UNION ALL
   SELECT c.id, c.name, c.parent_id
   FROM categories c
   JOIN category_tree ct ON c.parent_id = ct.id`,
  []
)
const results = await cte.select('SELECT * FROM category_tree').execute()
// WITH RECURSIVE category_tree AS (...)
// SELECT * FROM category_tree
```

### Materialized CTE

```typescript
cte.with('stats', 'SELECT COUNT(*) as total FROM users', [], {
  materialized: true, // or false for NOT MATERIALIZED
})
```

### Column List

```typescript
cte.with('user_stats', 'SELECT id, COUNT(*) as post_count FROM posts GROUP BY id', [], {
  columns: ['id', 'post_count'],
})
// WITH user_stats (id, post_count) AS (...)
```

### Full Example

```typescript
const cte = new CTEBuilder(driver)

cte.with('active_users', 'SELECT * FROM users WHERE status = $1', ['active'])
cte.with('recent_posts', 'SELECT * FROM posts WHERE created_at > NOW() - INTERVAL \'7 days\'')

const results = await cte
  .select(`
    SELECT u.name, COUNT(p.id) as post_count
    FROM active_users u
    LEFT JOIN recent_posts p ON u.id = p.user_id
    GROUP BY u.id, u.name
  `)
  .execute()
```

## SubqueryBuilder

Utility untuk subquery construction.

### Basic Usage

```typescript
const sub = new SubqueryBuilder(driver)

// Subquery in WHERE clause
const qb = new QueryBuilder(driver, 'users')
qb.where((eb) => {
  eb.inSubquery('id', sub.fromRaw(
    'SELECT user_id FROM posts WHERE status = $1', ['published']
  ))
})
// WHERE id IN (SELECT user_id FROM posts WHERE status = $1)
```

### Methods

```typescript
// IN subquery
sub.inSubquery('id', subquery)
// id IN (SELECT ...)

// NOT IN subquery
sub.notInSubquery('id', subquery)
// id NOT IN (SELECT ...)

// EXISTS subquery
sub.exists(subquery)
// EXISTS (SELECT ...)

// NOT EXISTS subquery
sub.notExists(subquery)
// NOT EXISTS (SELECT ...)

// Scalar subquery
sub.asColumn(subquery)
// (SELECT ...)

// Derived table
sub.asTable(subquery, 'alias')
// (SELECT ...) AS alias
```

### From QueryBuilder

```typescript
const innerQb = new QueryBuilder(driver, 'posts')
  .select('user_id')
  .where((eb) => eb.eq('status', 'published'))

const sub = SubqueryBuilder.fromQueryBuilder(innerQb)
// (SELECT user_id FROM posts WHERE status = $1)
```

### From Raw SQL

```typescript
const sub = SubqueryBuilder.fromRaw(
  'SELECT user_id FROM posts WHERE created_at > $1',
  [lastWeek]
)
```

### Aggregate Subqueries

```typescript
// COUNT subquery
const countSub = SubqueryBuilder.countSubquery(
  new QueryBuilder(driver, 'posts').where((eb) => eb.eq('user_id', 'users.id'))
)
// (SELECT COUNT(*) FROM posts WHERE user_id = users.id)

// SUM subquery
const sumSub = SubqueryBuilder.sumSubquery(qb, 'amount')

// AVG subquery
const avgSub = SubqueryBuilder.avgSubquery(qb, 'score')

// MIN subquery
const minSub = SubqueryBuilder.minSubquery(qb, 'created_at')

// MAX subquery
const maxSub = SubqueryBuilder.maxSubquery(qb, 'created_at')
```

### Full Example

```typescript
const sub = new SubqueryBuilder(driver)

// Find users with more than 10 published posts
const qb = new QueryBuilder(driver, 'users')
qb.where((eb) => {
  eb.gt(
    sub.asColumn(
      SubqueryBuilder.countSubquery(
        new QueryBuilder(driver, 'posts')
          .where((eb) => eb.raw('posts.user_id = users.id'))
          .where((eb) => eb.eq('status', 'published'))
      )
    ),
    10
  )
})
// WHERE (SELECT COUNT(*) FROM posts WHERE posts.user_id = users.id AND status = $1) > $2
```
