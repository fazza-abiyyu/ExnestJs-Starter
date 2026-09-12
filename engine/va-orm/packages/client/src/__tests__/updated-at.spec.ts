// VA-ORM @updatedAt Auto-Touch Spec

import { describe, it, expect } from 'bun:test'
import { Repository } from '../repository/repository.js'
import { NestedWriter } from '../repository/nested.writes.js'
import { findUpdatedAtField } from '../core/va.client.js'
import { MockDriver } from '../../../../test-setup.js'

const updatedAtAttr = [{ name: '@updatedAt' }]

function postMeta() {
  return {
    name: 'Post',
    table: 'posts',
    primaryKey: 'id',
    relations: new Map(),
    fields: [
      { name: 'id', attributes: [] },
      { name: 'title', attributes: [] },
      { name: 'updatedAt', attributes: updatedAtAttr },
    ],
  } as any
}

describe('Repository @updatedAt', () => {
  it('injects updatedAt on create when absent', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
    const repo = new Repository<any>(driver, 'posts', { updatedAtField: 'updatedAt' })

    await repo.create({ title: 'A' })

    const query = driver.getQueries()[0]
    expect(query.sql).toContain('updatedAt')
    const dateParam = query.params!.find((p) => p instanceof Date)
    expect(dateParam).toBeInstanceOf(Date)
  })

  it('respects explicit updatedAt on create', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
    const repo = new Repository<any>(driver, 'posts', { updatedAtField: 'updatedAt' })
    const explicit = new Date('2020-01-01T00:00:00Z')

    await repo.create({ title: 'A', updatedAt: explicit })

    const query = driver.getQueries()[0]
    expect(query.params).toContain(explicit)
    expect(query.params!.filter((p) => p instanceof Date)).toHaveLength(1)
  })

  it('does nothing without the option', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
    const repo = new Repository<any>(driver, 'posts')

    await repo.create({ title: 'A' })

    const query = driver.getQueries()[0]
    expect(query.sql).not.toContain('updatedAt')
  })

  it('injects updatedAt on update', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1 }], rowCount: 1 })
    const repo = new Repository<any>(driver, 'posts', { updatedAtField: 'updatedAt' })

    await repo.update({ id: 1 }, { title: 'B' })

    const query = driver.getQueries()[0]
    expect(query.sql).toContain('updatedat')
    expect(query.params!.some((p) => p instanceof Date)).toBe(true)
  })
})

describe('findUpdatedAtField', () => {
  const schema: any = {
    model: [
      {
        name: 'Customer',
        fields: [
          { name: 'id', attributes: [] },
          { name: 'updatedAt', attributes: [{ name: '@updatedAt' }] },
        ],
      },
      { name: 'Tag', fields: [{ name: 'id', attributes: [] }] },
    ],
  }

  it('finds the field by model name', () => {
    expect(findUpdatedAtField(schema, 'Customer')).toBe('updatedAt')
  })

  it('matches lowercase repository keys', () => {
    expect(findUpdatedAtField(schema, 'customer')).toBe('updatedAt')
  })

  it('returns undefined when absent', () => {
    expect(findUpdatedAtField(schema, 'Tag')).toBeUndefined()
    expect(findUpdatedAtField(undefined, 'Tag')).toBeUndefined()
  })
})

describe('NestedWriter @updatedAt', () => {
  function writerWithMeta() {
    const driver = new MockDriver()
    const registry = new Map([['Post', postMeta()]])
    const writer = new NestedWriter(driver as never, registry)
    return { driver, writer }
  }

  it('injects updatedAt on nested create', async () => {
    const { driver, writer } = writerWithMeta()
    driver.setResult({ rows: [{ id: 1, title: 'A' }], rowCount: 1 })

    await writer.create('Post', { title: 'A' })

    const query = driver.getQueries()[0]
    expect(query.sql).toContain('updatedat')
    expect(query.params!.some((p) => p instanceof Date)).toBe(true)
  })

  it('injects updatedAt on nested update', async () => {
    const { driver, writer } = writerWithMeta()
    driver.setResult({ rows: [{ id: 1, title: 'A' }], rowCount: 1 })

    await writer.update('Post', { id: 1 }, { title: 'B' })

    const query = driver.getQueries().find((q) => q.sql.startsWith('UPDATE'))!
    expect(query.sql).toContain('updatedat')
  })

  it('skips touch when registry has no fields', async () => {
    const driver = new MockDriver()
    const bareMeta = { name: 'Post', table: 'posts', primaryKey: 'id', relations: new Map() }
    const writer = new NestedWriter(driver as never, new Map([['Post', bareMeta]]) as never)
    driver.setResult({ rows: [{ id: 1, title: 'A' }], rowCount: 1 })

    await writer.create('Post', { title: 'A' })

    const query = driver.getQueries()[0]
    expect(query.sql).not.toContain('updatedat')
  })
})
