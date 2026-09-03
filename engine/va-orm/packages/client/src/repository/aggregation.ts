// VA-ORM Aggregation

import type { DatabaseDriver, AggregateResult } from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'

export class AggregationRepository<T extends Record<string, any>> {
  constructor(
    private driver: DatabaseDriver,
    private tableName: string
  ) {}

  async aggregate(options: {
    where?: Partial<T>
    groupBy?: string[]
    _count?: boolean | string[]
    _sum?: string[]
    _avg?: string[]
    _min?: string[]
    _max?: string[]
  } = {}): Promise<AggregateResult | AggregateResult[]> {
    const selectParts: string[] = []
    const params: any[] = []
    let paramIndex = 1

    // COUNT
    if (options._count === true) {
      selectParts.push('COUNT(*) as _count')
    } else if (Array.isArray(options._count)) {
      for (const field of options._count) {
        selectParts.push(`COUNT(${field}) as _count_${field}`)
      }
    }

    // SUM
    if (Array.isArray(options._sum)) {
      for (const field of options._sum) {
        selectParts.push(`SUM(${field}) as _sum_${field}`)
      }
    }

    // AVG
    if (Array.isArray(options._avg)) {
      for (const field of options._avg) {
        selectParts.push(`AVG(${field}) as _avg_${field}`)
      }
    }

    // MIN
    if (Array.isArray(options._min)) {
      for (const field of options._min) {
        selectParts.push(`MIN(${field}) as _min_${field}`)
      }
    }

    // MAX
    if (Array.isArray(options._max)) {
      for (const field of options._max) {
        selectParts.push(`MAX(${field}) as _max_${field}`)
      }
    }

    if (selectParts.length === 0) {
      selectParts.push('COUNT(*) as _count')
    }

    const sql = `SELECT ${selectParts.join(', ')} FROM ${this.tableName}`
    const result = await this.driver.query<AggregateResult>(sql, params)
    return result.rows[0]
  }

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

  async groupBy<K extends keyof T>(
    groupByFields: K[],
    options: {
      where?: Partial<T>
      having?: string
      orderBy?: { [key: string]: 'asc' | 'desc' }
      _count?: boolean
      _sum?: (keyof T)[]
      _avg?: (keyof T)[]
    } = {}
  ): Promise<any[]> {
    const selectParts: string[] = [...groupByFields.map(f => String(f))]
    const params: any[] = []
    let paramIndex = 1

    if (options._count) {
      selectParts.push('COUNT(*) as _count')
    }

    if (Array.isArray(options._sum)) {
      for (const field of options._sum) {
        selectParts.push(`SUM(${String(field)}) as _sum_${String(field)}`)
      }
    }

    if (Array.isArray(options._avg)) {
      for (const field of options._avg) {
        selectParts.push(`AVG(${String(field)}) as _avg_${String(field)}`)
      }
    }

    let sql = `SELECT ${selectParts.join(', ')} FROM ${this.tableName}`

    // WHERE
    if (options.where) {
      const whereParts: string[] = []
      for (const [key, value] of Object.entries(options.where)) {
        whereParts.push(`${key} = ${this.driver.getPlaceholder(paramIndex++)}`)
        params.push(value)
      }
      sql += ` WHERE ${whereParts.join(' AND ')}`
    }

    // GROUP BY
    sql += ` GROUP BY ${groupByFields.join(', ')}`

    // HAVING
    if (options.having) {
      sql += ` HAVING ${options.having}`
    }

    // ORDER BY
    if (options.orderBy) {
      const orderParts = Object.entries(options.orderBy).map(
        ([key, dir]) => `${key} ${dir.toUpperCase()}`
      )
      sql += ` ORDER BY ${orderParts.join(', ')}`
    }

    const result = await this.driver.query(sql, params)
    return result.rows
  }
}
