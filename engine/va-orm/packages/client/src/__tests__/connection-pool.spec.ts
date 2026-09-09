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
      expect(stats).toHaveProperty('slowQueries')
      expect(stats).toHaveProperty('avgQueryTimeMs')
      expect(stats).toHaveProperty('maxQueryTimeMs')
      expect(stats).toHaveProperty('uptimeMs')
    })
  })

  describe('health', () => {
    it('should report healthy with working driver', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      await expect(pool.isHealthy()).resolves.toBe(true)
    })

    it('should report unhealthy after close', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      await pool.close()
      await expect(pool.isHealthy()).resolves.toBe(false)
    })

    it('should ping with latency', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 })
      const { latencyMs } = await pool.ping()
      expect(latencyMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('slow queries', () => {
    it('should count slow queries and call handler', async () => {
      const slow: any[] = []
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 1,
        slowQueryThresholdMs: 0,
        onSlowQuery: (info) => slow.push(info),
      })
      await pool.query('SELECT 1')
      const stats = pool.getStats()
      expect(stats.slowQueries).toBe(1)
      expect(slow).toHaveLength(1)
      expect(slow[0].sql).toBe('SELECT 1')
      expect(slow[0].elapsedMs).toBeGreaterThanOrEqual(0)
    })

    it('should not count fast queries', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 1,
        slowQueryThresholdMs: 60000,
      })
      await pool.query('SELECT 1')
      expect(pool.getStats().slowQueries).toBe(0)
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
