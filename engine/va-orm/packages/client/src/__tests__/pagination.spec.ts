// VA-ORM Pagination Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { OffsetPagination } from '../pagination/offset.js'
import { CursorPagination } from '../pagination/cursor.js'
import { KeysetPagination } from '../pagination/keyset.js'
import { MockDriver, testUsers } from '../../../../test-setup.js'

describe('Pagination', () => {
  let driver: MockDriver

  beforeEach(() => {
    driver = new MockDriver()
  })

  describe('OffsetPagination', () => {
    let pagination: OffsetPagination<any>

    beforeEach(() => {
      pagination = new OffsetPagination(driver, 'users')
    })

    it('should paginate with default options', async () => {
      driver.setResult({ rows: testUsers.slice(0, 10), rowCount: 10 })
      driver.setResult({ rows: [{ count: 30 }], rowCount: 1 })

      const result = await pagination.paginate()

      expect(result.items).toEqual(testUsers.slice(0, 10))
      expect(result.total).toBe(30)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(10)
      expect(result.totalPages).toBe(3)
      expect(result.hasNext).toBe(true)
      expect(result.hasPrevious).toBe(false)
    })

    it('should paginate with custom page and limit', async () => {
      driver.setResult({ rows: testUsers.slice(0, 2), rowCount: 2 })
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })

      const result = await pagination.paginate({ page: 2, limit: 2 })

      expect(result.page).toBe(2)
      expect(result.limit).toBe(2)
      expect(result.items.length).toBe(2)
    })

    it('should handle last page', async () => {
      driver.setResult({ rows: testUsers.slice(0, 1), rowCount: 1 })
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })

      const result = await pagination.paginate({ page: 5, limit: 2 })

      expect(result.totalPages).toBe(5)
      expect(result.hasNext).toBe(false)
      expect(result.hasPrevious).toBe(true)
    })

    it('should handle empty results', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      driver.setResult({ rows: [{ count: 0 }], rowCount: 1 })

      const result = await pagination.paginate()

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
      expect(result.totalPages).toBe(0)
      expect(result.hasNext).toBe(false)
      expect(result.hasPrevious).toBe(false)
    })

    it('should handle where clause', async () => {
      driver.setResult({ rows: testUsers.slice(0, 1), rowCount: 1 })
      driver.setResult({ rows: [{ count: 5 }], rowCount: 1 })

      const result = await pagination.paginate({ where: { status: 'active' } })

      expect(result.total).toBe(5)
    })

    it('should handle orderBy', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })
      driver.setResult({ rows: [{ count: 3 }], rowCount: 1 })

      const result = await pagination.paginate({ orderBy: { name: 'asc' } })

      expect(result.items).toEqual(testUsers)
    })

    it('should handle skip option', async () => {
      driver.setResult({ rows: testUsers.slice(1), rowCount: 2 })
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })

      const result = await pagination.paginate({ skip: 1, limit: 2 })

      expect(result.skip).toBe(1)
    })
  })

  describe('CursorPagination', () => {
    let pagination: CursorPagination<any>

    beforeEach(() => {
      pagination = new CursorPagination(driver, 'users', 'id')
    })

    it('should paginate forward without cursor', async () => {
      driver.setResult({ rows: [...testUsers, { id: 4 }], rowCount: 4 })

      const result = await pagination.paginate({ limit: 3 })

      expect(result.items).toEqual(testUsers)
      expect(result.hasMore).toBe(true)
      expect(result.hasPrevious).toBe(false)
      expect(result.nextCursor).toBe('3')
    })

    it('should paginate forward with cursor', async () => {
      driver.setResult({ rows: testUsers.slice(1), rowCount: 2 })

      const result = await pagination.paginate({ cursor: '1', limit: 2 })

      expect(result.items).toEqual(testUsers.slice(1))
      expect(result.hasPrevious).toBe(true)
    })

    it('should handle end of results', async () => {
      driver.setResult({ rows: testUsers.slice(0, 2), rowCount: 2 })

      const result = await pagination.paginate({ limit: 3 })

      expect(result.hasMore).toBe(false)
      expect(result.nextCursor).toBeUndefined()
    })

    it('should handle empty results', async () => {
      driver.setResult({ rows: [], rowCount: 0 })

      const result = await pagination.paginate({ cursor: '999' })

      expect(result.items).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('should handle where clause', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })

      const result = await pagination.paginate({ where: { status: 'active' } })

      expect(result.items).toEqual(testUsers)
    })

    it('should handle custom orderBy', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })

      const result = await pagination.paginate({ orderBy: { createdAt: 'desc' } })

      expect(result.items).toEqual(testUsers)
    })
  })

  describe('KeysetPagination', () => {
    let pagination: KeysetPagination<any>

    beforeEach(() => {
      pagination = new KeysetPagination(driver, 'users', ['id'])
    })

    it('should paginate forward without after', async () => {
      driver.setResult({ rows: [...testUsers, { id: 4 }], rowCount: 4 })

      const result = await pagination.paginate({ limit: 3 })

      expect(result.items).toEqual(testUsers)
      expect(result.hasMore).toBe(true)
      expect(result.hasPrevious).toBe(false)
      expect(result.nextAfter).toEqual({ id: 3 })
    })

    it('should paginate forward with after', async () => {
      driver.setResult({ rows: testUsers.slice(1), rowCount: 2 })

      const result = await pagination.paginate({ after: { id: 1 }, limit: 2 })

      expect(result.items).toEqual(testUsers.slice(1))
      expect(result.hasPrevious).toBe(true)
    })

    it('should handle end of results', async () => {
      driver.setResult({ rows: testUsers.slice(0, 2), rowCount: 2 })

      const result = await pagination.paginate({ limit: 3 })

      expect(result.hasMore).toBe(false)
      expect(result.nextAfter).toBeUndefined()
    })

    it('should handle empty results', async () => {
      driver.setResult({ rows: [], rowCount: 0 })

      const result = await pagination.paginate({ after: { id: 999 } })

      expect(result.items).toEqual([])
      expect(result.hasMore).toBe(false)
    })

    it('should handle multiple key columns', async () => {
      const multiPagination = new KeysetPagination(driver, 'users', ['id', 'createdAt'])
      driver.setResult({ rows: testUsers, rowCount: 3 })

      const result = await multiPagination.paginate({ limit: 3 })

      expect(result.items).toEqual(testUsers)
    })

    it('should handle where clause', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })

      const result = await pagination.paginate({ where: { status: 'active' } })

      expect(result.items).toEqual(testUsers)
    })

    it('should handle custom orderBy', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })

      const result = await pagination.paginate({ orderBy: { name: 'asc' } })

      expect(result.items).toEqual(testUsers)
    })
  })
})
