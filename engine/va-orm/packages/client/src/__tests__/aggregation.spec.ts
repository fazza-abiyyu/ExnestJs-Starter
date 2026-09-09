// VA-ORM Aggregation Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { AggregationRepository } from '../repository/aggregation.js'
import { MockDriver } from '../../../../test-setup.js'

describe('AggregationRepository', () => {
  let driver: MockDriver
  let aggregation: AggregationRepository<any>

  beforeEach(() => {
    driver = new MockDriver()
    aggregation = new AggregationRepository(driver, 'users')
  })

  describe('aggregate', () => {
    it('should count all records', async () => {
      driver.setResult({ rows: [{ _count: 10 }], rowCount: 1 })
      const result = await aggregation.aggregate({ _count: true })
      expect(result).toEqual({ _count: 10 })
      expect(driver.getQueries()[0].sql).toBe('SELECT COUNT(*) as _count FROM "users"')
    })

    it('should sum fields', async () => {
      driver.setResult({ rows: [{ _sum_age: 250 }], rowCount: 1 })
      const result = await aggregation.aggregate({ _sum: ['age'] })
      expect(result).toEqual({ _sum_age: 250 })
    })

    it('should average fields', async () => {
      driver.setResult({ rows: [{ _avg_age: 25 }], rowCount: 1 })
      const result = await aggregation.aggregate({ _avg: ['age'] })
      expect(result).toEqual({ _avg_age: 25 })
    })

    it('should get min values', async () => {
      driver.setResult({ rows: [{ _min_age: 18 }], rowCount: 1 })
      const result = await aggregation.aggregate({ _min: ['age'] })
      expect(result).toEqual({ _min_age: 18 })
    })

    it('should get max values', async () => {
      driver.setResult({ rows: [{ _max_age: 65 }], rowCount: 1 })
      const result = await aggregation.aggregate({ _max: ['age'] })
      expect(result).toEqual({ _max_age: 65 })
    })

    it('should combine multiple aggregations', async () => {
      driver.setResult({
        rows: [{ _count: 100, _sum_age: 2500, _avg_age: 25 }],
        rowCount: 1,
      })
      const result = await aggregation.aggregate({
        _count: true,
        _sum: ['age'],
        _avg: ['age'],
      })
      expect(result).toEqual({
        _count: 100,
        _sum_age: 2500,
        _avg_age: 25,
      })
    })

    it('should filter with WhereInput operators', async () => {
      driver.setResult({ rows: [{ _count: 5 }], rowCount: 1 })
      const result = await aggregation.aggregate({
        where: { status: 'active', age: { gte: 18 } },
        _count: true,
      })
      expect(result).toEqual({ _count: 5 })
      const query = driver.getQueries()[0]
      expect(query.sql).toContain('WHERE "status" = $1 AND "age" >= $2')
      expect(query.params).toEqual(['active', 18])
    })
  })

  describe('count', () => {
    it('should count all records', async () => {
      driver.setResult({ rows: [{ _count: 10 }], rowCount: 1 })
      const count = await aggregation.count()
      expect(count).toBe(10)
    })

    it('should count with where', async () => {
      driver.setResult({ rows: [{ _count: 5 }], rowCount: 1 })
      const count = await aggregation.count({ status: 'active' })
      expect(count).toBe(5)
    })
  })

  describe('groupBy', () => {
    it('should group by single field', async () => {
      driver.setResult({
        rows: [
          { role: 'admin', _count: 5 },
          { role: 'user', _count: 20 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy({ by: ['role'], _count: true })
      expect(result).toEqual([
        { role: 'admin', _count: 5 },
        { role: 'user', _count: 20 },
      ])
      expect(driver.getQueries()[0].sql).toContain('GROUP BY "role"')
    })

    it('should group by multiple fields', async () => {
      driver.setResult({
        rows: [
          { role: 'admin', status: 'active', _count: 3 },
          { role: 'admin', status: 'inactive', _count: 2 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy({ by: ['role', 'status'], _count: true })
      expect(result.length).toBe(2)
    })

    it('should group with sum', async () => {
      driver.setResult({
        rows: [
          { role: 'admin', _sum_age: 125 },
          { role: 'user', _sum_age: 500 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy({ by: ['role'], _sum: ['age'] })
      expect(result).toEqual([
        { role: 'admin', _sum_age: 125 },
        { role: 'user', _sum_age: 500 },
      ])
    })

    it('should group with avg', async () => {
      driver.setResult({
        rows: [
          { role: 'admin', _avg_age: 35 },
          { role: 'user', _avg_age: 28 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy({ by: ['role'], _avg: ['age'] })
      expect(result).toEqual([
        { role: 'admin', _avg_age: 35 },
        { role: 'user', _avg_age: 28 },
      ])
    })

    it('should group with where', async () => {
      driver.setResult({
        rows: [{ role: 'admin', _count: 5 }],
        rowCount: 1,
      })

      const result = await aggregation.groupBy({
        by: ['role'],
        where: { status: 'active' },
        _count: true,
      })
      expect(result.length).toBe(1)
      expect(driver.getQueries()[0].sql).toContain('WHERE "status" = $1')
    })

    it('should group with orderBy', async () => {
      driver.setResult({
        rows: [
          { role: 'user', _count: 20 },
          { role: 'admin', _count: 5 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy({
        by: ['role'],
        orderBy: { role: 'desc' },
        _count: true,
      })
      expect(result[0]._count).toBe(20)
      expect(driver.getQueries()[0].sql).toContain('ORDER BY "role" DESC')
    })

    it('should group with having on _count', async () => {
      driver.setResult({ rows: [{ role: 'user', _count: 20 }], rowCount: 1 })

      const result = await aggregation.groupBy({
        by: ['role'],
        _count: true,
        having: { _count: { _all: { gt: 5 } } },
      })
      expect(result).toEqual([{ role: 'user', _count: 20 }])
      const query = driver.getQueries()[0]
      expect(query.sql).toContain('HAVING COUNT(*) > $1')
      expect(query.params).toEqual([5])
    })

    it('should group with having on field aggregate', async () => {
      driver.setResult({ rows: [{ role: 'user' }], rowCount: 1 })

      await aggregation.groupBy({
        by: ['role'],
        _sum: ['balance'],
        having: { _sum: { balance: { gte: 1000 } } },
      })
      const query = driver.getQueries()[0]
      expect(query.sql).toContain('HAVING SUM("balance") >= $1')
      expect(query.params).toEqual([1000])
    })

    it('should group with take and skip', async () => {
      driver.setResult({ rows: [], rowCount: 0 })
      await aggregation.groupBy({ by: ['role'], _count: true, take: 10, skip: 5 })
      const sql = driver.getQueries()[0].sql
      expect(sql).toContain('LIMIT 10')
      expect(sql).toContain('OFFSET 5')
    })

    it('should require non-empty by', async () => {
      await expect(aggregation.groupBy({ by: [], _count: true })).rejects.toThrow(
        'groupBy requires a non-empty "by" array'
      )
    })
  })
})
