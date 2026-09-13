// VA-ORM M6/M9/M10 Security Spec

import { describe, it, expect } from 'bun:test'
import { VaError } from '../core/errors.js'
import { QueryBuilder } from '../core/query-builder.js'
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js'
import { MockDriver } from '../../../../test-setup.js'

describe('VaError redaction (M9)', () => {
  it('redacts DSN passwords', () => {
    const msg = VaError.redactSecrets(
      'connect failed postgresql://user:secret@host:5432/db',
    )
    expect(msg).not.toContain('secret')
    expect(msg).toContain('***')
  })

  it('wrap keeps code and redacts', () => {
    const err = VaError.wrap(
      new Error('auth failed for mysql://u:p@h/db'),
      'mysql connect',
    )
    expect(err.name).toBe('VaError')
    expect(err.code).toBe('DRIVER_ERROR')
    expect(err.message).not.toMatch(/:p@/)
  })

  it('redacts mongodb and generic credentials', () => {
    const msg = VaError.redactSecrets(
      'failed mongodb://user:pass@host/db and redis://:pass@host:6379',
    )
    expect(msg).not.toContain('pass@')
    expect(msg).toContain('***')
  })

  it('redacts bearer tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.signaturepart'
    const msg = VaError.redactSecrets(`Authorization: Bearer ${jwt}`)
    expect(msg).not.toContain(jwt)
    expect(msg).not.toContain('signaturepart')
  })
})

describe('nested transaction SAVEPOINT (M6)', () => {
  it('sqlite nested tx rolls back only inner savepoint', async () => {
    const driver = new SqliteDriver(':memory:')
    await driver.execute('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)')
    await driver.execute(`INSERT INTO t (id, v) VALUES (1, 'outer')`)

    await driver.transaction(async (tx) => {
      await tx.execute(`UPDATE t SET v = 'outer2' WHERE id = 1`)
      try {
        await tx.transaction(async (inner) => {
          await inner.execute(`UPDATE t SET v = 'inner' WHERE id = 1`)
          throw new Error('inner fail')
        })
      } catch {
        // expected
      }
    })

    const rows = await driver.query<{ v: string }>('SELECT v FROM t WHERE id = 1')
    expect(rows.rows[0].v).toBe('outer2')
  })

  it('driver query wraps errors as VaError', async () => {
    const driver = new SqliteDriver(':memory:')
    await expect(driver.query('SELECT * FROM missing_table')).rejects.toMatchObject({
      name: 'VaError',
    })
  })
})

describe('typed joinOn (M10)', () => {
  it('builds quoted ON without free-form SQL', () => {
    const driver = new MockDriver()
    const qb = new QueryBuilder(driver, 'users', 'u')
    qb.select('u.id').joinOn('posts', 'u.id', 'p.userId', 'p', 'left')
    const { sql } = qb.build()
    expect(sql).toContain('LEFT JOIN "posts" AS "p" ON "u"."id" = "p"."userid"')
  })

  it('joinOn quotes breakout in column names', () => {
    const driver = new MockDriver()
    const qb = new QueryBuilder(driver, 'users')
    qb.joinOn('posts', 'id" OR 1=1 --', 'userId')
    const { sql } = qb.build()
    // payload becomes a single quoted identifier — no unquoted SQL breakout
    expect(sql).toBe(
      'SELECT * FROM "users" INNER JOIN "posts" ON "id"" or 1=1 --" = "userid"',
    )
  })
})
