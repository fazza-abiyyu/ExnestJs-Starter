import { describe, expect, test } from 'bun:test'
import { parseODataQuery } from '../src/lib/odata/query.js'

describe('OData Query Parser', () => {
  test('should parse pagination parameters ($top and $skip)', () => {
    const query = { $top: '10', $skip: '20' }
    const parsed = parseODataQuery(query)

    expect(parsed.take).toBe(10)
    expect(parsed.skip).toBe(20)
  })

  test('should ignore non-numeric $top and $skip', () => {
    const query = { $top: 'invalid', $skip: 'abc' }
    const parsed = parseODataQuery(query)

    expect(parsed.take).toBeUndefined()
    expect(parsed.skip).toBeUndefined()
  })

  test('should parse single sorting field ($orderby)', () => {
    const query = { $orderby: 'createdAt desc' }
    const parsed = parseODataQuery(query)

    expect(parsed.orderBy).toEqual({ createdAt: 'desc' })
  })

  test('should parse multiple sorting fields ($orderby)', () => {
    const query = { $orderby: 'createdAt desc, name asc' }
    const parsed = parseODataQuery(query)

    expect(parsed.orderBy).toEqual([{ createdAt: 'desc' }, { name: 'asc' }])
  })

  test('should default sorting direction to asc if direction is missing', () => {
    const query = { $orderby: 'name' }
    const parsed = parseODataQuery(query)

    expect(parsed.orderBy).toEqual({ name: 'asc' })
  })

  test('should parse select fields ($select)', () => {
    const query = { $select: 'id,name,email' }
    const parsed = parseODataQuery(query)

    expect(parsed.select).toEqual({
      id: true,
      name: true,
      email: true,
    })
  })

  test('should return empty object if query is empty', () => {
    const parsed = parseODataQuery({})
    expect(parsed).toEqual({})
  })
})