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

  // ============ FULL-TEXT SEARCH (PostgreSQL) ============

  toTsQuery(language: string, query: string): string {
    const sanitized = query.replace(/[^\w\s&|!:(-)]/g, '')
    return `plainto_tsquery('${language}', ${this.driver.getPlaceholder(1)})`
  }

  toTsVector(language: string, column: string): string {
    return `to_tsvector('${language}', ${column})`
  }

  tsRank(vectorCol: string, query: string, language: string = 'english'): string {
    return `ts_rank(${vectorCol}, plainto_tsquery('${language}', ${this.driver.getPlaceholder(1)}))`
  }

  tsHeadline(language: string, column: string, query: string, options?: { startSel?: string; stopSel?: string; maxFragments?: number; maxWords?: number; minWords?: number }): string {
    let opts = ''
    if (options) {
      const parts: string[] = []
      if (options.startSel) parts.push(`StartSel='${options.startSel}'`)
      if (options.stopSel) parts.push(`StopSel='${options.stopSel}'`)
      if (options.maxFragments) parts.push(`MaxFragments=${options.maxFragments}`)
      if (options.maxWords) parts.push(`MaxWords=${options.maxWords}`)
      if (options.minWords) parts.push(`MinWords=${options.minWords}`)
      if (parts.length > 0) opts = `, '${parts.join(', ')}'`
    }
    return `ts_headline('${language}', ${column}, plainto_tsquery('${language}', ${this.driver.getPlaceholder(1)})${opts})`
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
      where?: string
      params?: any[]
      limit?: number
      offset?: number
    }
  ): Promise<T[]> {
    const lang = options.language ?? 'english'
    const searchCol = `${table}.${options.column}`
    const tsQuery = `plainto_tsquery('${lang}', ${this.driver.getPlaceholder(1)})`

    const selectParts: string[] = [`${table}.*`]
    const params: any[] = [options.query]

    if (options.rank) {
      selectParts.push(`ts_rank(${searchCol}, ${tsQuery}) AS rank`)
    }

    if (options.headline) {
      const headlineOpts = options.headlineOptions
      let opts = ''
      if (headlineOpts) {
        const parts: string[] = []
        if (headlineOpts.startSel) parts.push(`StartSel='${headlineOpts.startSel}'`)
        if (headlineOpts.stopSel) parts.push(`StopSel='${headlineOpts.stopSel}'`)
        if (headlineOpts.maxFragments) parts.push(`MaxFragments=${headlineOpts.maxFragments}`)
        if (headlineOpts.maxWords) parts.push(`MaxWords=${headlineOpts.maxWords}`)
        if (headlineOpts.minWords) parts.push(`MinWords=${headlineOpts.minWords}`)
        if (parts.length > 0) opts = `, '${parts.join(', ')}'`
      }
      selectParts.push(`ts_headline('${lang}', ${searchCol}, ${tsQuery}${opts}) AS headline`)
    }

    let sql = `SELECT ${selectParts.join(', ')} FROM ${table} WHERE ${searchCol} @@ ${tsQuery}`

    if (options.where) {
      sql += ` AND ${options.where}`
      if (options.params) params.push(...options.params)
    }

    if (options.rank) {
      sql += ` ORDER BY rank DESC`
    }

    if (options.limit) {
      sql += ` LIMIT ${options.limit}`
    }

    if (options.offset) {
      sql += ` OFFSET ${options.offset}`
    }

    return this.query<T>(sql, params)
  }
}
