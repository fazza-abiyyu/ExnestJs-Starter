// VA-ORM Cursor Pagination

import type { DatabaseDriver, CursorOptions, CursorResult } from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'

export class CursorPagination<T extends Record<string, any>> {
  constructor(
    private driver: DatabaseDriver,
    private tableName: string,
    private cursorColumn: string = 'id'
  ) {}

  async paginate(options: CursorOptions & {
    where?: Partial<T>
    orderBy?: { [K in keyof T]?: 'asc' | 'desc' }
    select?: string[]
  } = {}): Promise<CursorResult<T>> {
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

    // Cursor-based filtering
    if (options.cursor) {
      if (direction === 'forward') {
        builder.where((eb) => {
          eb.gt(this.cursorColumn, options.cursor)
        })
      } else {
        builder.where((eb) => {
          eb.lt(this.cursorColumn, options.cursor)
        })
      }
    }

    // Order by
    if (options.orderBy) {
      for (const [key, direction] of Object.entries(options.orderBy)) {
        builder.orderBy(key, direction as 'asc' | 'desc')
      }
    } else {
      builder.orderBy(this.cursorColumn, direction === 'forward' ? 'asc' : 'desc')
    }

    // Fetch one extra to determine if there are more
    builder.limit(limit + 1)

    const items = await builder.execute()
    const hasMore = items.length > limit
    const resultItems = hasMore ? items.slice(0, limit) : items

    // Get cursors
    let nextCursor: string | undefined
    let previousCursor: string | undefined

    if (hasMore && resultItems.length > 0) {
      nextCursor = String(resultItems[resultItems.length - 1][this.cursorColumn])
    }

    if (options.cursor && resultItems.length > 0) {
      previousCursor = String(resultItems[0][this.cursorColumn])
    }

    return {
      items: resultItems,
      nextCursor,
      previousCursor,
      hasMore,
      hasPrevious: !!options.cursor,
    }
  }

  static create<T extends Record<string, any>>(
    driver: DatabaseDriver,
    tableName: string,
    cursorColumn?: string
  ): CursorPagination<T> {
    return new CursorPagination<T>(driver, tableName, cursorColumn)
  }
}
