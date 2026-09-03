# Testing Strategy

Bagaimana VA-ORM di-test.

## Overview

VA-ORM menggunakan **Bun's built-in test runner** dengan MockDriver untuk unit tests.

```
packages/client/src/__tests__/     # 14 test files
packages/schema/src/__tests__/     # 2 test files
packages/cli/src/__tests__/        # 2 test files
Total: 311 tests, 0 failures
```

## Test Setup

### MockDriver

Mock database driver yang merekam semua queries:

```typescript
// test-setup.ts
export class MockDriver {
  private queries: Array<{ sql: string; params?: any[] }> = []
  private results: any[] = []

  setResult(result: any) {
    this.results.push(result)
  }

  clearResults() {
    this.results = []
  }

  getQueries() {
    return this.queries
  }

  async query<T>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    this.queries.push({ sql, params })
    const result = this.results.shift() || { rows: [], rowCount: 0 }
    return result
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    this.queries.push({ sql, params })
    const result = this.results.shift() || { rowCount: 0 }
    return result
  }

  async transaction<T>(fn: (driver: MockDriver) => Promise<T>): Promise<T> {
    return fn(this)
  }

  async close(): Promise<void> {}

  getPlaceholder(index: number): string {
    return `$${index}`
  }
}
```

### Test Fixtures

```typescript
export const testUser = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  createdAt: new Date('2024-01-01'),
}

export const testUsers = [
  testUser,
  { id: 2, name: 'Jane Doe', email: 'jane@example.com', createdAt: new Date('2024-01-02') },
  { id: 3, name: 'Bob Smith', email: 'bob@example.com', createdAt: new Date('2024-01-03') },
]
```

### Preload Configuration

```toml
# bunfig.toml
[test]
preload = ["./test-setup.ts"]
coverage = true
coverage-dir = "./coverage"
coverage-reporter = ["text", "lcov"]
```

## Test Files

### Expression Builder Tests

```typescript
// expression.spec.ts
describe('ExpressionBuilder', () => {
  describe('comparison', () => {
    it('should build eq condition', () => {
      const eb = new ExpressionBuilder()
      eb.eq('status', 'active')
      const { sql, params } = eb.build()
      expect(sql).toBe('status = $1')
      expect(params).toEqual(['active'])
    })
  })

  describe('logical operators', () => {
    it('should build OR condition', () => {
      const eb = new ExpressionBuilder()
      eb.eq('status', 'active').or().eq('status', 'pending')
      const { sql, params } = eb.build()
      expect(sql).toBe('status = $1 OR status = $2')
      expect(params).toEqual(['active', 'pending'])
    })
  })

  describe('nested groups', () => {
    it('should handle nested groups', () => {
      const eb = new ExpressionBuilder()
      eb.eq('a', 1).group((g) => {
        g.eq('b', 2).group((gg) => {
          gg.eq('c', 3).or().eq('d', 4)
        })
      })
      const { sql, params } = eb.build()
      expect(sql).toBe('a = $1 AND (b = $2 AND (c = $3 OR d = $4))')
      expect(params).toEqual([1, 2, 3, 4])
    })
  })
})
```

### Query Builder Tests

```typescript
// query-builder.spec.ts
describe('QueryBuilder', () => {
  describe('SELECT queries', () => {
    it('should build select with alias', () => {
      const builder = new QueryBuilder(driver, 'users', 'u')
      builder.select('u.id', 'u.name')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT u.id, u.name FROM users AS u')
    })
  })

  describe('JOIN clauses', () => {
    it('should build inner join', () => {
      const builder = new QueryBuilder(driver, 'users')
      builder.join('posts', 'users.id = posts.userId')
      const { sql } = builder.build()
      expect(sql).toBe('SELECT * FROM users INNER JOIN posts ON users.id = posts.userId')
    })
  })
})
```

### Repository Tests

```typescript
// repository.spec.ts
describe('Repository', () => {
  it('should create a record', async () => {
    driver.setResult({ rows: [testUser], rowCount: 1 })
    const repo = new Repository(driver, { table: 'users', primaryKey: 'id' })
    const user = await repo.create({ name: 'John', email: 'john@example.com' })
    expect(user).toEqual(testUser)
  })

  it('should find many with where clause', async () => {
    driver.setResult({ rows: testUsers, rowCount: 3 })
    const repo = new Repository(driver, { table: 'users', primaryKey: 'id' })
    const users = await repo.findMany({
      where: (eb) => eb.eq('status', 'active'),
    })
    expect(users).toHaveLength(3)
  })
})
```

### Connection Pool Tests

```typescript
// connection-pool.spec.ts
describe('ConnectionPool', () => {
  it('should acquire and release connection', async () => {
    const pool = new ConnectionPool({
      driver: 'sqlite',
      dsn: ':memory:',
      max: 5,
      min: 1,
    })
    await pool.initialize()

    const conn = await pool.acquire()
    expect(conn).toBeDefined()

    pool.release(conn)
    const stats = pool.getStats()
    expect(stats.active).toBe(0)
    expect(stats.idle).toBe(1)

    await pool.close()
  })
})
```

### Pagination Tests

```typescript
// pagination.spec.ts
describe('OffsetPagination', () => {
  it('should paginate with default options', async () => {
    driver.setResult({ rows: testUsers, rowCount: 3 })
    driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })

    const pagination = new OffsetPagination(driver, {
      table: 'users',
      primaryKey: 'id',
    })

    const result = await pagination.paginate({ page: 1, limit: 3 })
    expect(result.items).toHaveLength(3)
    expect(result.total).toBe(10)
    expect(result.page).toBe(1)
    expect(result.totalPages).toBe(4)
    expect(result.hasNext).toBe(true)
    expect(result.hasPrevious).toBe(false)
  })
})
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test packages/client/src/__tests__/expression.spec.ts

# Run with timeout
bun test --timeout 30000

# Run with coverage
bun test --coverage

# Run specific describe block
bun test --grep "ExpressionBuilder"
```

## Coverage

Coverage reports are generated in text and lcov format:

```
┌───────────────────────────────────────────────────────────────┐
│ File                                    │ % Funcs │ % Lines │
├───────────────────────────────────────────────────────────────┤
│ All files                               │   54.34 │  71.09  │
│ packages/client/src/core/expression.ts  │   96.67 │ 100.00  │
│ packages/client/src/core/query-builder.ts│  82.86 │  84.66  │
│ packages/client/src/repository/repository.ts│ 96.83│  98.62  │
│ ...                                     │         │         │
└───────────────────────────────────────────────────────────────┘
```

## Test Patterns

### Mocking

```typescript
// Set single result
driver.setResult({ rows: [testUser], rowCount: 1 })

// Set multiple results (for sequential calls)
driver.setResult({ rows: testUsers, rowCount: 3 })
driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })

// Clear results
driver.clearResults()

// Get recorded queries
const queries = driver.getQueries()
expect(queries[0].sql).toBe('SELECT * FROM users')
expect(queries[0].params).toEqual(['active'])
```

### Assertions

```typescript
// SQL assertions
expect(sql).toBe('SELECT * FROM users WHERE status = $1')
expect(sql).toContain('INNER JOIN')
expect(sql).toMatch(/INSERT INTO users/)

// Param assertions
expect(params).toEqual(['active', 18])
expect(params).toHaveLength(2)

// Result assertions
expect(rows).toHaveLength(3)
expect(rows[0].name).toBe('John')
```

### Async/Await

```typescript
it('should async operation', async () => {
  driver.setResult({ rows: [testUser], rowCount: 1 })
  const result = await repo.findUnique({ id: 1 })
  expect(result).toEqual(testUser)
})
```

## Best Practices

1. **One test per behavior** — Each `it()` tests one specific behavior
2. **Arrange-Act-Assert** — Structure tests clearly
3. **Use descriptive names** — Test names should describe the expected behavior
4. **Mock at the boundary** — Mock the database driver, not internal logic
5. **Test edge cases** — Empty results, errors, boundary conditions
6. **Keep tests independent** — Tests should not depend on each other
7. **Clean up** — Use `beforeEach`/`afterEach` for setup/cleanup
