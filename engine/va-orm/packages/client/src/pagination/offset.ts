// VA-ORM Offset Pagination

import type { DatabaseDriver, OffsetOptions, OffsetResult } from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'

export class OffsetPagination<T extends Record<string, any>> {
  constructor(
    private driver: DatabaseDriver,
    private tableName: string
  ) {}

  async paginate(options: OffsetOptions & {
    where?: Partial<T>
    orderBy?: { [K in keyof T]?: 'asc' | 'desc' }
    select?: string[]
  } = {}): Promise<OffsetResult<T>> {
    const page = options.page ?? 1
    const limit = options.limit ?? 10
    const skip = options.skip ?? (page - 1) * limit

    const builder = new QueryBuilder<T>(this.driver, this.tableName)

    if (options.select) {
      builder.select(...options.select)
    }

    if (options.where) {
      builder.where((eb) => {
        for (const [key, value] of Object.entries(options.where!)) {
          eb.eq(key, value)
        }
      })
    }

    if (options.orderBy) {
      for (const [key, direction] of Object.entries(options.orderBy)) {
        builder.orderBy(key, direction as 'asc' | 'desc')
      }
    }

    builder.limit(limit).offset(skip)
    const items = await builder.execute()

    const countBuilder = new QueryBuilder(this.driver, this.tableName)
    if (options.where) {
      countBuilder.where((eb) => {
        for (const [key, value] of Object.entries(options.where!)) {
          eb.eq(key, value)
        }
      })
    }
    const total = await countBuilder.count()

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

  static create<T extends Record<string, any>>(driver: DatabaseDriver, tableName: string): OffsetPagination<T> {
    return new OffsetPagination<T>(driver, tableName)
  }
}
