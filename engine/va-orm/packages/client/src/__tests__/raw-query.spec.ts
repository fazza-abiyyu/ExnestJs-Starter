// VA-ORM Raw Query Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { RawQuery } from '../raw/raw-query.js'
import { MockDriver } from '../../../../test-setup.js'

describe('RawQuery', () => {
  let driver: MockDriver
  let raw: RawQuery

  beforeEach(() => {
    driver = new MockDriver()
    raw = new RawQuery(driver)
  })

  describe('query', () => {
    it('should execute raw query', async () => {
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })
      const result = await raw.query('SELECT COUNT(*) as count FROM users')
      expect(result).toEqual([{ count: 10 }])
    })

    it('should execute query with params', async () => {
      driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
      const result = await raw.query('SELECT * FROM users WHERE id = $1', [1])
      expect(result).toEqual([{ id: 1, name: 'John' }])
      expect(driver.getQueries()[0].params).toEqual([1])
    })
  })

  describe('queryOne', () => {
    it('should execute query and return first row', async () => {
      driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
      const result = await raw.queryOne('SELECT * FROM users WHERE id = $1', [1])
      expect(result).toEqual({ id: 1, name: 'John' })
    })

    it('should return null when no rows', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      const result = await raw.queryOne('SELECT * FROM users WHERE id = $1', [999])
      expect(result).toBeNull()
    })
  })

  describe('execute', () => {
    it('should execute statement', async () => {
      driver.setResult({ rows: [], rowCount: 5 })
      const affected = await raw.execute('UPDATE users SET status = $1', ['inactive'])
      expect(affected).toBe(5)
    })
  })

  describe('sql tagged template', () => {
    it('should execute tagged template query', async () => {
      driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
      const result = await raw.sql`SELECT * FROM users WHERE id = ${1}`
      expect(result).toEqual([{ id: 1 }])
      expect(driver.getQueries()[0].sql).toBe('SELECT * FROM users WHERE id = $1')
      expect(driver.getQueries()[0].params).toEqual([1])
    })

    it('should execute tagged template one', async () => {
      driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
      const result = await raw.sqlOne`SELECT * FROM users WHERE id = ${1}`
      expect(result).toEqual({ id: 1 })
    })

    it('should handle multiple parameters', async () => {
      driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
      const result = await raw.sql`SELECT * FROM users WHERE id = ${1} AND status = ${'active'}`
      expect(result).toEqual([{ id: 1 }])
      expect(driver.getQueries()[0].params).toEqual([1, 'active'])
    })
  })

  describe('transaction', () => {
    it('should execute in transaction', async () => {
      driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
      const result = await raw.transaction(async (txRaw) => {
        return txRaw.query('SELECT * FROM users WHERE id = $1', [1])
      })
      expect(result).toEqual([{ id: 1 }])
    })
  })
})
