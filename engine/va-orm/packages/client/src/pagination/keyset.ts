// VA-ORM Keyset Pagination

import type { DatabaseDriver, KeysetOptions, KeysetResult } from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'

export class KeysetPagination<T extends Record<string, any>> {
  constructor(
    private driver: DatabaseDriver,
    private tableName: string,
    private keyColumns: string[] = ['id']
  ) {}

  async paginate(options: KeysetOptions & {
    where?: Partial<T>
    orderBy?: { [K in keyof T]?: 'asc' | 'desc' }
    select?: string[]
  } = {}): Promise<KeysetResult<T>> {
    const limit = options.limit ?? 10
    const direction = options.direction ?? 'forward'

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

    // Keyset-based filtering
    if (options.after) {
      builder.where((eb) => {
        // For multiple key columns, we need composite keyset logic
        if (this.keyColumns.length === 1) {
          const col = this.keyColumns[0]
          const val = options.after![col]
          if (direction === 'forward') {
            eb.gt(col, val)
          } else {
            eb.lt(col, val)
          }
        } else {
          // Composite keyset: (col1, col2, ...) > (val1, val2, ...)
          const conditions: string[] = []
          for (let i = 0; i < this.keyColumns.length; i++) {
            const col = this.keyColumns[i]
            const val = options.after![col]
            if (i === this.keyColumns.length - 1) {
              // Last column: simple comparison
              if (direction === 'forward') {
                eb.gt(col, val)
              } else {
                eb.lt(col, val)
              }
            } else {
              // Previous columns: equality
              eb.eq(col, val)
            }
          }
        }
      })
    }

    // Order by
    if (options.orderBy) {
      for (const [key, dir] of Object.entries(options.orderBy)) {
        builder.orderBy(key, dir as 'asc' | 'desc')
      }
    } else {
      for (const col of this.keyColumns) {
        builder.orderBy(col, direction === 'forward' ? 'asc' : 'desc')
      }
    }

    // Fetch one extra to determine if there are more
    builder.limit(limit + 1)

    const items = await builder.execute()
    const hasMore = items.length > limit
    const resultItems = hasMore ? items.slice(0, limit) : items

    // Get next after cursor
    let nextAfter: Record<string, any> | undefined

    if (hasMore && resultItems.length > 0) {
      const lastItem = resultItems[resultItems.length - 1]
      nextAfter = {}
      for (const col of this.keyColumns) {
        nextAfter[col] = lastItem[col]
      }
    }

    return {
      items: resultItems,
      nextAfter,
      hasMore,
      hasPrevious: !!options.after,
    }
  }

  static create<T extends Record<string, any>>(
    driver: DatabaseDriver,
    tableName: string,
    keyColumns?: string[]
  ): KeysetPagination<T> {
    return new KeysetPagination<T>(driver, tableName, keyColumns)
  }
}
