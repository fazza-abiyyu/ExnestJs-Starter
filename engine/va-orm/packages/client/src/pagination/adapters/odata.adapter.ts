// VA-ORM OData Pagination Adapter

import type { OffsetResult, CursorResult, KeysetResult } from '../../core/types.js'

export interface ODataQueryParams {
  $top?: number
  $skip?: number
  $orderby?: string
  $filter?: string
  $select?: string
  $expand?: string
  $count?: boolean
  $cursor?: string
  $skiptoken?: string
}

export interface ODataResponse<T> {
  value: T[]
  '@odata.count'?: number
  '@odata.nextLink'?: string
  '@odata.context'?: string
}

export class ODataAdapter {
  // ============ OFFSET PAGINATION ============

  static fromOffset<T>(result: OffsetResult<T>, baseUrl: string): ODataResponse<T> {
    const response: ODataResponse<T> = {
      value: result.items,
    }

    if (result.total !== undefined) {
      response['@odata.count'] = result.total
    }

    if (result.hasNext) {
      response['@odata.nextLink'] = `${baseUrl}?$top=${result.limit}&$skip=${result.skip + result.limit}`
    }

    return response
  }

  static toOffsetOptions(params: ODataQueryParams): {
    page: number
    limit: number
    skip: number
  } {
    const top = params.$top ?? 10
    const skip = params.$skip ?? 0

    return {
      page: Math.floor(skip / top) + 1,
      limit: top,
      skip,
    }
  }

  // ============ CURSOR PAGINATION ============

  static fromCursor<T>(result: CursorResult<T>, baseUrl: string): ODataResponse<T> {
    const response: ODataResponse<T> = {
      value: result.items,
    }

    if (result.hasMore && result.nextCursor) {
      response['@odata.nextLink'] = `${baseUrl}?$cursor=${result.nextCursor}`
    }

    return response
  }

  static toCursorOptions(params: ODataQueryParams): {
    cursor?: string
    limit: number
    direction: 'forward' | 'backward'
  } {
    return {
      cursor: params.$cursor,
      limit: params.$top ?? 10,
      direction: 'forward',
    }
  }

  // ============ KEYSET PAGINATION ============

  static fromKeyset<T>(result: KeysetResult<T>, baseUrl: string): ODataResponse<T> {
    const response: ODataResponse<T> = {
      value: result.items,
    }

    if (result.hasMore && result.nextAfter) {
      response['@odata.nextLink'] = `${baseUrl}?$skiptoken=${JSON.stringify(result.nextAfter)}`
    }

    return response
  }

  static toKeysetOptions(params: ODataQueryParams): {
    after?: Record<string, any>
    limit: number
    direction: 'forward' | 'backward'
  } {
    let after: Record<string, any> | undefined
    if (params.$skiptoken) {
      try {
        after = JSON.parse(params.$skiptoken)
      } catch {
        // Invalid skiptoken
      }
    }

    return {
      after,
      limit: params.$top ?? 10,
      direction: 'forward',
    }
  }

  // ============ FILTER PARSING ============

  static parseFilter(filter: string): Record<string, any> {
    // Simple OData filter parsing
    const conditions: Record<string, any> = {}

    // Parse simple eq filters: "field eq 'value'" or "field eq 123"
    const eqRegex = /(\w+)\s+eq\s+(?:'([^']*)'|(\d+))/g
    let match

    while ((match = eqRegex.exec(filter)) !== null) {
      const [, field, stringValue, numericValue] = match
      conditions[field] = numericValue ? Number(numericValue) : stringValue
    }

    return conditions
  }

  // ============ ORDERBY PARSING ============

  static parseOrderBy(orderby: string): Array<{ column: string; direction: 'asc' | 'desc' }> {
    return orderby.split(',').map(part => {
      const [column, direction] = part.trim().split(' ')
      return {
        column,
        direction: (direction?.toLowerCase() as 'asc' | 'desc') ?? 'asc',
      }
    })
  }
}
