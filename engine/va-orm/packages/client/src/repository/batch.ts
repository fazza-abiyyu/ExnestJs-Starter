// VA-ORM Batch Operations

import type { DatabaseDriver } from '../core/types.js'
import { Repository } from './repository.js'

export class BatchRepository<T extends Record<string, any>> {
  constructor(
    private driver: DatabaseDriver,
    private tableName: string,
    private batchSize: number = 100
  ) {}

  async createMany(data: Partial<T>[]): Promise<T[]> {
    const results: T[] = []
    const repo = new Repository<T>(this.driver, this.tableName)

    for (let i = 0; i < data.length; i += this.batchSize) {
      const batch = data.slice(i, i + this.batchSize)
      const batchResults = await repo.createMany(batch)
      results.push(...batchResults)
    }

    return results
  }

  async updateMany(updates: Array<{ where: Partial<T>; data: Partial<T> }>): Promise<number> {
    let totalAffected = 0
    const repo = new Repository<T>(this.driver, this.tableName)

    for (let i = 0; i < updates.length; i += this.batchSize) {
      const batch = updates.slice(i, i + this.batchSize)
      for (const { where, data } of batch) {
        const affected = await repo.updateMany(where, data)
        totalAffected += affected
      }
    }

    return totalAffected
  }

  async deleteMany(deletes: Array<Partial<T>>): Promise<number> {
    let totalDeleted = 0
    const repo = new Repository<T>(this.driver, this.tableName)

    for (let i = 0; i < deletes.length; i += this.batchSize) {
      const batch = deletes.slice(i, i + this.batchSize)
      for (const where of batch) {
        const deleted = await repo.deleteMany(where)
        totalDeleted += deleted
      }
    }

    return totalDeleted
  }

  async upsertMany(data: Array<{ item: Partial<T>; conflictColumns: string[]; updateColumns: string[] }>): Promise<T[]> {
    const results: T[] = []
    const repo = new Repository<T>(this.driver, this.tableName)

    for (let i = 0; i < data.length; i += this.batchSize) {
      const batch = data.slice(i, i + this.batchSize)
      for (const { item, conflictColumns, updateColumns } of batch) {
        const result = await repo.upsert(item, conflictColumns, updateColumns)
        results.push(result)
      }
    }

    return results
  }

  async transaction<R>(fn: (batch: BatchRepository<T>) => Promise<R>): Promise<R> {
    return this.driver.transaction(async (driver) => {
      const batch = new BatchRepository<T>(driver, this.tableName, this.batchSize)
      return fn(batch)
    })
  }
}
