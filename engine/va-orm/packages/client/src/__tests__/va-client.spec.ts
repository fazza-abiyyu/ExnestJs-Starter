// VA-ORM VaClient Spec

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { VaClient } from '../core/va.client.js'

describe('VaClient', () => {
  let client: VaClient

  afterEach(async () => {
    if (client) {
      await client.disconnect()
    }
  })

  describe('creation', () => {
    it('should create client with SQLite', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      expect(client).toBeDefined()
    })

    it('should create client with models', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
        models: {
          User: { tableName: 'users' },
          Post: { tableName: 'posts' },
        },
      })
      expect(client).toBeDefined()
    })
  })

  describe('repository', () => {
    it('should get registered repository', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
        models: {
          User: { tableName: 'users' },
        },
      })
      const repo = client.repository('User')
      expect(repo).toBeDefined()
    })

    it('should throw for unregistered repository', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      try {
        client.repository('User')
        expect(true).toBe(false) // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('not registered')
      }
    })
  })

  describe('raw queries', () => {
    it('should execute raw query', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const result = await client.raw.query('SELECT 1 as value')
      expect(result).toBeDefined()
    })

    it('should execute raw one', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const result = await client.raw.queryOne('SELECT 1 as value')
      expect(result).toBeDefined()
    })

    it('should execute statement', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const result = await client.raw.execute('CREATE TABLE IF NOT EXISTS test (id INTEGER)')
      expect(result).toBeDefined()
    })
  })

  describe('sql tagged template', () => {
    it('should execute sql tagged template', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const result = await client.sql`SELECT 1 as value`
      expect(result).toBeDefined()
    })

    it('should execute sqlOne tagged template', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const result = await client.sqlOne`SELECT 1 as value`
      expect(result).toBeDefined()
    })
  })

  describe('CTE', () => {
    it('should create CTE builder', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const cte = client.cte()
      expect(cte).toBeDefined()
    })
  })

  describe('subquery', () => {
    it('should create subquery builder', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const subquery = client.subquery()
      expect(subquery).toBeDefined()
    })
  })

  describe('transaction', () => {
    it('should execute transaction', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const result = await client.transaction(async (txClient) => {
        return { success: true }
      })
      expect(result).toEqual({ success: true })
    })
  })

  describe('connection', () => {
    it('should connect', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      await client.connect()
      // No error means success
    })

    it('should disconnect', async () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      await client.connect()
      await client.disconnect()
      // No error means success
    })
  })

  describe('stats', () => {
    it('should return stats for pooled client', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: true,
      })
      const stats = client.getStats()
      expect(stats).toBeDefined()
    })

    it('should return undefined for non-pooled client', () => {
      client = VaClient.create({
        driver: 'sqlite',
        dsn: ':memory:',
        pooling: false,
      })
      const stats = client.getStats()
      expect(stats).toBeUndefined()
    })
  })
})
