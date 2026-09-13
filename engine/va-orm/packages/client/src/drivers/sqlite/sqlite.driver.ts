// VA-ORM SQLite Driver

import { Database } from 'bun:sqlite'
import type { DatabaseDriver, QueryResult } from '../../core/types.js'
import { VaError } from '../../core/errors.js'

export class SqliteDriver implements DatabaseDriver {
  private db: Database
  private txDepth = 0

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
    try {
      const stmt = this.db.query(sql)
      const rows = params ? stmt.all(...params) : stmt.all()
      return {
        rows: rows as T[],
        rowCount: rows.length,
      }
    } catch (error) {
      throw VaError.wrap(error, 'sqlite query')
    }
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    try {
      const stmt = this.db.query(sql)
      const result = params ? stmt.run(...params) : stmt.run()
      return { rowCount: result.changes }
    } catch (error) {
      throw VaError.wrap(error, 'sqlite execute')
    }
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const depth = this.txDepth
    const savepoint = depth === 0 ? null : `va_sp_${depth}`
    this.txDepth = depth + 1

    const txDriver: DatabaseDriver = {
      query: <R = any>(sql: string, params?: any[]) => this.query<R>(sql, params),
      execute: (sql: string, params?: any[]) => this.execute(sql, params),
      transaction: <R>(nested: (driver: DatabaseDriver) => Promise<R>) => this.transaction(nested),
      close: async () => {},
      getPlaceholder: (_index: number) => '?',
      getDialect: () => 'sqlite' as const,
    }

    try {
      if (savepoint) this.db.exec(`SAVEPOINT ${savepoint}`)
      else this.db.exec('BEGIN')
      const result = await fn(txDriver)
      if (savepoint) this.db.exec(`RELEASE ${savepoint}`)
      else this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        if (savepoint) this.db.exec(`ROLLBACK TO ${savepoint}`)
        else this.db.exec('ROLLBACK')
      } catch {
        // ignore secondary rollback failures
      }
      throw VaError.wrap(error, 'sqlite transaction')
    } finally {
      this.txDepth = depth
    }
  }

  async close(): Promise<void> {
    this.db.close()
  }

  getDialect(): 'sqlite' {
    return 'sqlite'
  }

  getPlaceholder(_index: number): string {
    return '?'
  }
}
