// VA-ORM GraphQL Pagination Adapter

import type { OffsetResult, CursorResult, KeysetResult } from '../core/types.js'

export interface GraphQLPageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  startCursor?: string
  endCursor?: string
}

export interface GraphQLConnection<T> {
  edges: Array<{
    node: T
    cursor: string
  }>
  pageInfo: GraphQLPageInfo
  totalCount?: number
}

export interface GraphQLQueryArgs {
  first?: number
  last?: number
  after?: string
  before?: string
  offset?: number
}

export class GraphQLAdapter {
  // ============ OFFSET PAGINATION ============

  static fromOffset<T extends Record<string, any>>(
    result: OffsetResult<T>,
    cursorField: string = 'id'
  ): GraphQLConnection<T> {
    const edges = result.items.map((item, index) => ({
      node: item,
      cursor: Buffer.from(`${result.skip + index}`).toString('base64'),
    }))

    return {
      edges,
      pageInfo: {
        hasNextPage: result.hasNext,
        hasPreviousPage: result.hasPrevious,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount: result.total,
    }
  }

  static toOffsetOptions(args: GraphQLQueryArgs): {
    page: number
    limit: number
    skip: number
  } {
    const limit = args.first ?? args.last ?? 10
    const skip = args.offset ?? 0

    return {
      page: Math.floor(skip / limit) + 1,
      limit,
      skip,
    }
  }

  // ============ CURSOR PAGINATION ============

  static fromCursor<T extends Record<string, any>>(
    result: CursorResult<T>,
    cursorField: string = 'id'
  ): GraphQLConnection<T> {
    const edges = result.items.map(item => ({
      node: item,
      cursor: Buffer.from(String(item[cursorField])).toString('base64'),
    }))

    return {
      edges,
      pageInfo: {
        hasNextPage: result.hasMore,
        hasPreviousPage: result.hasPrevious,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
    }
  }

  static toCursorOptions(args: GraphQLQueryArgs): {
    cursor?: string
    limit: number
    direction: 'forward' | 'backward'
  } {
    let cursor: string | undefined
    if (args.after) {
      const decoded = Buffer.from(args.after, 'base64').toString('utf-8')
      try {
        const parsed = JSON.parse(decoded)
        cursor = typeof parsed === 'string' ? parsed : decoded
      } catch {
        cursor = decoded
      }
    } else if (args.before) {
      const decoded = Buffer.from(args.before, 'base64').toString('utf-8')
      try {
        const parsed = JSON.parse(decoded)
        cursor = typeof parsed === 'string' ? parsed : decoded
      } catch {
        cursor = decoded
      }
    }

    return {
      cursor,
      limit: args.first ?? args.last ?? 10,
      direction: args.first ? 'forward' : 'backward',
    }
  }

  // ============ KEYSET PAGINATION ============

  static fromKeyset<T extends Record<string, any>>(
    result: KeysetResult<T>,
    cursorField: string = 'id'
  ): GraphQLConnection<T> {
    const edges = result.items.map(item => ({
      node: item,
      cursor: Buffer.from(JSON.stringify({ [cursorField]: item[cursorField] })).toString('base64'),
    }))

    return {
      edges,
      pageInfo: {
        hasNextPage: result.hasMore,
        hasPreviousPage: result.hasPrevious,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
    }
  }

  static toKeysetOptions(args: GraphQLQueryArgs): {
    after?: Record<string, any>
    limit: number
    direction: 'forward' | 'backward'
  } {
    let after: Record<string, any> | undefined
    if (args.after) {
      try {
        after = JSON.parse(Buffer.from(args.after, 'base64').toString('utf-8'))
      } catch {
        // Invalid cursor
      }
    }

    return {
      after,
      limit: args.first ?? args.last ?? 10,
      direction: args.first ? 'forward' : 'backward',
    }
  }

  // ============ CURSOR ENCODING ============

  static encodeCursor(data: any): string {
    return Buffer.from(JSON.stringify(data)).toString('base64')
  }

  static decodeCursor(cursor: string): any {
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'))
    } catch {
      return null
    }
  }
}
