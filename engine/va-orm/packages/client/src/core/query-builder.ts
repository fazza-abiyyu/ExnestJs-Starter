// VA-ORM Query Builder

import type { DatabaseDriver, WhereClause, OrderClause, JoinType, SortDirection } from './types.js'
import { ExpressionBuilder } from './expression.js'

export class QueryBuilder<T = any> {
  private _select: string[] = []
  private _from: string = ''
  private _alias: string = ''
  private _joins: Array<{ type: JoinType; table: string; alias: string; on: string }> = []
  private _where: WhereClause[] = []
  private _orderBy: OrderClause[] = []
  private _groupBy: string[] = []
  private _having: WhereClause[] = []
  private _limit?: number
  private _offset?: number
  private _params: any[] = []
  private _distinct: boolean = false
  private _forUpdate: boolean = false
  private _placeholderFn: (index: number) => string

  constructor(
    private driver: DatabaseDriver,
    private tableName: string,
    aliasOrPlaceholder?: string | ((index: number) => string)
  ) {
    this._from = tableName
    if (typeof aliasOrPlaceholder === 'function') {
      this._placeholderFn = aliasOrPlaceholder
    } else {
      this._alias = aliasOrPlaceholder || ''
      this._placeholderFn = (i) => driver.getPlaceholder(i)
    }
  }

  // ============ SELECT ============

  select(...columns: string[]): this {
    this._select = columns
    return this
  }

  distinct(): this {
    this._distinct = true
    return this
  }

  // ============ FROM ============

  from(table: string, alias?: string): this {
    this._from = table
    this._alias = alias || ''
    return this
  }

  as(alias: string): this {
    this._alias = alias
    return this
  }

  // ============ JOIN ============

  join(table: string, on: string, alias?: string, type: JoinType = 'inner'): this {
    this._joins.push({ type, table, alias: alias || '', on })
    return this
  }

  leftJoin(table: string, on: string, alias?: string): this {
    return this.join(table, on, alias, 'left')
  }

  rightJoin(table: string, on: string, alias?: string): this {
    return this.join(table, on, alias, 'right')
  }

  crossJoin(table: string, alias?: string): this {
    this._joins.push({ type: 'cross', table, alias: alias || '', on: '' })
    return this
  }

  // ============ WHERE ============

  where(fn: (builder: ExpressionBuilder) => void): this {
    const builder = ExpressionBuilder.create(this._placeholderFn)
    fn(builder)
    const { sql, params } = builder.build()
    if (sql) {
      this._where.push({ column: '', operator: '=', value: { raw: sql, values: params } })
      this._params.push(...params)
    }
    return this
  }

  whereColumn(column: string, operator: string, value: any): this {
    this._where.push({ column, operator: operator as any, value })
    return this
  }

  // ============ ORDER BY ============

  orderBy(column: string, direction: SortDirection = 'asc', table?: string): this {
    this._orderBy.push({ column, direction, table })
    return this
  }

  // ============ GROUP BY ============

  groupBy(...columns: string[]): this {
    this._groupBy = columns
    return this
  }

  having(fn: (builder: ExpressionBuilder) => void): this {
    const builder = ExpressionBuilder.create((i) => `?`)
    fn(builder)
    const { sql, params } = builder.build()
    if (sql) {
      this._having.push({ column: '', operator: '=', value: { raw: sql, values: params } })
    }
    return this
  }

  // ============ LIMIT / OFFSET ============

  limit(limit: number): this {
    this._limit = limit
    return this
  }

  offset(offset: number): this {
    this._offset = offset
    return this
  }

  take(take: number): this {
    this._limit = take
    return this
  }

  skip(skip: number): this {
    this._offset = skip
    return this
  }

  // ============ FOR UPDATE ============

  forUpdate(): this {
    this._forUpdate = true
    return this
  }

  // ============ BUILD SQL ============

  build(): { sql: string; params: any[] } {
    const parts: string[] = []
    const params: any[] = []
    let paramIndex = 1

    // SELECT
    const selectClause = this._distinct ? 'SELECT DISTINCT' : 'SELECT'
    if (this._select.length > 0) {
      parts.push(`${selectClause} ${this._select.join(', ')}`)
    } else {
      parts.push(`${selectClause} *`)
    }

    // FROM
    const fromTable = this._alias ? `${this._from} AS ${this._alias}` : this._from
    parts.push(`FROM ${fromTable}`)

    // JOIN
    for (const join of this._joins) {
      const joinTable = join.alias ? `${join.table} AS ${join.alias}` : join.table
      if (join.type === 'cross') {
        parts.push(`CROSS JOIN ${joinTable}`)
      } else {
        parts.push(`${join.type.toUpperCase()} JOIN ${joinTable} ON ${join.on}`)
      }
    }

    // WHERE
    if (this._where.length > 0) {
      const whereParts: string[] = []
      for (let i = 0; i < this._where.length; i++) {
        const clause = this._where[i]
        if (clause.value && typeof clause.value === 'object' && 'raw' in clause.value) {
          whereParts.push(clause.value.raw)
          params.push(...clause.value.values)
          paramIndex += clause.value.values.length
        } else {
          const ph = this._placeholderFn(paramIndex++)
          whereParts.push(`${clause.column} ${clause.operator} ${ph}`)
          params.push(clause.value)
        }
      }
      parts.push(`WHERE ${whereParts.join(' AND ')}`)
    }

    // GROUP BY
    if (this._groupBy.length > 0) {
      parts.push(`GROUP BY ${this._groupBy.join(', ')}`)
    }

    // HAVING
    if (this._having.length > 0) {
      const havingParts: string[] = []
      for (const clause of this._having) {
        if (clause.value && typeof clause.value === 'object' && 'raw' in clause.value) {
          const processed = clause.value.raw.replace(/\?/g, () => this._placeholderFn(paramIndex++))
          havingParts.push(processed)
          params.push(...clause.value.values)
        }
      }
      if (havingParts.length > 0) {
        parts.push(`HAVING ${havingParts.join(' AND ')}`)
      }
    }

    // ORDER BY
    if (this._orderBy.length > 0) {
      const orderParts = this._orderBy.map(o => {
        const column = o.table ? `${o.table}.${o.column}` : o.column
        return `${column} ${o.direction.toUpperCase()}`
      })
      parts.push(`ORDER BY ${orderParts.join(', ')}`)
    }

    // LIMIT
    if (this._limit !== undefined) {
      parts.push(`LIMIT ${this._limit}`)
    }

    // OFFSET
    if (this._offset !== undefined) {
      parts.push(`OFFSET ${this._offset}`)
    }

    // FOR UPDATE
    if (this._forUpdate) {
      parts.push('FOR UPDATE')
    }

    return {
      sql: parts.join(' '),
      params,
    }
  }

  // ============ EXECUTE ============

  async execute(): Promise<T[]> {
    const { sql, params } = this.build()
    const result = await this.driver.query<T>(sql, params)
    return result.rows
  }

  async first(): Promise<T | null> {
    this._limit = 1
    const rows = await this.execute()
    return rows[0] || null
  }

  async count(): Promise<number> {
    const original = this._select
    this._select = ['COUNT(*) as count']
    const { sql, params } = this.build()
    this._select = original

    const result = await this.driver.query<{ count: number }>(sql, params)
    return Number(result.rows[0]?.count || 0)
  }

  async exists(): Promise<boolean> {
    const count = await this.count()
    return count > 0
  }

  // ============ INSERT ============

  static insert<T>(driver: DatabaseDriver, table: string, data: Partial<T>): QueryBuilder<T> {
    const builder = new QueryBuilder<T>(driver, table)
    const columns = Object.keys(data)
    const values = Object.values(data)
    const placeholders = values.map((_, i) => builder._placeholderFn(i + 1))

    builder._select = []
    builder._from = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`

    return builder
  }

  // ============ UPDATE ============

  static update<T>(driver: DatabaseDriver, table: string, data: Partial<T>): QueryBuilder<T> {
    const builder = new QueryBuilder<T>(driver, table)
    const columns = Object.keys(data)
    const values = Object.values(data)
    const setParts = columns.map((col, i) => `${col} = ${builder._placeholderFn(i + 1)}`)

    builder._select = []
    builder._from = `UPDATE ${table} SET ${setParts.join(', ')}`

    return builder
  }

  // ============ DELETE ============

  static delete(driver: DatabaseDriver, table: string): QueryBuilder {
    const builder = new QueryBuilder(driver, table)
    builder._select = []
    builder._from = `DELETE FROM ${table}`
    return builder
  }
}
