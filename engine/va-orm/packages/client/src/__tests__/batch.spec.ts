// VA-ORM Batch Operations Spec

import { describe, it, expect, beforeEach } from 'bun:test'
import { BatchRepository } from '../repository/batch.js'
import { MockDriver, testUsers } from '../../../../test-setup.js'

describe('BatchRepository', () => {
  let driver: MockDriver
  let batch: BatchRepository<typeof testUsers[0]>

  beforeEach(() => {
    driver = new MockDriver()
    batch = new BatchRepository(driver, 'users', 2)
  })

  describe('createMany', () => {
    it('should create multiple records in batches', async () => {
      for (const user of testUsers) {
        driver.setResult({ rows: [user], rowCount: 1 })
      }
      const results = await batch.createMany(testUsers)
      expect(results).toEqual(testUsers)
    })

    it('should handle empty array', async () => {
      const results = await batch.createMany([])
      expect(results).toEqual([])
    })
  })

  describe('updateMany', () => {
    it('should update multiple records in batches', async () => {
      driver.setResult({ rows: [], rowCount: 1 })
      driver.setResult({ rows: [], rowCount: 1 })
      driver.setResult({ rows: [], rowCount: 1 })

      const updates = testUsers.map(user => ({
        where: { id: user.id },
        data: { status: 'inactive' },
      }))

      const affected = await batch.updateMany(updates)
      expect(affected).toBe(3)
    })
  })

  describe('deleteMany', () => {
    it('should delete multiple records in batches', async () => {
      driver.setResult({ rows: [], rowCount: 1 })
      driver.setResult({ rows: [], rowCount: 1 })
      driver.setResult({ rows: [], rowCount: 1 })

      const deletes = testUsers.map(user => ({ id: user.id }))
      const affected = await batch.deleteMany(deletes)
      expect(affected).toBe(3)
    })
  })

  describe('upsertMany', () => {
    it('should upsert multiple records in batches', async () => {
      for (const user of testUsers) {
        driver.setResult({ rows: [user], rowCount: 1 })
      }

      const data = testUsers.map(user => ({
        item: user,
        conflictColumns: ['id'],
        updateColumns: ['name', 'email'],
      }))

      const results = await batch.upsertMany(data)
      expect(results).toEqual(testUsers)
    })
  })

  describe('transaction', () => {
    it('should execute batch in transaction', async () => {
      driver.setResult({ rows: [testUsers[0]], rowCount: 1 })

      const result = await batch.transaction(async (txBatch) => {
        return txBatch.createMany([testUsers[0]])
      })

      expect(result).toEqual([testUsers[0]])
    })
  })
})
