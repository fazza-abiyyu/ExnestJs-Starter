// VA-ORM SQLite Driver

import { Database } from 'bun:sqlite'
import type { DatabaseDriver, QueryResult } from '../core/types.js'

export class SqliteDriver implements DatabaseDriver {
  private db: Database

  constructor(
    private filename: string,
    private options: {
      readonly?: boolean
      wal?: boolean
    } = {}
  ) {
    this.db = this.open()
  }

  private open(): Database {
    const db = new Database(this.filename, {
      readonly: this.options.readonly ?? false,
      create: true,
    })
    if (this.options.wal !== false) {
      db.exec('PRAGMA journal_mode = WAL')
    }
    db.exec('PRAGMA foreign_keys = ON')
    return db
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const stmt = this.db.query(sql)
    const rows = params ? stmt.all(...params) : stmt.all()
    return {
      rows: rows as T[],
      rowCount: rows.length,
    }
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    const stmt = this.db.query(sql)
    const result = params ? stmt.run(...params) : stmt.run()
    return { rowCount: result.changes }
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const txDriver: DatabaseDriver = {
      query: <R = any>(sql: string, params?: any[]) => this.query<R>(sql, params),
      execute: (sql: string, params?: any[]) => this.execute(sql, params),
      transaction: (nested: (driver: DatabaseDriver) => Promise<T>) => nested(txDriver),
      close: async () => {},
      getPlaceholder: (_index: number) => '?',
    }
    this.db.exec('BEGIN')
    try {
      const result = await fn(txDriver)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }

  getPlaceholder(_index: number): string {
    return '?'
  }
}
