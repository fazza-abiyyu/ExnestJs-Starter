// VA-ORM Migration Tracker

import type { DatabaseDriver } from '../core/types.js'

export interface MigrationStatus {
  name: string
  applied: boolean
  appliedAt?: Date
  checksum: string
}

export class MigrationTracker {
  private tableName = '_va_migrations'

  constructor(private driver: DatabaseDriver) {}

  async initialize(): Promise<void> {
    const sql = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        name VARCHAR(255) PRIMARY KEY,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        execution_time_ms INTEGER
      )
    `
    await this.driver.execute(sql)
  }

  async record(migration: string, checksum: string, executionTimeMs: number): Promise<void> {
    await this.driver.execute(
      `INSERT INTO ${this.tableName} (name, checksum, execution_time_ms) VALUES ($1, $2, $3)`,
      [migration, checksum, executionTimeMs]
    )
  }

  async remove(migration: string): Promise<void> {
    await this.driver.execute(
      `DELETE FROM ${this.tableName} WHERE name = $1`,
      [migration]
    )
  }

  async getApplied(): Promise<Array<{ name: string; checksum: string; appliedAt: Date; executionTimeMs: number }>> {
    const result = await this.driver.query(
      `SELECT name, checksum, applied_at as "appliedAt", execution_time_ms as "executionTimeMs" FROM ${this.tableName} ORDER BY name`
    )
    return result.rows
  }

  async isApplied(migration: string): Promise<boolean> {
    const result = await this.driver.query(
      `SELECT 1 FROM ${this.tableName} WHERE name = $1`,
      [migration]
    )
    return result.rows.length > 0
  }

  async getChecksum(migration: string): Promise<string | null> {
    const result = await this.driver.query(
      `SELECT checksum FROM ${this.tableName} WHERE name = $1`,
      [migration]
    )
    return result.rows[0]?.checksum || null
  }

  async verify(): Promise<MigrationStatus[]> {
    const applied = await this.getApplied()
    return applied.map(m => ({
      name: m.name,
      applied: true,
      appliedAt: m.appliedAt,
      checksum: m.checksum,
    }))
  }

  async hasConflicts(): Promise<boolean> {
    const applied = await this.getApplied()
    // Check for duplicate migrations
    const names = applied.map(m => m.name)
    const uniqueNames = new Set(names)
    return names.length !== uniqueNames.size
  }
}
