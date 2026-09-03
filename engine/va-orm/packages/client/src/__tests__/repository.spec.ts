// VA-ORM Repository Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { Repository } from '../repository/repository.js'
import { MockDriver, testUser, testUsers } from '../../../../test-setup.js'

describe('Repository', () => {
  let driver: MockDriver
  let repo: Repository<typeof testUser>

  beforeEach(() => {
    driver = new MockDriver()
    repo = new Repository(driver, 'users')
  })

  describe('create', () => {
    it('should create a record', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.create({
        name: 'John Doe',
        email: 'john@example.com',
      })
      expect(result).toEqual(testUser)
      expect(driver.getQueries()[0].sql).toContain('INSERT INTO users')
    })

    it('should create multiple records', async () => {
      for (const user of testUsers) {
        driver.setResult({ rows: [user], rowCount: 1 })
      }
      const results = await repo.createMany(testUsers)
      expect(results).toEqual(testUsers)
      expect(driver.getQueries().length).toBe(3)
    })
  })

  describe('read', () => {
    it('should find unique record', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.findUnique({ id: 1 })
      expect(result).toEqual(testUser)
    })

    it('should return null when not found', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      const result = await repo.findUnique({ id: 999 })
      expect(result).toBeNull()
    })

    it('should find first record', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.findFirst({ status: 'active' })
      expect(result).toEqual(testUser)
    })

    it('should find many records', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })
      const results = await repo.findMany()
      expect(results).toEqual(testUsers)
    })

    it('should find many with where', async () => {
      driver.setResult({ rows: testUsers.slice(0, 2), rowCount: 2 })
      const results = await repo.findMany({ where: { status: 'active' } })
      expect(results.length).toBe(2)
    })

    it('should find many with orderBy', async () => {
      driver.setResult({ rows: testUsers, rowCount: 3 })
      const results = await repo.findMany({ orderBy: { name: 'asc' } })
      expect(results).toEqual(testUsers)
    })

    it('should find many with limit', async () => {
      driver.setResult({ rows: testUsers.slice(0, 2), rowCount: 2 })
      const results = await repo.findMany({ limit: 2 })
      expect(results.length).toBe(2)
    })

    it('should find many with offset', async () => {
      driver.setResult({ rows: testUsers.slice(1), rowCount: 2 })
      const results = await repo.findMany({ offset: 1 })
      expect(results.length).toBe(2)
    })
  })

  describe('update', () => {
    it('should update record', async () => {
      const updatedUser = { ...testUser, name: 'John Updated' }
      driver.setResult({ rows: [updatedUser], rowCount: 1 })
      const result = await repo.update({ id: 1 }, { name: 'John Updated' })
      expect(result).toEqual(updatedUser)
    })

    it('should update many records', async () => {
      driver.setResult({ rows: [], rowCount: 5 })
      const affected = await repo.updateMany({ status: 'active' }, { status: 'inactive' })
      expect(affected).toBe(5)
    })
  })

  describe('upsert', () => {
    it('should upsert record', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.upsert(
        { id: 1, name: 'John', email: 'john@example.com' },
        ['id'],
        ['name', 'email']
      )
      expect(result).toEqual(testUser)
    })
  })

  describe('delete', () => {
    it('should delete record', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.delete({ id: 1 })
      expect(result).toEqual(testUser)
    })

    it('should delete many records', async () => {
      driver.setResult({ rows: [], rowCount: 10 })
      const affected = await repo.deleteMany({ status: 'inactive' })
      expect(affected).toBe(10)
    })

    it('should delete all records when no where', async () => {
      driver.setResult({ rows: [], rowCount: 100 })
      const affected = await repo.deleteMany()
      expect(affected).toBe(100)
    })
  })

  describe('soft delete', () => {
    it('should soft delete when enabled', async () => {
      const softDeleteRepo = new Repository(driver, 'users', {
        softDelete: true,
        softDeleteColumn: 'deletedAt',
      })
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await softDeleteRepo.delete({ id: 1 })
      expect(result).toEqual(testUser)
      expect(driver.getQueries()[0].sql).toContain('SET deletedAt')
    })
  })

  describe('aggregate', () => {
    it('should count records', async () => {
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })
      const count = await repo.count()
      expect(count).toBe(10)
    })

    it('should count with where', async () => {
      driver.setResult({ rows: [{ count: 5 }], rowCount: 1 })
      const count = await repo.count({ status: 'active' })
      expect(count).toBe(5)
    })

    it('should check exists', async () => {
      driver.setResult({ rows: [{ count: 1 }], rowCount: 1 })
      const exists = await repo.exists({ id: 1 })
      expect(exists).toBe(true)
    })
  })

  describe('pagination', () => {
    it('should paginate with offset', async () => {
      driver.setResult({ rows: testUsers.slice(0, 2), rowCount: 2 })
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })

      const result = await repo.paginate({
        page: 1,
        limit: 2,
      })

      expect(result.items).toEqual(testUsers.slice(0, 2))
      expect(result.total).toBe(10)
      expect(result.page).toBe(1)
      expect(result.limit).toBe(2)
      expect(result.totalPages).toBe(5)
      expect(result.hasNext).toBe(true)
      expect(result.hasPrevious).toBe(false)
    })

    it('should paginate with cursor', async () => {
      driver.setResult({ rows: testUsers.slice(1), rowCount: 2 })

      const result = await repo.cursorPaginate({
        cursor: '1',
        limit: 2,
      })

      expect(result.items).toEqual(testUsers.slice(1))
      expect(result.hasMore).toBe(false)
      expect(result.hasPrevious).toBe(true)
    })
  })

  describe('raw queries', () => {
    it('should execute raw query', async () => {
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })
      const result = await repo.raw('SELECT COUNT(*) as count FROM users')
      expect(result).toEqual([{ count: 10 }])
    })

    it('should execute raw one', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.rawOne('SELECT * FROM users WHERE id = $1', [1])
      expect(result).toEqual(testUser)
    })

    it('should return null for rawOne when not found', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      const result = await repo.rawOne('SELECT * FROM users WHERE id = $1', [999])
      expect(result).toBeNull()
    })

    it('should execute raw execute', async () => {
      driver.setResult({ rows: [], rowCount: 5 })
      const affected = await repo.rawExecute('UPDATE users SET status = $1', ['inactive'])
      expect(affected).toBe(5)
    })
  })

  describe('transaction', () => {
    it('should execute transaction', async () => {
      driver.setResult({ rows: [testUser], rowCount: 1 })
      const result = await repo.transaction(async (txRepo) => {
        return txRepo.create({ name: 'John', email: 'john@example.com' })
      })
      expect(result).toEqual(testUser)
    })
  })

  describe('query builder', () => {
    it('should return query builder instance', () => {
      const builder = repo.query()
      expect(builder).toBeDefined()
    })
  })

  describe('expression builder', () => {
    it('should return expression builder instance', () => {
      const builder = repo.expression()
      expect(builder).toBeDefined()
    })
  })
})
