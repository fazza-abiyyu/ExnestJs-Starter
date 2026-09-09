// VA-ORM Repository

import type { DatabaseDriver, WhereClause, OrderClause, SortDirection, RepositoryOptions, OffsetResult, OffsetOptions, CursorResult, CursorOptions } from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'
import { ExpressionBuilder } from '../core/expression.js'
import { buildSetClause } from './field.ops.js'

export class Repository<T extends Record<string, any>> {
  private options: Required<RepositoryOptions>

  constructor(
    private driver: DatabaseDriver,
    private tableName: string,
    options: RepositoryOptions = {}
  ) {
    this.options = {
      softDelete: options.softDelete ?? false,
      softDeleteColumn: options.softDeleteColumn ?? 'deleted_at',
      camelToSnake: options.camelToSnake ?? true,
    }
  }

  // ============ CREATE ============

  async create(data: Partial<T>): Promise<T> {
    const columns = Object.keys(data)
    const values = Object.values(data)
    const placeholders = values.map((_, i) => this.driver.getPlaceholder(i + 1))

    const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
    const result = await this.driver.query<T>(sql, values)
    return result.rows[0]
  }

  async createMany(data: Partial<T>[]): Promise<T[]> {
    if (data.length === 0) return []

    const columns = Object.keys(data[0])
    const results: T[] = []

    for (const item of data) {
      const values = Object.values(item)
      const placeholders = values.map((_, i) => this.driver.getPlaceholder(i + 1))
      const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
      const result = await this.driver.query<T>(sql, values)
      results.push(result.rows[0])
    }

    return results
  }

  // ============ READ ============

  async findUnique(where: Partial<T>): Promise<T | null> {
    const conditions = Object.entries(where)
    const whereClause = conditions.map(([key, value], i) => ({
      column: key,
      operator: '=' as const,
      value,
    }))

    const builder = new QueryBuilder<T>(this.driver, this.tableName)
    builder.where((eb) => {
      for (const clause of whereClause) {
        eb.eq(clause.column, clause.value)
      }
    })

    return builder.first()
  }

  async findFirst(where?: Partial<T>): Promise<T | null> {
    const builder = new QueryBuilder<T>(this.driver, this.tableName)

    if (where) {
      builder.where((eb) => {
        for (const [key, value] of Object.entries(where)) {
          eb.eq(key, value)
        }
      })
    }

    return builder.first()
  }

  async findMany(options: {
    where?: Partial<T>
    orderBy?: { [K in keyof T]?: SortDirection }
    limit?: number
    offset?: number
  } = {}): Promise<T[]> {
    const builder = new QueryBuilder<T>(this.driver, this.tableName)

    if (options.where) {
      builder.where((eb) => {
        for (const [key, value] of Object.entries(options.where!)) {
          eb.eq(key, value)
        }
      })
    }

    if (options.orderBy) {
      for (const [key, direction] of Object.entries(options.orderBy)) {
        builder.orderBy(key, direction as SortDirection)
      }
    }

    if (options.limit !== undefined) {
      builder.limit(options.limit)
    }

    if (options.offset !== undefined) {
      builder.offset(options.offset)
    }

    return builder.execute()
  }

  // ============ UPDATE ============

  async update(where: Partial<T>, data: Partial<T>): Promise<T> {
    const { setParts, params: setValues, nextIndex } = buildSetClause(
      data as Record<string, any>,
      (i) => this.driver.getPlaceholder(i)
    )

    const whereConditions = Object.entries(where)
    const whereParts = whereConditions.map(([key], i) => `${key} = ${this.driver.getPlaceholder(nextIndex + i)}`)
    const whereValues = whereConditions.map(([, value]) => value)

    const sql = `UPDATE ${this.tableName} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')} RETURNING *`
    const result = await this.driver.query<T>(sql, [...setValues, ...whereValues])
    return result.rows[0]
  }

  async updateMany(where: Partial<T>, data: Partial<T>): Promise<number> {
    const { setParts, params: setValues, nextIndex } = buildSetClause(
      data as Record<string, any>,
      (i) => this.driver.getPlaceholder(i)
    )

    const whereConditions = Object.entries(where)
    const whereParts = whereConditions.map(([key], i) => `${key} = ${this.driver.getPlaceholder(nextIndex + i)}`)
    const whereValues = whereConditions.map(([, value]) => value)

    const sql = `UPDATE ${this.tableName} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`
    const result = await this.driver.execute(sql, [...setValues, ...whereValues])
    return result.rowCount
  }

  // ============ UPSERT ============

  async upsert(data: Partial<T>, conflictColumns: string[], updateColumns: string[]): Promise<T> {
    const columns = Object.keys(data)
    const values = Object.values(data)
    const placeholders = values.map((_, i) => this.driver.getPlaceholder(i + 1))

    const conflictClause = conflictColumns.join(', ')
    const updateClause = updateColumns.map(col => `${col} = EXCLUDED.${col}`).join(', ')

    const sql = `INSERT INTO ${this.tableName} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflictClause}) DO UPDATE SET ${updateClause} RETURNING *`
    const result = await this.driver.query<T>(sql, values)
    return result.rows[0]
  }

  // ============ DELETE ============

  async delete(where: Partial<T>): Promise<T> {
    const conditions = Object.entries(where)
    const whereParts = conditions.map(([key], i) => `${key} = ${this.driver.getPlaceholder(i + 1)}`)
    const whereValues = conditions.map(([, value]) => value)

    if (this.options.softDelete) {
      const sql = `UPDATE ${this.tableName} SET ${this.options.softDeleteColumn} = NOW() WHERE ${whereParts.join(' AND ')} RETURNING *`
      const result = await this.driver.query<T>(sql, whereValues)
      return result.rows[0]
    }

    const sql = `DELETE FROM ${this.tableName} WHERE ${whereParts.join(' AND ')} RETURNING *`
    const result = await this.driver.query<T>(sql, whereValues)
    return result.rows[0]
  }

  async deleteMany(where?: Partial<T>): Promise<number> {
    if (!where) {
      const sql = `DELETE FROM ${this.tableName}`
      const result = await this.driver.execute(sql)
      return result.rowCount
    }

    const conditions = Object.entries(where)
    const whereParts = conditions.map(([key], i) => `${key} = ${this.driver.getPlaceholder(i + 1)}`)
    const whereValues = conditions.map(([, value]) => value)

    if (this.options.softDelete) {
      const sql = `UPDATE ${this.tableName} SET ${this.options.softDeleteColumn} = NOW() WHERE ${whereParts.join(' AND ')}`
      const result = await this.driver.execute(sql, whereValues)
      return result.rowCount
    }

    const sql = `DELETE FROM ${this.tableName} WHERE ${whereParts.join(' AND ')}`
    const result = await this.driver.execute(sql, whereValues)
    return result.rowCount
  }

  // ============ AGGREGATE ============

  async count(where?: Partial<T>): Promise<number> {
    const builder = new QueryBuilder(this.driver, this.tableName)

    if (where) {
      builder.where((eb) => {
        for (const [key, value] of Object.entries(where)) {
          eb.eq(key, value)
        }
      })
    }

    return builder.count()
  }

  async exists(where?: Partial<T>): Promise<boolean> {
    const count = await this.count(where)
    return count > 0
  }

  // ============ PAGINATION ============

  async paginate(options: OffsetOptions & { where?: Partial<T>; orderBy?: { [K in keyof T]?: SortDirection } } = {}): Promise<OffsetResult<T>> {
    const page = options.page ?? 1
    const limit = options.limit ?? 10
    const skip = options.skip ?? (page - 1) * limit

    const [items, total] = await Promise.all([
      this.findMany({ ...options, limit, offset: skip }),
      this.count(options.where),
    ])

    const totalPages = Math.ceil(total / limit)

    return {
      items,
      total,
      page,
      limit,
      skip,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    }
  }

  async cursorPaginate(options: CursorOptions & { where?: Partial<T>; orderBy?: { [K in keyof T]?: SortDirection } } = {}): Promise<CursorResult<T>> {
    const limit = options.limit ?? 10
    const builder = new QueryBuilder<T>(this.driver, this.tableName)

    if (options.where) {
      builder.where((eb) => {
        for (const [key, value] of Object.entries(options.where!)) {
          eb.eq(key, value)
        }
      })
    }

    if (options.cursor) {
      // Simple cursor implementation using id
      builder.where((eb) => {
        eb.gt('id', options.cursor)
      })
    }

    if (options.orderBy) {
      for (const [key, direction] of Object.entries(options.orderBy)) {
        builder.orderBy(key, direction as SortDirection)
      }
    }

    builder.limit(limit + 1) // Fetch one extra to determine if there are more

    const items = await builder.execute()
    const hasMore = items.length > limit
    const resultItems = hasMore ? items.slice(0, limit) : items

    return {
      items: resultItems,
      nextCursor: hasMore ? resultItems[resultItems.length - 1]?.id : undefined,
      hasMore,
      hasPrevious: !!options.cursor,
    }
  }

  // ============ BATCH ============

  async transaction<R>(fn: (repo: Repository<T>) => Promise<R>): Promise<R> {
    return this.driver.transaction(async (driver) => {
      const repo = new Repository<T>(driver, this.tableName, this.options)
      return fn(repo)
    })
  }

  // ============ RAW QUERY ============

  async raw<R = any>(sql: string, params?: any[]): Promise<R[]> {
    const result = await this.driver.query<R>(sql, params)
    return result.rows
  }

  async rawOne<R = any>(sql: string, params?: any[]): Promise<R | null> {
    const result = await this.driver.query<R>(sql, params)
    return result.rows[0] || null
  }

  async rawExecute(sql: string, params?: any[]): Promise<number> {
    const result = await this.driver.execute(sql, params)
    return result.rowCount
  }

  // ============ QUERY BUILDER ============

  query(): QueryBuilder<T> {
    return new QueryBuilder<T>(this.driver, this.tableName)
  }

  expression(): ExpressionBuilder {
    return ExpressionBuilder.create((i) => this.driver.getPlaceholder(i))
  }
}
