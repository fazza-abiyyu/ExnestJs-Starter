// VA-ORM Select Projection Spec

import { describe, it, expect } from 'bun:test'
import { MockDriver } from '../../../../test-setup.js'
import type { ModelMeta } from '../core/types.js'
import { ModelDelegate } from '../repository/model.delegate.js'
import { resolveSelect } from '../relation/select.js'

function userModel(): ModelMeta {
  return {
    name: 'User',
    table: 'users',
    primaryKey: 'id',
    relations: new Map([
      ['posts', {
        field: 'posts', targetModel: 'Post', isList: true, kind: 'one-to-many',
        fkModel: 'Post', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        backField: 'author', isFkHolder: false,
      }],
    ]),
  }
}

function postModel(): ModelMeta {
  return {
    name: 'Post',
    table: 'posts',
    primaryKey: 'id',
    relations: new Map([
      ['author', {
        field: 'author', targetModel: 'User', isList: false, kind: 'many-to-one',
        fkModel: 'Post', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        backField: 'posts', isFkHolder: true,
      }],
    ]),
  }
}

function registry(): Map<string, ModelMeta> {
  return new Map([['User', userModel()], ['Post', postModel()]])
}

describe('resolveSelect', () => {
  it('should return null columns without select', () => {
    expect(resolveSelect(userModel())).toEqual({ columns: null, keep: null })
    expect(resolveSelect(userModel(), {})).toEqual({ columns: null, keep: null })
  })

  it('should support array form', () => {
    expect(resolveSelect(userModel(), ['name', 'email'])).toEqual({
      columns: ['name', 'email', 'id'],
      keep: ['name', 'email'],
    })
  })

  it('should support object form', () => {
    expect(resolveSelect(userModel(), { name: true, email: false })).toEqual({
      columns: ['name', 'id'],
      keep: ['name'],
    })
  })

  it('should not strip explicitly selected pk', () => {
    expect(resolveSelect(userModel(), ['id', 'name'])).toEqual({
      columns: ['id', 'name'],
      keep: ['id', 'name'],
    })
  })

  it('should auto-include FK for single included relations', () => {
    expect(resolveSelect(postModel(), ['title'], { author: true })).toEqual({
      columns: ['title', 'id', 'userId'],
      keep: ['title', 'author'],
    })
  })

  it('should not need extra columns for list includes', () => {
    expect(resolveSelect(userModel(), ['name'], { posts: true })).toEqual({
      columns: ['name', 'id'],
      keep: ['name', 'posts'],
    })
  })
})

describe('ModelDelegate select', () => {
  it('should project columns and strip auto-added pk', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John', email: 'j@x.com' }], rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    const result = await users.findMany({ select: ['name'] })

    expect(driver.getQueries()[0].sql).toBe('SELECT "name", "id" FROM "users"')
    expect(result).toEqual([{ name: 'John' }])
  })

  it('should select without include', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    const result = await users.findUnique({ where: { id: 1 }, select: { id: true, name: true } })

    expect(driver.getQueries()[0].sql).toContain('SELECT "id", "name" FROM "users"')
    expect(result).toEqual({ id: 1, name: 'John' })
  })

  it('should keep FK for single include then strip it', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 10, title: 'A', userId: 1 }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })

    const posts = new ModelDelegate(driver, postModel(), registry())
    const result = await posts.findMany({ select: ['title'], include: { author: true } })

    expect(driver.getQueries()[0].sql).toBe('SELECT "title", "id", "userId" FROM "posts"')
    expect(result).toEqual([{ title: 'A', author: { id: 1, name: 'John' } }])
  })

  it('should project child columns in include', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A', content: 'long...' }], rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    const result = await users.findMany({ include: { posts: { select: ['title'] } } })

    expect(driver.getQueries()[1].sql).toBe('SELECT "title", "id", "userId" FROM "posts" WHERE "userId" IN ($1)')
    expect(result[0].posts).toEqual([{ title: 'A' }])
  })

  it('should project M:N child columns', async () => {
    const driver = new MockDriver()
    const reg = new Map<string, ModelMeta>([
      ['Post', {
        name: 'Post', table: 'posts', primaryKey: 'id',
        relations: new Map([['tags', {
          field: 'tags', targetModel: 'Tag', isList: true, kind: 'many-to-many-implicit',
          fkModel: 'Post', fkFields: [], pkModel: 'Post', pkFields: ['id'],
          backField: 'posts', isFkHolder: false, joinTable: '_PostToTag',
        }]]),
      }],
      ['Tag', {
        name: 'Tag', table: 'tags', primaryKey: 'id',
        relations: new Map(),
      }],
    ])
    driver.setResult({ rows: [{ id: 10, title: 'A' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 100, label: 'tech', __parent_key: 10 }], rowCount: 1 })

    const posts = new ModelDelegate(driver, reg.get('Post')!, reg)
    const result = await posts.findMany({ include: { tags: { select: ['label'] } } })

    expect(driver.getQueries()[1].sql).toContain('__c."label", __c."id"')
    expect(result[0].tags).toEqual([{ label: 'tech' }])
  })
})
