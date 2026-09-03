// VA-ORM Connection Pool Spec

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { ConnectionPool } from '../core/connection.pool.js'

describe('ConnectionPool', () => {
  let pool: ConnectionPool

  afterEach(async () => {
    if (pool) {
      await pool.close()
    }
  })

  describe('configuration', () => {
    it('should create pool with default config', () => {
      pool = new ConnectionPool('sqlite', ':memory:')
      const stats = pool.getStats()
      expect(stats.totalCount).toBeGreaterThanOrEqual(0)
    })

    it('should create pool with custom config', () => {
      pool = new ConnectionPool('sqlite', ':memory:', {
        max: 10,
        min: 2,
        idleTimeoutMs: 5000,
        connectionTimeoutMs: 3000,
      })
      const stats = pool.getStats()
      expect(stats.totalCount).toBeGreaterThanOrEqual(0)
    })
  })

  describe('acquire and release', () => {
    it('should acquire and release connection', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const driver = await pool.acquire()
      expect(driver).toBeDefined()
      await pool.release(driver)
    })

    it('should reuse released connections', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const driver1 = await pool.acquire()
      await pool.release(driver1)
      const driver2 = await pool.acquire()
      expect(driver2).toBe(driver1)
    })
  })

  describe('query', () => {
    it('should execute query through pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const result = await pool.query('SELECT 1 as value')
      expect(result.rows).toBeDefined()
      expect(result.rowCount).toBeGreaterThanOrEqual(0)
    })
  })

  describe('execute', () => {
    it('should execute statement through pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const result = await pool.execute('CREATE TABLE IF NOT EXISTS test (id INTEGER)')
      expect(result).toBeDefined()
    })
  })

  describe('transaction', () => {
    it('should execute transaction through pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const result = await pool.transaction(async (driver) => {
        return { success: true }
      })
      expect(result).toEqual({ success: true })
    })
  })

  describe('stats', () => {
    it('should return pool stats', () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const stats = pool.getStats()
      expect(stats).toHaveProperty('totalCount')
      expect(stats).toHaveProperty('idleCount')
      expect(stats).toHaveProperty('activeCount')
      expect(stats).toHaveProperty('waitingCount')
      expect(stats).toHaveProperty('totalQueries')
      expect(stats).toHaveProperty('totalErrors')
      expect(stats).toHaveProperty('avgQueryTimeMs')
      expect(stats).toHaveProperty('uptimeMs')
    })
  })

  describe('close', () => {
    it('should close pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      await pool.close()
      const stats = pool.getStats()
      expect(stats.totalCount).toBe(0)
    })

    it('should reject queries after close', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      await pool.close()
      try {
        await pool.query('SELECT 1')
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('closed')
      }
    })
  })
})
