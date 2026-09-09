// VA-ORM Aggregation
//
// Prisma-style aggregate/groupBy/count with WhereInput filters,
// HAVING on aggregates, quoting, and cross-driver placeholders.

import type {
  DatabaseDriver,
  ModelMeta,
  WhereInput,
} from '../core/types.js'
import { buildWhere } from '../relation/filters.js'
import { ansiQuote } from '../relation/quote.js'
import type { QuoteFn } from '../relation/quote.js'

export interface AggregateArgs {
  where?: WhereInput
  _count?: boolean | { _all?: boolean } | string[]
  _sum?: string[]
  _avg?: string[]
  _min?: string[]
  _max?: string[]
}

export interface GroupByArgs extends AggregateArgs {
  by: string[]
  having?: AggregateHaving
  orderBy?: Record<string, 'asc' | 'desc'>
  take?: number
  skip?: number
}

export type AggregateHaving = {
  [K in '_count' | '_sum' | '_avg' | '_min' | '_max']?: {
    _all?: ScalarCondition
    [field: string]: ScalarCondition | undefined
  }
}

export interface ScalarCondition {
  equals?: any
  not?: any
  in?: any[]
  notIn?: any[]
  lt?: any
  lte?: any
  gt?: any
  gte?: any
}

const AGGREGATE_FNS: Record<string, string> = {
  _count: 'COUNT',
  _sum: 'SUM',
  _avg: 'AVG',
  _min: 'MIN',
  _max: 'MAX',
}

function aggregateExpression(fn: string, target: string, quote: QuoteFn): string {
  if (target === '_all' || target === '*') return `${fn}(*)`
  return `${fn}(${quote(target)})`
}

function applyScalarCondition(parts: string[], params: any[], column: string, cond: ScalarCondition, ph: () => string): void {
  if (cond.equals !== undefined) {
    parts.push(`${column} = ${ph()}`)
    params.push(cond.equals)
  }
  if (cond.not !== undefined) {
    parts.push(`${column} != ${ph()}`)
    params.push(cond.not)
  }
  if (cond.in !== undefined) {
    parts.push(`${column} IN (${cond.in.map(() => ph()).join(', ')})`)
    params.push(...cond.in)
  }
  if (cond.notIn !== undefined) {
    parts.push(`${column} NOT IN (${cond.notIn.map(() => ph()).join(', ')})`)
    params.push(...cond.notIn)
  }
  if (cond.lt !== undefined) {
    parts.push(`${column} < ${ph()}`)
    params.push(cond.lt)
  }
  if (cond.lte !== undefined) {
    parts.push(`${column} <= ${ph()}`)
    params.push(cond.lte)
  }
  if (cond.gt !== undefined) {
    parts.push(`${column} > ${ph()}`)
    params.push(cond.gt)
  }
  if (cond.gte !== undefined) {
    parts.push(`${column} >= ${ph()}`)
    params.push(cond.gte)
  }
}

export class AggregationRepository<T extends Record<string, any>> {
  private quote: QuoteFn

  constructor(
    private driver: DatabaseDriver,
    private tableName: string,
    quote: QuoteFn = ansiQuote
  ) {
    this.quote = quote
  }

  private meta(): ModelMeta {
    return { name: '', table: this.tableName, primaryKey: 'id', relations: new Map() }
  }

  private selectAggregates(args: AggregateArgs): string[] {
    const selectParts: string[] = []

    if (args._count === true || (typeof args._count === 'object' && !Array.isArray(args._count) && (args._count as any)._all)) {
      selectParts.push('COUNT(*) as _count')
    } else if (Array.isArray(args._count)) {
      for (const field of args._count) {
        selectParts.push(`COUNT(${this.quote(field)}) as _count_${field}`)
      }
    }

    for (const field of args._sum ?? []) {
      selectParts.push(`SUM(${this.quote(field)}) as _sum_${field}`)
    }
    for (const field of args._avg ?? []) {
      selectParts.push(`AVG(${this.quote(field)}) as _avg_${field}`)
    }
    for (const field of args._min ?? []) {
      selectParts.push(`MIN(${this.quote(field)}) as _min_${field}`)
    }
    for (const field of args._max ?? []) {
      selectParts.push(`MAX(${this.quote(field)}) as _max_${field}`)
    }

    if (selectParts.length === 0) {
      selectParts.push('COUNT(*) as _count')
    }

    return selectParts
  }

  async aggregate(args: AggregateArgs = {}): Promise<Record<string, any>> {
    const params: any[] = []
    let paramIndex = 1
    const ph = () => this.driver.getPlaceholder(paramIndex++)

    let sql = `SELECT ${this.selectAggregates(args).join(', ')} FROM ${this.quote(this.tableName)}`

    if (args.where) {
      const { sql: whereSql, params: whereParams } = buildWhere(
        args.where, this.meta(), new Map(), ph, this.quote
      )
      if (whereSql) {
        sql += ` WHERE ${whereSql}`
        params.push(...whereParams)
      }
    }

    const result = await this.driver.query(sql, params)
    return result.rows[0] ?? {}
  }

  async count(where?: WhereInput): Promise<number> {
    const row = await this.aggregate({ where, _count: true })
    return Number(row._count ?? 0)
  }

  async groupBy(args: GroupByArgs): Promise<Record<string, any>[]> {
    if (!args.by || args.by.length === 0) {
      throw new Error('groupBy requires a non-empty "by" array')
    }

    const params: any[] = []
    let paramIndex = 1
    const ph = () => this.driver.getPlaceholder(paramIndex++)

    const selectParts = [...args.by.map((f) => this.quote(f)), ...this.selectAggregates(args)]
    let sql = `SELECT ${selectParts.join(', ')} FROM ${this.quote(this.tableName)}`

    if (args.where) {
      const { sql: whereSql, params: whereParams } = buildWhere(
        args.where, this.meta(), new Map(), ph, this.quote
      )
      if (whereSql) {
        sql += ` WHERE ${whereSql}`
        params.push(...whereParams)
      }
    }

    sql += ` GROUP BY ${args.by.map((f) => this.quote(f)).join(', ')}`

    if (args.having) {
      const havingParts: string[] = []
      for (const [fn, targets] of Object.entries(args.having)) {
        if (!targets) continue
        const sqlFn = AGGREGATE_FNS[fn] ?? fn.toUpperCase()
        for (const [target, cond] of Object.entries(targets as Record<string, ScalarCondition>)) {
          if (!cond) continue
          const column = aggregateExpression(sqlFn, target, this.quote)
          applyScalarCondition(havingParts, params, column, cond, ph)
        }
      }
      if (havingParts.length > 0) {
        sql += ` HAVING ${havingParts.join(' AND ')}`
      }
    }

    if (args.orderBy) {
      const orderParts = Object.entries(args.orderBy).map(
        ([key, dir]) => `${this.quote(key)} ${dir.toUpperCase()}`
      )
      if (orderParts.length > 0) sql += ` ORDER BY ${orderParts.join(', ')}`
    }

    if (args.take !== undefined) sql += ` LIMIT ${args.take}`
    if (args.skip !== undefined) sql += ` OFFSET ${args.skip}`

    const result = await this.driver.query(sql, params)
    return result.rows
  }
}
