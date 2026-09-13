// VA-ORM Raw Query

import type { DatabaseDriver } from '../core/types.js'
import { quoteColumn, quoteTable } from '../relation/quote.js'
import { assertSafeInteger, ExpressionBuilder } from '../core/expression.js'

/** Escape a value interpolated into a SQL string literal (e.g. tsquery language). */
function escapeLiteral(value: string, dialect?: string): string {
  let s = String(value).replace(/'/g, "''")
  if (dialect === 'mysql') {
    s = s.replace(/\\/g, '\\\\')
  }
  return s
}

/**
 * Build ts_headline options fragment.
 * PostgreSQL options text is ONE string: `StartSel=<value>, StopSel=<value>`.
 * Values must NOT add their own quotes; escapeLiteral prevents breaking out
 * of the outer options string literal (CRITICAL SQLi).
 */
function tsHeadlineOptions(options?: {
  startSel?: string
  stopSel?: string
  maxFragments?: number
  maxWords?: number
  minWords?: number
}): string {
  if (!options) return ''
  const parts: string[] = []
  if (options.startSel) parts.push(`StartSel=${escapeLiteral(options.startSel)}`)
  if (options.stopSel) parts.push(`StopSel=${escapeLiteral(options.stopSel)}`)
  if (options.maxFragments !== undefined) {
    assertSafeInteger(options.maxFragments, 'MaxFragments')
    parts.push(`MaxFragments=${options.maxFragments}`)
  }
  if (options.maxWords !== undefined) {
    assertSafeInteger(options.maxWords, 'MaxWords')
    parts.push(`MaxWords=${options.maxWords}`)
  }
  if (options.minWords !== undefined) {
    assertSafeInteger(options.minWords, 'MinWords')
    parts.push(`MinWords=${options.minWords}`)
  }
  return parts.length > 0 ? `, '${parts.join(', ')}'` : ''
}

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

  // ============ FULL-TEXT SEARCH (PostgreSQL) ============

  toTsQuery(language: string, query: string): string {
    const sanitized = query.replace(/[^\w\s&|!:(-)]/g, '')
    return `plainto_tsquery('${escapeLiteral(language, typeof this.driver.getDialect === 'function' ? this.driver.getDialect() : undefined)}', ${this.driver.getPlaceholder(1)})`
  }

  toTsVector(language: string, column: string): string {
    return `to_tsvector('${escapeLiteral(language, typeof this.driver.getDialect === 'function' ? this.driver.getDialect() : undefined)}', ${quoteColumn(this.driver, column)})`
  }

  tsRank(vectorCol: string, query: string, language: string = 'english'): string {
    return `ts_rank(${quoteColumn(this.driver, vectorCol)}, plainto_tsquery('${escapeLiteral(language, typeof this.driver.getDialect === 'function' ? this.driver.getDialect() : undefined)}', ${this.driver.getPlaceholder(1)}))`
  }

  tsHeadline(language: string, column: string, query: string, options?: { startSel?: string; stopSel?: string; maxFragments?: number; maxWords?: number; minWords?: number }): string {
    const opts = tsHeadlineOptions(options)
    const dialect = typeof this.driver.getDialect === 'function' ? this.driver.getDialect() : undefined
    return `ts_headline('${escapeLiteral(language, dialect)}', ${quoteColumn(this.driver, column)}, plainto_tsquery('${escapeLiteral(language, dialect)}', ${this.driver.getPlaceholder(1)})${opts})`
  }

  async search<T = any>(
    table: string,
    options: {
      column: string
      query: string
      language?: string
      rank?: boolean
      headline?: boolean
      headlineOptions?: { startSel?: string; stopSel?: string; maxFragments?: number; maxWords?: number; minWords?: number }
      /** Preferred: parameterized filter builder. */
      filter?: (eb: ExpressionBuilder) => void
      /** @deprecated Trusted developer SQL only — never pass user input. Prefer `filter`. */
      where?: string
      params?: any[]
      limit?: number
      offset?: number
    }
  ): Promise<T[]> {
    const dialect = typeof this.driver.getDialect === 'function' ? this.driver.getDialect() : undefined
    const lang = escapeLiteral(options.language ?? 'english', dialect)
    const searchCol = `${quoteTable(this.driver, table)}.${quoteColumn(this.driver, options.column)}`
    const tsQuery = `plainto_tsquery('${lang}', ${this.driver.getPlaceholder(1)})`

    const selectParts: string[] = [`${quoteTable(this.driver, table)}.*`]
    const params: any[] = [options.query]

    if (options.rank) {
      selectParts.push(`ts_rank(${searchCol}, ${tsQuery}) AS rank`)
    }

    if (options.headline) {
      const opts = tsHeadlineOptions(options.headlineOptions)
      selectParts.push(`ts_headline('${lang}', ${searchCol}, ${tsQuery}${opts}) AS headline`)
    }

    let sql = `SELECT ${selectParts.join(', ')} FROM ${quoteTable(this.driver, table)} WHERE ${searchCol} @@ ${tsQuery}`

    if (options.filter) {
      const base = params.length
      const filterEb = new ExpressionBuilder(
        (i) => this.driver.getPlaceholder(base + i),
        (name) => quoteColumn(this.driver, name),
      )
      options.filter(filterEb)
      const built = filterEb.build()
      if (built.sql) {
        sql += ` AND (${built.sql})`
        params.push(...built.params)
      }
    } else if (options.where) {
      // Trusted developer SQL only — see @deprecated on options.where
      sql += ` AND ${options.where}`
      if (options.params) params.push(...options.params)
    }

    if (options.rank) {
      sql += ` ORDER BY rank DESC`
    }

    assertSafeInteger(options.limit, 'LIMIT')
    assertSafeInteger(options.offset, 'OFFSET')
    if (options.limit) {
      sql += ` LIMIT ${options.limit}`
    }

    if (options.offset) {
      sql += ` OFFSET ${options.offset}`
    }

    return this.query<T>(sql, params)
  }
}
