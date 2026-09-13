// VA-ORM Driver Transaction Spec (real SQLite)

import { describe, it, expect } from 'bun:test'
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js'
import { NestedWriter } from '../repository/nested.writes.js'
import type { ModelMeta } from '../core/types.js'

function registry(): Map<string, ModelMeta> {
  return new Map([
    ['User', {
      name: 'User', table: 'users', primaryKey: 'id',
      relations: new Map([['posts', {
        field: 'posts', targetModel: 'Post', isList: true, kind: 'one-to-many',
        fkModel: 'Post', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        backField: 'author', isFkHolder: false,
      }]]),
    }],
    ['Post', {
      name: 'Post', table: 'posts', primaryKey: 'id',
      relations: new Map([['author', {
        field: 'author', targetModel: 'User', isList: false, kind: 'many-to-one',
        fkModel: 'Post', fkFields: ['userId'], pkModel: 'User', pkFields: ['id'],
        backField: 'posts', isFkHolder: true,
      }]]),
    }],
  ])
}

describe('SqliteDriver transaction', () => {
  it('should commit on success', async () => {
    const driver = new SqliteDriver(':memory:')
    try {
      await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
      await driver.transaction(async (tx) => {
        await tx.execute("INSERT INTO t (v) VALUES ('a')")
      })
      const rows = await driver.query<{ id: number; v: string }>('SELECT * FROM t')
      expect(rows.rows).toEqual([{ id: 1, v: 'a' }])
    } finally {
      await driver.close()
    }
  })

  it('should rollback on error', async () => {
    const driver = new SqliteDriver(':memory:')
    try {
      await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
      await expect(
        driver.transaction(async (tx) => {
          await tx.execute("INSERT INTO t (v) VALUES ('a')")
          throw new Error('boom')
        })
      ).rejects.toThrow('boom')
      const rows = await driver.query('SELECT * FROM t')
      expect(rows.rows).toEqual([])
    } finally {
      await driver.close()
    }
  })

  it('should run queries on the transaction connection', async () => {
    const driver = new SqliteDriver(':memory:')
    try {
      await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
      await driver.transaction(async (tx) => {
        await tx.execute("INSERT INTO t (v) VALUES ('a')")
        const inside = await tx.query('SELECT COUNT(*) AS c FROM t')
        expect((inside.rows[0] as any).c).toBe(1)
      })
    } finally {
      await driver.close()
    }
  })

  it('should rollback nested writes atomically', async () => {
    const driver = new SqliteDriver(':memory:')
    try {
      await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await driver.execute('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, userId INTEGER NOT NULL)')
      const reg = registry()
      await expect(
        driver.transaction(async (tx) => {
          const writer = new NestedWriter(tx, reg)
          await writer.create('User', { name: 'John', posts: { create: [{ title: 'A' }] } })
          throw new Error('boom')
        })
      ).rejects.toThrow('boom')
      const users = await driver.query('SELECT * FROM users')
      const posts = await driver.query('SELECT * FROM posts')
      expect(users.rows).toEqual([])
      expect(posts.rows).toEqual([])
    } finally {
      await driver.close()
    }
  })

  it('should commit nested writes', async () => {
    const driver = new SqliteDriver(':memory:')
    try {
      await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
      await driver.execute('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, userId INTEGER NOT NULL)')
      const reg = registry()
      await driver.transaction(async (tx) => {
        const writer = new NestedWriter(tx, reg)
        await writer.create('User', { name: 'John', posts: { create: [{ title: 'A' }] } })
      })
      const users = await driver.query<any>('SELECT * FROM users')
      const posts = await driver.query<any>('SELECT * FROM posts')
      expect(users.rows).toHaveLength(1)
      expect(posts.rows).toHaveLength(1)
      expect(posts.rows[0].userId).toBe(users.rows[0].id)
    } finally {
      await driver.close()
    }
  })
})
