// VA-ORM Nested Writes Spec

import { describe, it, expect } from 'bun:test'
import { MockDriver } from '../../../../test-setup.js'
import type { ModelMeta } from '../core/types.js'
import { ModelDelegate } from '../repository/model.delegate.js'

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
      ['tags', {
        field: 'tags', targetModel: 'Tag', isList: true, kind: 'many-to-many-implicit',
        fkModel: 'Post', fkFields: [], pkModel: 'Post', pkFields: ['id'],
        backField: 'posts', isFkHolder: false, joinTable: '_PostToTag',
      }],
    ]),
  }
}

function tagModel(): ModelMeta {
  return {
    name: 'Tag',
    table: 'tags',
    primaryKey: 'id',
    relations: new Map([
      ['posts', {
        field: 'posts', targetModel: 'Post', isList: true, kind: 'many-to-many-implicit',
        fkModel: 'Tag', fkFields: [], pkModel: 'Tag', pkFields: ['id'],
        backField: 'tags', isFkHolder: false, joinTable: '_PostToTag',
      }],
    ]),
  }
}

function registry(): Map<string, ModelMeta> {
  return new Map([
    ['User', userModel()],
    ['Post', postModel()],
    ['Tag', tagModel()],
  ])
}

describe('ModelDelegate nested create', () => {
  it('should create parent with nested children', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 11, userId: 1, title: 'B' }], rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    const user = await users.create({
      data: { name: 'John', posts: { create: [{ title: 'A' }, { title: 'B' }] } },
    })

    expect(user).toEqual({ id: 1, name: 'John' })
    const queries = driver.getQueries()
    expect(queries[0].sql).toContain('INSERT INTO "users"')
    expect(queries[1].sql).toContain('INSERT INTO "posts"')
    expect(queries[1].params).toContain(1)
    expect(queries).toHaveLength(3)
  })

  it('should connect existing children', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 })
    driver.setResult({ rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.create({
      data: { name: 'John', posts: { connect: [{ id: 10 }] } },
    })

    const queries = driver.getQueries()
    expect(queries[1].sql).toContain('SELECT * FROM "posts"')
    expect(queries[2].sql).toContain('UPDATE "posts" SET "userId"')
    expect(queries[2].params).toEqual([1, 10])
  })

  it('should throw when connecting missing record', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [], rowCount: 0 })

    const users = new ModelDelegate(driver, userModel(), registry())
    await expect(
      users.create({ data: { name: 'John', posts: { connect: [{ id: 999 }] } } })
    ).rejects.toThrow('connect: no Post found')
  })

  it('should connectOrCreate existing record', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rowCount: 0 }) // acquireAdvisoryLock
    driver.setResult({ rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 })
    driver.setResult({ rowCount: 1 })
    driver.setResult({ rowCount: 0 }) // releaseAdvisoryLock

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.create({
      data: {
        name: 'John',
        posts: { connectOrCreate: { where: { id: 10 }, create: { title: 'A' } } },
      },
    })

    const queries = driver.getQueries()
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO "posts"'))).toBe(false)
    expect(queries[queries.length - 2].sql).toContain('UPDATE "posts" SET "userId"')
  })

  it('should connectOrCreate new record', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rowCount: 0 }) // acquireAdvisoryLock
    driver.setResult({ rows: [], rowCount: 0 })
    driver.setResult({ rows: [{ id: 12, userId: 1, title: 'New' }], rowCount: 1 })
    driver.setResult({ rowCount: 0 }) // releaseAdvisoryLock

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.create({
      data: {
        name: 'John',
        posts: { connectOrCreate: { where: { id: 12 }, create: { title: 'New' } } },
      },
    })

    const queries = driver.getQueries()
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO "posts"'))).toBe(true)
  })

  it('should create M:N child with join row', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 10, title: 'A' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 100, name: 'tech' }], rowCount: 1 })
    driver.setResult({ rowCount: 1 })

    const posts = new ModelDelegate(driver, postModel(), registry())
    await posts.create({
      data: { title: 'A', tags: { create: [{ name: 'tech' }] } },
    })

    const queries = driver.getQueries()
    expect(queries[1].sql).toContain('INSERT INTO "tags"')
    expect(queries[2].sql).toContain('INSERT INTO "_PostToTag"')
    expect(queries[2].params).toEqual([10, 100])
  })
})

describe('ModelDelegate nested update', () => {
  it('should disconnect children', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: 1 }], rowCount: 1 })
    driver.setResult({ rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.update({
      where: { id: 1 },
      data: { posts: { disconnect: [{ id: 10 }] } },
    })

    const queries = driver.getQueries()
    expect(queries[0].sql).toContain('SELECT * FROM "users"')
    expect(queries[queries.length - 1].sql).toContain('UPDATE "posts" SET "userId"')
    expect(queries[queries.length - 1].params).toEqual([null, 10])
  })

  it('should replace all children with set', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rowCount: 2 })
    driver.setResult({ rows: [{ id: 11, userId: null }], rowCount: 1 })
    driver.setResult({ rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.update({
      where: { id: 1 },
      data: { posts: { set: [{ id: 11 }] } },
    })

    const queries = driver.getQueries()
    expect(queries[1].sql).toContain('UPDATE "posts" SET "userId"')
    expect(queries[1].params).toEqual([null, 1])
    expect(queries[queries.length - 1].params).toEqual([1, 11])
  })

  it('should update nested children', async () => {
    const driver = new MockDriver()
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'Old' }], rowCount: 1 })
    driver.setResult({ rowCount: 1 })

    const users = new ModelDelegate(driver, userModel(), registry())
    await users.update({
      where: { id: 1 },
      data: { posts: { update: { where: { id: 10 }, data: { title: 'New' } } } },
    })

    const queries = driver.getQueries()
    expect(queries[queries.length - 1].sql).toContain('UPDATE "posts" SET "title"')
  })
})
