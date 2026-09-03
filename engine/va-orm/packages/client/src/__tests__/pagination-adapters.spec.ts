// VA-ORM Pagination Adapters Spec

import { describe, it, expect } from 'bun:test'
import { ODataAdapter } from '../pagination/adapters/odata.adapter.js'
import { RestAdapter } from '../pagination/adapters/rest.adapter.js'
import { GraphQLAdapter } from '../pagination/adapters/graphql.adapter.js'

describe('Pagination Adapters', () => {
  const mockOffsetResult = {
    items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    total: 10,
    page: 1,
    limit: 3,
    skip: 0,
    totalPages: 4,
    hasNext: true,
    hasPrevious: false,
  }

  const mockCursorResult = {
    items: [{ id: 2 }, { id: 3 }, { id: 4 }],
    nextCursor: '4',
    hasMore: true,
    hasPrevious: true,
  }

  const mockKeysetResult = {
    items: [{ id: 2 }, { id: 3 }, { id: 4 }],
    nextAfter: { id: 4 },
    hasMore: true,
    hasPrevious: true,
  }

  describe('ODataAdapter', () => {
    describe('fromOffset', () => {
      it('should convert offset result to OData response', () => {
        const response = ODataAdapter.fromOffset(mockOffsetResult, 'http://api/users')
        expect(response.value).toEqual(mockOffsetResult.items)
        expect(response['@odata.count']).toBe(10)
        expect(response['@odata.nextLink']).toContain('$top=3')
        expect(response['@odata.nextLink']).toContain('$skip=3')
      })

      it('should not include nextLink for last page', () => {
        const result = { ...mockOffsetResult, hasNext: false }
        const response = ODataAdapter.fromOffset(result, 'http://api/users')
        expect(response['@odata.nextLink']).toBeUndefined()
      })
    })

    describe('toOffsetOptions', () => {
      it('should parse OData query params to offset options', () => {
        const options = ODataAdapter.toOffsetOptions({ $top: 10, $skip: 20 })
        expect(options).toEqual({ page: 3, limit: 10, skip: 20 })
      })

      it('should use defaults', () => {
        const options = ODataAdapter.toOffsetOptions({})
        expect(options).toEqual({ page: 1, limit: 10, skip: 0 })
      })
    })

    describe('fromCursor', () => {
      it('should convert cursor result to OData response', () => {
        const response = ODataAdapter.fromCursor(mockCursorResult, 'http://api/users')
        expect(response.value).toEqual(mockCursorResult.items)
        expect(response['@odata.nextLink']).toContain('$cursor=4')
      })

      it('should not include nextLink when no more results', () => {
        const result = { ...mockCursorResult, hasMore: false }
        const response = ODataAdapter.fromCursor(result, 'http://api/users')
        expect(response['@odata.nextLink']).toBeUndefined()
      })
    })

    describe('toCursorOptions', () => {
      it('should parse OData cursor params', () => {
        const options = ODataAdapter.toCursorOptions({ $cursor: '123', $top: 5 })
        expect(options).toEqual({ cursor: '123', limit: 5, direction: 'forward' })
      })
    })

    describe('fromKeyset', () => {
      it('should convert keyset result to OData response', () => {
        const response = ODataAdapter.fromKeyset(mockKeysetResult, 'http://api/users')
        expect(response.value).toEqual(mockKeysetResult.items)
        expect(response['@odata.nextLink']).toContain('$skiptoken=')
      })
    })

    describe('toKeysetOptions', () => {
      it('should parse OData keyset params', () => {
        const options = ODataAdapter.toKeysetOptions({
          $skiptoken: JSON.stringify({ id: 10 }),
          $top: 5,
        })
        expect(options).toEqual({ after: { id: 10 }, limit: 5, direction: 'forward' })
      })

      it('should handle invalid skiptoken', () => {
        const options = ODataAdapter.toKeysetOptions({ $skiptoken: 'invalid' })
        expect(options.after).toBeUndefined()
      })
    })

    describe('parseFilter', () => {
      it('should parse simple eq filter', () => {
        const filter = ODataAdapter.parseFilter("status eq 'active'")
        expect(filter).toEqual({ status: 'active' })
      })

      it('should parse numeric filter', () => {
        const filter = ODataAdapter.parseFilter('age eq 25')
        expect(filter).toEqual({ age: 25 })
      })
    })

    describe('parseOrderBy', () => {
      it('should parse single orderby', () => {
        const orderby = ODataAdapter.parseOrderBy('name asc')
        expect(orderby).toEqual([{ column: 'name', direction: 'asc' }])
      })

      it('should parse multiple orderby', () => {
        const orderby = ODataAdapter.parseOrderBy('name asc, age desc')
        expect(orderby).toEqual([
          { column: 'name', direction: 'asc' },
          { column: 'age', direction: 'desc' },
        ])
      })
    })
  })

  describe('RestAdapter', () => {
    describe('fromOffset', () => {
      it('should convert offset result to REST response', () => {
        const response = RestAdapter.fromOffset(mockOffsetResult, 'http://api/users')
        expect(response.data).toEqual(mockOffsetResult.items)
        expect(response.meta).toEqual({
          total: 10,
          page: 1,
          limit: 3,
          totalPages: 4,
          hasNext: true,
          hasPrevious: false,
        })
        expect(response.links?.self).toBe('http://api/users')
        expect(response.links?.next).toContain('page=2')
      })

      it('should not include next link for last page', () => {
        const result = { ...mockOffsetResult, hasNext: false }
        const response = RestAdapter.fromOffset(result, 'http://api/users')
        expect(response.links?.next).toBeUndefined()
      })

      it('should include previous link when not first page', () => {
        const result = { ...mockOffsetResult, page: 2, hasPrevious: true }
        const response = RestAdapter.fromOffset(result, 'http://api/users')
        expect(response.links?.previous).toContain('page=1')
      })
    })

    describe('toOffsetOptions', () => {
      it('should parse REST params to offset options', () => {
        const options = RestAdapter.toOffsetOptions({ page: 2, limit: 10 })
        expect(options).toEqual({ page: 2, limit: 10, skip: 10 })
      })

      it('should handle offset param', () => {
        const options = RestAdapter.toOffsetOptions({ offset: 20, limit: 10 })
        expect(options).toEqual({ page: 3, limit: 10, skip: 20 })
      })
    })

    describe('fromCursor', () => {
      it('should convert cursor result to REST response', () => {
        const response = RestAdapter.fromCursor(mockCursorResult, 'http://api/users')
        expect(response.data).toEqual(mockCursorResult.items)
        expect(response.meta.hasNext).toBe(true)
        expect(response.links?.next).toContain('cursor=4')
      })
    })

    describe('toCursorOptions', () => {
      it('should parse REST cursor params', () => {
        const options = RestAdapter.toCursorOptions({ cursor: '123', limit: 5 })
        expect(options).toEqual({ cursor: '123', limit: 5, direction: 'forward' })
      })
    })

    describe('fromKeyset', () => {
      it('should convert keyset result to REST response', () => {
        const response = RestAdapter.fromKeyset(mockKeysetResult, 'http://api/users')
        expect(response.data).toEqual(mockKeysetResult.items)
        expect(response.links?.next).toContain('after=')
      })
    })

    describe('toKeysetOptions', () => {
      it('should parse REST keyset params', () => {
        const options = RestAdapter.toKeysetOptions({
          after: JSON.stringify({ id: 10 }),
          limit: 5,
        })
        expect(options).toEqual({ after: { id: 10 }, limit: 5, direction: 'forward' })
      })
    })

    describe('parseSort', () => {
      it('should parse single sort', () => {
        const sort = RestAdapter.parseSort('name')
        expect(sort).toEqual([{ column: 'name', direction: 'asc' }])
      })

      it('should parse sort with order', () => {
        const sort = RestAdapter.parseSort('name', 'desc')
        expect(sort).toEqual([{ column: 'name', direction: 'desc' }])
      })

      it('should parse multiple sorts', () => {
        const sort = RestAdapter.parseSort('name,email')
        expect(sort).toEqual([
          { column: 'name', direction: 'asc' },
          { column: 'email', direction: 'asc' },
        ])
      })
    })

    describe('parseFields', () => {
      it('should parse fields string', () => {
        const fields = RestAdapter.parseFields('id,name,email')
        expect(fields).toEqual(['id', 'name', 'email'])
      })

      it('should handle empty fields', () => {
        const fields = RestAdapter.parseFields()
        expect(fields).toEqual([])
      })
    })
  })

  describe('GraphQLAdapter', () => {
    describe('fromOffset', () => {
      it('should convert offset result to GraphQL connection', () => {
        const connection = GraphQLAdapter.fromOffset(mockOffsetResult)
        expect(connection.edges.length).toBe(3)
        expect(connection.edges[0].node).toEqual({ id: 1 })
        expect(connection.edges[0].cursor).toBeDefined()
        expect(connection.pageInfo.hasNextPage).toBe(true)
        expect(connection.pageInfo.hasPreviousPage).toBe(false)
        expect(connection.totalCount).toBe(10)
      })

      it('should encode cursors as base64', () => {
        const connection = GraphQLAdapter.fromOffset(mockOffsetResult)
        const decoded = Buffer.from(connection.edges[0].cursor, 'base64').toString('utf-8')
        expect(decoded).toBe('0')
      })
    })

    describe('toOffsetOptions', () => {
      it('should parse GraphQL first arg', () => {
        const options = GraphQLAdapter.toOffsetOptions({ first: 10 })
        expect(options).toEqual({ page: 1, limit: 10, skip: 0 })
      })

      it('should parse GraphQL offset arg', () => {
        const options = GraphQLAdapter.toOffsetOptions({ first: 10, offset: 20 })
        expect(options).toEqual({ page: 3, limit: 10, skip: 20 })
      })
    })

    describe('fromCursor', () => {
      it('should convert cursor result to GraphQL connection', () => {
        const connection = GraphQLAdapter.fromCursor(mockCursorResult, 'id')
        expect(connection.edges.length).toBe(3)
        expect(connection.pageInfo.hasNextPage).toBe(true)
        expect(connection.pageInfo.hasPreviousPage).toBe(true)
      })
    })

    describe('toCursorOptions', () => {
      it('should parse GraphQL cursor args', () => {
        const cursor = GraphQLAdapter.encodeCursor('123')
        const options = GraphQLAdapter.toCursorOptions({ first: 10, after: cursor })
        expect(options.cursor).toBe('123')
        expect(options.limit).toBe(10)
        expect(options.direction).toBe('forward')
      })

      it('should handle before arg', () => {
        const cursor = GraphQLAdapter.encodeCursor('123')
        const options = GraphQLAdapter.toCursorOptions({ last: 10, before: cursor })
        expect(options.cursor).toBe('123')
        expect(options.direction).toBe('backward')
      })
    })

    describe('fromKeyset', () => {
      it('should convert keyset result to GraphQL connection', () => {
        const connection = GraphQLAdapter.fromKeyset(mockKeysetResult, 'id')
        expect(connection.edges.length).toBe(3)
        expect(connection.pageInfo.hasNextPage).toBe(true)
      })
    })

    describe('toKeysetOptions', () => {
      it('should parse GraphQL keyset args', () => {
        const cursor = GraphQLAdapter.encodeCursor({ id: 10 })
        const options = GraphQLAdapter.toKeysetOptions({ first: 5, after: cursor })
        expect(options.after).toEqual({ id: 10 })
        expect(options.limit).toBe(5)
      })
    })

    describe('cursor encoding', () => {
      it('should encode and decode cursor', () => {
        const data = { id: 123, name: 'test' }
        const encoded = GraphQLAdapter.encodeCursor(data)
        const decoded = GraphQLAdapter.decodeCursor(encoded)
        expect(decoded).toEqual(data)
      })

      it('should return null for invalid cursor', () => {
        const decoded = GraphQLAdapter.decodeCursor('invalid')
        expect(decoded).toBeNull()
      })
    })
  })
})
