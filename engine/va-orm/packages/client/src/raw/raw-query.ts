// VA-ORM Raw Query

import type { DatabaseDriver } from '../core/types.js'

export class RawQuery {
  constructor(private driver: DatabaseDriver) {}

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.driver.query<T>(sql, params)
    return result.rows
  }

  async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const result = await this.driver.query<T>(sql, params)
    return result.rows[0] || null
  }

  async execute(sql: string, params?: any[]): Promise<number> {
    const result = await this.driver.execute(sql, params)
    return result.rowCount
  }

  async transaction<R>(fn: (raw: RawQuery) => Promise<R>): Promise<R> {
    return this.driver.transaction(async (driver) => {
      const raw = new RawQuery(driver)
      return fn(raw)
    })
  }

  // ============ SQL TAGGED TEMPLATE ============

  sql<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    let sql = ''
    const params: any[] = []

    for (let i = 0; i < strings.length; i++) {
      sql += strings[i]
      if (i < values.length) {
        params.push(values[i])
        sql += this.driver.getPlaceholder(params.length)
      }
    }

    return this.query<T>(sql, params)
  }

  sqlOne<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T | null> {
    let sql = ''
    const params: any[] = []

    for (let i = 0; i < strings.length; i++) {
      sql += strings[i]
      if (i < values.length) {
        params.push(values[i])
        sql += this.driver.getPlaceholder(params.length)
      }
    }

    return this.queryOne<T>(sql, params)
  }
}
