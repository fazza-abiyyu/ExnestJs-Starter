// VA-ORM MySQL Driver

import type { DatabaseDriver, QueryResult } from '../core/types.js'

interface MySqlPool {
  query(sql: string, values?: any[]): Promise<any>
  end(): Promise<void>
}

export class MysqlDriver implements DatabaseDriver {
  private pool: MySqlPool

  constructor(
    private connectionString: string,
    private options: {
      max?: number
      min?: number
      idleTimeoutMs?: number
      connectionTimeoutMs?: number
      ssl?: boolean | { rejectUnauthorized?: boolean }
    } = {}
  ) {
    this.pool = this.createPool()
  }

  private createPool(): MySqlPool {
    const mysql = require('mysql2/promise')
    const url = new URL(this.connectionString)
    return mysql.createPool({
      host: url.hostname,
      port: parseInt(url.port || '3306'),
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      max: this.options.max ?? 20,
      idleTimeout: this.options.idleTimeoutMs ?? 10000,
      connectTimeout: this.options.connectionTimeoutMs ?? 5000,
      ssl: this.options.ssl || undefined,
    })
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const [rows] = await this.pool.query(sql, params)
    return {
      rows: (Array.isArray(rows) ? rows : []) as T[],
      rowCount: (Array.isArray(rows) ? rows.length : 0),
    }
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    const [result] = await this.pool.query(sql, params)
    return { rowCount: (result as any).affectedRows ?? 0 }
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await fn(this)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  getPlaceholder(_index: number): string {
    return '?'
  }
}
