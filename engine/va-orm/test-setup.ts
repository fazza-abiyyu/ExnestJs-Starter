// VA-ORM Test Setup

import { beforeAll, afterAll } from 'bun:test'
import { ConnectionPool } from './packages/client/src/core/connection.pool.js'

// Mock database driver for unit tests
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

  clearQueries() {
    this.queries = []
  }

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
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

ConnectionPool.registerFactory('sqlite', () => new MockDriver())
ConnectionPool.registerFactory('postgres', () => new MockDriver())
ConnectionPool.registerFactory('mysql', () => new MockDriver())

// Test data
export const testUser = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  createdAt: new Date('2024-01-01'),
}

export const testUsers = [
  testUser,
  {
    id: 2,
    name: 'Jane Doe',
    email: 'jane@example.com',
    createdAt: new Date('2024-01-02'),
  },
  {
    id: 3,
    name: 'Bob Smith',
    email: 'bob@example.com',
    createdAt: new Date('2024-01-03'),
  },
]
