// VA-ORM CTE (Common Table Expression) Builder

import type { DatabaseDriver } from '../core/types.js'

interface CTE {
  name: string
  columns?: string[]
  sql: string
  params: any[]
  materialized?: boolean
  recursive?: boolean
}

export class CTEBuilder {
  private ctes: CTE[] = []
  private mainQuery: string = ''
  private mainParams: any[] = []
  private placeholderFn: (index: number) => string

  constructor(
    private driver: DatabaseDriver,
    placeholderFn?: (index: number) => string
  ) {
    this.placeholderFn = placeholderFn || ((i) => driver.getPlaceholder(i))
  }

  // ============ WITH ============

  with(name: string, sql: string, params: any[] = [], options: { materialized?: boolean; columns?: string[] } = {}): this {
    this.ctes.push({
      name,
      columns: options.columns,
      sql,
      params,
      materialized: options.materialized,
    })
    return this
  }

  withRecursive(name: string, sql: string, params: any[] = [], options: { columns?: string[] } = {}): this {
    this.ctes.push({
      name,
      columns: options.columns,
      sql,
      params,
      recursive: true,
    })
    return this
  }

  // ============ MAIN QUERY ============

  select(sql: string, params: any[] = []): this {
    this.mainQuery = sql
    this.mainParams = params
    return this
  }

  // ============ BUILD ============

  build(): { sql: string; params: any[] } {
    if (this.ctes.length === 0) {
      return { sql: this.mainQuery, params: this.mainParams }
    }

    const cteParts: string[] = []
    const allParams: any[] = []
    let paramOffset = 0

    for (const cte of this.ctes) {
      const materialized = cte.materialized === true ? ' MATERIALIZED' : cte.materialized === false ? ' NOT MATERIALIZED' : ''
      const columns = cte.columns ? ` (${cte.columns.join(', ')})` : ''

      // Replace placeholders in CTE SQL
      let cteSql = cte.sql
      for (const param of cte.params) {
        cteSql = cteSql.replace('?', this.placeholderFn(paramOffset + 1))
        allParams.push(param)
        paramOffset++
      }

      cteParts.push(`${cte.name}${columns} AS${materialized} (${cteSql})`)
    }

    // Replace placeholders in main query
    let mainSql = this.mainQuery
    for (const param of this.mainParams) {
      mainSql = mainSql.replace('?', this.placeholderFn(paramOffset + 1))
      allParams.push(param)
      paramOffset++
    }

    return {
      sql: `WITH${this.ctes.some(c => c.recursive) ? ' RECURSIVE' : ''} ${cteParts.join(', ')} ${mainSql}`,
      params: allParams,
    }
  }

  // ============ EXECUTE ============

  async execute<T = any>(): Promise<T[]> {
    const { sql, params } = this.build()
    const result = await this.driver.query<T>(sql, params)
    return result.rows
  }

  async executeOne<T = any>(): Promise<T | null> {
    const rows = await this.execute<T>()
    return rows[0] || null
  }

  // ============ STATIC ============

  static create(driver: DatabaseDriver, placeholderFn?: (index: number) => string): CTEBuilder {
    return new CTEBuilder(driver, placeholderFn)
  }
}
