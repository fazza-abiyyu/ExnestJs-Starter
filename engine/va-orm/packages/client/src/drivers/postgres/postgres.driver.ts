// VA-ORM PostgreSQL Driver

import type { DatabaseDriver, QueryResult } from '../core/types.js'

interface PgPool {
  query(sql: string, values?: any[]): Promise<any>
  end(): Promise<void>
}

export class PostgresDriver implements DatabaseDriver {
  private pool: PgPool
  private appName: string

  constructor(
    private connectionString: string,
    private options: {
      max?: number
      min?: number
      idleTimeoutMs?: number
      connectionTimeoutMs?: number
      ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string }
      applicationName?: string
    } = {}
  ) {
    this.appName = options.applicationName || 'va-orm'
    this.pool = this.createPool()
  }

  private createPool(): PgPool {
    // Uses native `pg` Pool when available
    const { Pool } = require('pg')
    return new Pool({
      connectionString: this.connectionString,
      max: this.options.max ?? 20,
      min: this.options.min ?? 2,
      idleTimeoutMillis: this.options.idleTimeoutMs ?? 10000,
      connectionTimeoutMillis: this.options.connectionTimeoutMs ?? 5000,
      ssl: this.options.ssl || false,
      application_name: this.appName,
    })
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const result = await this.pool.query(sql, params)
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? 0,
    }
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    const result = await this.pool.query(sql, params)
    return { rowCount: result.rowCount ?? 0 }
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(this)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  getPlaceholder(index: number): string {
    return `$${index}`
  }
}
