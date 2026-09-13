// VA-ORM REST Pagination Adapter

import type { OffsetResult, CursorResult, KeysetResult } from '../../core/types.js'

export interface RestQueryParams {
  page?: number
  limit?: number
  offset?: number
  cursor?: string
  after?: string
  sort?: string
  order?: 'asc' | 'desc'
  fields?: string
}

export interface RestResponse<T> {
  data: T[]
  meta: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrevious: boolean
  }
  links?: {
    self: string
    next?: string
    previous?: string
    first?: string
    last?: string
  }
}

export class RestAdapter {
  // ============ OFFSET PAGINATION ============

  static fromOffset<T>(result: OffsetResult<T>, baseUrl: string): RestResponse<T> {
    const response: RestResponse<T> = {
      data: result.items,
      meta: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: result.totalPages,
        hasNext: result.hasNext,
        hasPrevious: result.hasPrevious,
      },
      links: {
        self: baseUrl,
      },
    }

    if (result.hasNext) {
      const nextParams = new URLSearchParams()
      nextParams.set('page', String(result.page + 1))
      nextParams.set('limit', String(result.limit))
      response.links!.next = `${baseUrl}?${nextParams.toString()}`
    }

    if (result.hasPrevious) {
      const prevParams = new URLSearchParams()
      prevParams.set('page', String(result.page - 1))
      prevParams.set('limit', String(result.limit))
      response.links!.previous = `${baseUrl}?${prevParams.toString()}`
    }

    return response
  }

  static toOffsetOptions(params: RestQueryParams): {
    page: number
    limit: number
    skip: number
  } {
    const limit = params.limit ?? 10
    const skip = params.offset ?? ((params.page ?? 1) - 1) * limit
    const page = params.page ?? (params.offset !== undefined ? Math.floor(params.offset / limit) + 1 : 1)

    return { page, limit, skip }
  }

  // ============ CURSOR PAGINATION ============

  static fromCursor<T>(result: CursorResult<T>, baseUrl: string): RestResponse<T> {
    const response: RestResponse<T> = {
      data: result.items,
      meta: {
        total: 0, // Cursor pagination doesn't provide total
        page: 0,
        limit: result.items.length,
        totalPages: 0,
        hasNext: result.hasMore,
        hasPrevious: result.hasPrevious,
      },
      links: {
        self: baseUrl,
      },
    }

    if (result.hasMore && result.nextCursor) {
      const nextParams = new URLSearchParams()
      nextParams.set('cursor', result.nextCursor)
      response.links!.next = `${baseUrl}?${nextParams.toString()}`
    }

    return response
  }

  static toCursorOptions(params: RestQueryParams): {
    cursor?: string
    limit: number
    direction: 'forward' | 'backward'
  } {
    return {
      cursor: params.cursor,
      limit: params.limit ?? 10,
      direction: 'forward',
    }
  }

  // ============ KEYSET PAGINATION ============

  static fromKeyset<T>(result: KeysetResult<T>, baseUrl: string): RestResponse<T> {
    const response: RestResponse<T> = {
      data: result.items,
      meta: {
        total: 0, // Keyset pagination doesn't provide total
        page: 0,
        limit: result.items.length,
        totalPages: 0,
        hasNext: result.hasMore,
        hasPrevious: result.hasPrevious,
      },
      links: {
        self: baseUrl,
      },
    }

    if (result.hasMore && result.nextAfter) {
      const nextParams = new URLSearchParams()
      nextParams.set('after', JSON.stringify(result.nextAfter))
      response.links!.next = `${baseUrl}?${nextParams.toString()}`
    }

    return response
  }

  static toKeysetOptions(params: RestQueryParams): {
    after?: Record<string, any>
    limit: number
    direction: 'forward' | 'backward'
  } {
    let after: Record<string, any> | undefined
    if (params.after) {
      try {
        after = JSON.parse(params.after)
      } catch {
        // Invalid after parameter
      }
    }

    return {
      after,
      limit: params.limit ?? 10,
      direction: 'forward',
    }
  }

  // ============ SORT PARSING ============

  static parseSort(sort?: string, order?: 'asc' | 'desc'): Array<{ column: string; direction: 'asc' | 'desc' }> {
    if (!sort) return []

    return sort.split(',').map(column => ({
      column: column.trim(),
      direction: order ?? 'asc',
    }))
  }

  // ============ FIELDS PARSING ============

  static parseFields(fields?: string): string[] {
    if (!fields) return []
    return fields.split(',').map(f => f.trim())
  }
}
