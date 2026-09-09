// VA-ORM Field Operations Spec

import { describe, it, expect } from 'bun:test'
import { MockDriver } from '../../../../test-setup.js'
import { Repository } from '../repository/repository.js'
import { buildSetClause, isFieldOperation } from '../repository/field.ops.js'

describe('isFieldOperation', () => {
  it('should detect operation objects', () => {
    expect(isFieldOperation({ increment: 1 })).toBe(true)
    expect(isFieldOperation({ decrement: 1 })).toBe(true)
    expect(isFieldOperation({ set: 'x' })).toBe(true)
    expect(isFieldOperation('plain')).toBe(false)
    expect(isFieldOperation(5)).toBe(false)
    expect(isFieldOperation(null)).toBe(false)
    expect(isFieldOperation([1])).toBe(false)
  })
})

describe('buildSetClause', () => {
  const ph = (i: number) => `$${i}`

  it('should build plain assignments', () => {
    const { setParts, params, nextIndex } = buildSetClause({ name: 'John', age: 30 }, ph)
    expect(setParts).toEqual(['"name" = $1', '"age" = $2'])
    expect(params).toEqual(['John', 30])
    expect(nextIndex).toBe(3)
  })

  it('should build increment', () => {
    const { setParts, params } = buildSetClause({ age: { increment: 1 } }, ph)
    expect(setParts).toEqual(['"age" = "age" + $1'])
    expect(params).toEqual([1])
  })

  it('should build decrement', () => {
    const { setParts, params } = buildSetClause({ balance: { decrement: 100 } }, ph)
    expect(setParts).toEqual(['"balance" = "balance" - $1'])
    expect(params).toEqual([100])
  })

  it('should build set operation', () => {
    const { setParts, params } = buildSetClause({ name: { set: 'Jane' } }, ph)
    expect(setParts).toEqual(['"name" = $1'])
    expect(params).toEqual(['Jane'])
  })

  it('should mix plain and operations', () => {
    const { setParts, params, nextIndex } = buildSetClause(
      { name: 'John', age: { increment: 1 } },
      ph
    )
    expect(setParts).toEqual(['"name" = $1', '"age" = "age" + $2'])
    expect(params).toEqual(['John', 1])
    expect(nextIndex).toBe(3)
  })
})

describe('Repository field operations', () => {
  it('should update with increment', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, age: 31 }], rowCount: 1 })
    const repo = new Repository(driver, 'users')

    await repo.update({ id: 1 }, { age: { increment: 1 } } as any)

    const query = driver.getQueries()[0]
    expect(query.sql).toBe('UPDATE users SET "age" = "age" + $1 WHERE id = $2 RETURNING *')
    expect(query.params).toEqual([1, 1])
  })

  it('should updateMany with decrement and set', async () => {
    const driver = new MockDriver()
    driver.setResult({ rowCount: 3 })
    const repo = new Repository(driver, 'users')

    await repo.updateMany({ status: 'active' }, { balance: { decrement: 50 }, name: { set: 'X' } } as any)

    const query = driver.getQueries()[0]
    expect(query.sql).toBe(
      'UPDATE users SET "balance" = "balance" - $1, "name" = $2 WHERE status = $3'
    )
    expect(query.params).toEqual([50, 'X', 'active'])
  })
})
