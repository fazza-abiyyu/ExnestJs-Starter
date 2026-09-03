# Pagination

Tiga strategi pagination: offset, cursor, dan keyset.

## OffsetPagination

Page-based pagination (traditional).

### Usage

```typescript
import { OffsetPagination } from '@exnest/va'

const pagination = new OffsetPagination(driver, {
  table: 'users',
  primaryKey: 'id',
})

const result = await pagination.paginate({
  page: 1,
  limit: 10,
  where: (eb) => eb.eq('status', 'active'),
  orderBy: { column: 'createdAt', direction: 'desc' },
})
```

### Result

```typescript
interface OffsetResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}
```

### Example

```typescript
const result = await pagination.paginate({ page: 2, limit: 10 })

console.log(result.items)       // Array of items
console.log(result.total)       // Total count
console.log(result.page)        // Current page (2)
console.log(result.totalPages)  // Total pages
console.log(result.hasNext)     // true if more pages
console.log(result.hasPrevious) // true if not first page
```

## CursorPagination

Cursor-based pagination for infinite scroll.

### Usage

```typescript
import { CursorPagination } from '@exnest/va'

const pagination = new CursorPagination(driver, {
  table: 'users',
  primaryKey: 'id',
  cursorColumn: 'id', // default: 'id'
})

// First page
const first = await pagination.paginate({
  limit: 10,
  direction: 'forward',
})

// Next page
const next = await pagination.paginate({
  limit: 10,
  cursor: first.nextCursor,
  direction: 'forward',
})

// Previous page
const prev = await pagination.paginate({
  limit: 10,
  cursor: first.previousCursor,
  direction: 'backward',
})
```

### Result

```typescript
interface CursorResult<T> {
  items: T[]
  nextCursor: string | null
  previousCursor: string | null
  hasMore: boolean
}
```

### How It Works

1. Fetch `limit + 1` rows to detect if more exist
2. If more rows exist, create cursor from last row's cursor column
3. Cursor is base64-encoded for safe transport
4. Next query uses `WHERE cursor_column > $1 ORDER BY cursor_column ASC LIMIT $2`

## KeysetPagination

Composite key pagination for high performance.

### Usage

```typescript
import { KeysetPagination } from '@exnest/va'

const pagination = new KeysetPagination(driver, {
  table: 'users',
  primaryKey: 'id',
  keyColumns: ['createdAt', 'id'], // composite key
})

const result = await pagination.paginate({
  limit: 10,
  after: { createdAt: '2024-01-01', id: 100 },
  orderBy: [
    { column: 'createdAt', direction: 'desc' },
    { column: 'id', direction: 'desc' },
  ],
})
```

### Result

```typescript
interface KeysetResult<T> {
  items: T[]
  nextAfter: Record<string, any> | null
  hasMore: boolean
}
```

### How It Works

1. Fetch `limit + 1` rows
2. Apply composite keyset filtering:
   - Equality on preceding columns
   - Comparison on last column
3. Returns `nextAfter` record for next page

### Example

```typescript
// Page 1
const page1 = await pagination.paginate({ limit: 10 })
// items: [...], nextAfter: { createdAt: '2024-01-15', id: 50 }

// Page 2
const page2 = await pagination.paginate({
  limit: 10,
  after: page1.nextAfter,
})
```

## Protocol Adapters

Convert pagination results to standard API formats.

### REST Adapter

```typescript
import { RestAdapter } from '@exnest/va'

const response = RestAdapter.fromOffset(result, {
  baseUrl: '/api/users',
  page: 1,
  limit: 10,
})

// {
//   data: [...],
//   meta: { total: 100, page: 1, limit: 10, totalPages: 10 },
//   links: {
//     self: '/api/users?page=1&limit=10',
//     next: '/api/users?page=2&limit=10',
//     prev: '/api/users?page=0&limit=10',
//     first: '/api/users?page=1&limit=10',
//     last: '/api/users?page=10&limit=10',
//   }
// }
```

### GraphQL Adapter (Relay Connection)

```typescript
import { GraphQLAdapter } from '@exnest/va'

const connection = GraphQLAdapter.fromOffset(result, {
  encodeCursor: (id) => Buffer.from(`cursor:${id}`).toString('base64'),
})

// {
//   edges: [
//     { node: {...}, cursor: "Y3Vyc29yOjE=" },
//     ...
//   ],
//   pageInfo: {
//     hasNextPage: true,
//     hasPreviousPage: false,
//     startCursor: "Y3Vyc29yOjE=",
//     endCursor: "Y3Vyc29yOjEw",
//   },
//   totalCount: 100
// }
```

### OData Adapter

```typescript
import { ODataAdapter } from '@exnest/va'

const response = ODataAdapter.fromOffset(result, {
  baseUrl: '/api/users',
  top: 10,
  skip: 0,
})

// {
//   value: [...],
//   "@odata.count": 100,
//   "@odata.nextLink": "/api/users?$top=10&$skip=10"
// }
```

## Comparison

| Feature | Offset | Cursor | Keyset |
|---------|--------|--------|--------|
| Page jumping | Yes | No | No |
| Performance | O(n) | O(1) | O(1) |
| Consistency | Low (skip drift) | High | High |
| Use case | Admin panels | Infinite scroll | High-perf APIs |
| API format | `?page=2&limit=10` | `?cursor=abc&limit=10` | `?after=...&limit=10` |

## Parsing Utilities

### REST

```typescript
const { page, limit, sort, fields } = RestAdapter.parseParams(request.query)
// page: 1, limit: 10, sort: [{ column: 'name', direction: 'asc' }], fields: ['id', 'name']
```

### GraphQL

```typescript
const options = GraphQLAdapter.toCursorOptions({
  first: 10,
  after: 'Y3Vyc29yOjU=',
  last: null,
  before: null,
})
// { limit: 10, cursor: '5', direction: 'forward' }
```

### OData

```typescript
const options = ODataAdapter.parseODataParams({
  $top: '10',
  $skip: '20',
  $filter: "status eq 'active'",
  $orderby: 'name asc',
})
// { limit: 10, skip: 20, where: ..., orderBy: ... }
```
