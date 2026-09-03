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
  })

  describe('count', () => {
    it('should count all records', async () => {
      driver.setResult({ rows: [{ count: 10 }], rowCount: 1 })
      const count = await aggregation.count()
      expect(count).toBe(10)
    })

    it('should count with where', async () => {
      driver.setResult({ rows: [{ count: 5 }], rowCount: 1 })
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

      const result = await aggregation.groupBy(['role'], { _count: true })
      expect(result).toEqual([
        { role: 'admin', _count: 5 },
        { role: 'user', _count: 20 },
      ])
    })

    it('should group by multiple fields', async () => {
      driver.setResult({
        rows: [
          { role: 'admin', status: 'active', _count: 3 },
          { role: 'admin', status: 'inactive', _count: 2 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy(['role', 'status'], { _count: true })
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

      const result = await aggregation.groupBy(['role'], {
        _sum: ['age'],
      })
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

      const result = await aggregation.groupBy(['role'], {
        _avg: ['age'],
      })
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

      const result = await aggregation.groupBy(['role'], {
        where: { status: 'active' },
        _count: true,
      })
      expect(result.length).toBe(1)
    })

    it('should group with orderBy', async () => {
      driver.setResult({
        rows: [
          { role: 'user', _count: 20 },
          { role: 'admin', _count: 5 },
        ],
        rowCount: 2,
      })

      const result = await aggregation.groupBy(['role'], {
        orderBy: { _count: 'desc' },
        _count: true,
      })
      expect(result[0]._count).toBe(20)
    })
  })
})
