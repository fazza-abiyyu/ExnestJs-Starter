// VA-ORM SQL Injection Spec
//
// Identifier injection (column/orderBy keys) must be structurally impossible:
// every interpolated identifier is quoted + escaped + lowercased, operators
// and directions are allowlisted, limits are integers. Values were always
// parameterized — these tests lock that in too.

import { describe, it, expect } from 'bun:test'
import { Repository } from '../repository/repository.js'
import { ExpressionBuilder, assertSafeOperator } from '../core/expression.js'
import { QueryBuilder } from '../core/query-builder.js'
import { quoteColumn, quoteTable, mysqlQuote, ansiQuote } from '../relation/quote.js'
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js'
import { RawQuery } from '../raw/raw-query.js'
import { MockDriver } from '../../../../test-setup.js'

describe('identifier quoting', () => {
  it('escapes double quotes (no breakout)', () => {
    expect(ansiQuote('a"b')).toBe('"a""b"')
    expect(quoteColumn('postgres', 'a"b')).toBe('"a""b"')
  })

  it('escapes backticks for mysql', () => {
    expect(mysqlQuote('a`b')).toBe('`a``b`')
  })

  it('lowercases columns to match folded DDL', () => {
    expect(quoteColumn('postgres', 'tenantId')).toBe('"tenantid"')
    expect(quoteColumn('mysql', 'tenantId')).toBe('`tenantid`')
  })

  it('preserves wildcards', () => {
    expect(quoteColumn('postgres', '*')).toBe('*')
    expect(quoteColumn('postgres', 'users.*')).toBe('"users".*')
  })

  it('quotes each dotted part', () => {
    expect(quoteColumn('postgres', 'u.name')).toBe('"u"."name"')
  })

  it('quotes tables as-given (escape only)', () => {
    expect(quoteTable('postgres', 'users"; DROP TABLE x; --')).toBe('"users""; DROP TABLE x; --"')
  })
})

describe('operator/direction/limit allowlists', () => {
  it('rejects unknown operators', () => {
    expect(() => assertSafeOperator('= $1 OR 1=1 --')).toThrow(/Unsafe SQL operator/)
    expect(() => assertSafeOperator('LIKE')).not.toThrow()
  })

  it('rejects bad orderBy directions', () => {
    const driver = new MockDriver()
    const builder = new QueryBuilder(driver, 'users')
    expect(() => builder.orderBy('name', 'desc; DROP TABLE users --' as any).build()).toThrow(
      /Unsafe ORDER BY direction/,
    )
  })

  it('rejects non-integer limits', () => {
    const driver = new MockDriver()
    const builder = new QueryBuilder(driver, 'users')
    expect(() => builder.limit('10; DROP TABLE users' as any).build()).toThrow(/Unsafe LIMIT/)
  })
})

describe('containment on live sqlite', () => {
  async function setup() {
    const driver = new SqliteDriver(':memory:')
    await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
    await driver.execute(`INSERT INTO users (id, name) VALUES (1, 'alice')`)
    return driver
  }

  it('where-key breakout returns nothing, never dumps', async () => {
    const driver = await setup()
    const repo = new Repository<any>(driver, 'users', {})
    // Quoted+escaped: the payload becomes one inert identifier that matches
    // no column (or nothing) — it must never return rows it shouldn't.
    const result = await repo.findUnique({ 'id" OR "1"="1': 1 } as any)
    expect(result).toBeNull()
    const rows = await driver.query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    expect(rows.rows[0].n).toBe(1)
  })

  it('orderBy injection cannot drop the table nor leak wider', async () => {
    const driver = await setup()
    const repo = new Repository<any>(driver, 'users', {})
    const result = await repo.findMany({ orderBy: { 'name DESC; DROP TABLE users --': 'asc' } as any })
    // At most the rows a plain listing would return; table must survive.
    expect(result.length).toBeLessThanOrEqual(1)
    const rows = await driver.query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    expect(rows.rows[0].n).toBe(1)
  })

  it('classic value-side quote stays parameterized', async () => {
    const driver = await setup()
    const repo = new Repository<any>(driver, 'users', {})
    const result = await repo.findUnique({ name: `' OR '1'='1` } as any)
    expect(result).toBeNull()
    const queries = (await driver.query('SELECT COUNT(*) AS n FROM users')).rows
    expect(queries[0].n).toBe(1)
  })

  it('expression builder rejects hostile operators', () => {
    const builder = ExpressionBuilder.from([
      { column: 'id', operator: '= $1 OR 1=1 --' as any, value: 1 },
    ])
    expect(() => builder.build()).toThrow(/Unsafe SQL operator/)
  })
})

describe('raw-value duck-typing SQLi (CRITICAL regression)', () => {
  // Attacker HTTP JSON body: {"email":{"raw":"1=1 OR 1=1 --","values":[]}}
  // App: repo.findUnique({ email: req.body.email }) → eb.eq('email', hostileObj)
  const hostile = { raw: '1=1 OR 1=1 --', values: [] }

  it('eq with {raw} object binds it as a value, never as SQL', () => {
    const eb = ExpressionBuilder.create(() => '?')
    eb.eq('email', hostile as never)
    const { sql, params } = eb.build()
    expect(sql).not.toContain('1=1 OR 1=1')
    expect(sql).toBe('"email" = ?')
    expect(params).toEqual([hostile])
  })

  it('QueryBuilder.where with {raw} object does not inject SQL', () => {
    const driver = new MockDriver()
    const qb = new QueryBuilder(driver, 'users')
    qb.where((eb) => eb.eq('email', hostile as never))
    const { sql, params } = qb.build()
    expect(sql).not.toContain('1=1 OR 1=1')
    expect(sql).toContain('"email" = $1')
    expect(params).toEqual([hostile])
  })

  it('repository.findUnique with {raw} object stays parameterized on live sqlite', async () => {
    const driver = new SqliteDriver(':memory:')
    await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)')
    await driver.execute(`INSERT INTO users VALUES (1,'a@x.com'),(2,'b@x.com')`)
    const repo = new Repository<any>(driver, 'users', {})
    // Hostile object is a non-matching value — must not dump the table
    const result = await repo.findUnique({ email: hostile as any })
    expect(result).toBeNull()
    const rows = await driver.query<{ n: number }>('SELECT COUNT(*) AS n FROM users')
    expect(rows.rows[0].n).toBe(2)
  })

  it('trusted eb.raw() still injects SQL (legit path must keep working)', () => {
    const eb = ExpressionBuilder.create(() => '?')
    eb.raw('status IS NOT NULL AND age > ?', 18)
    const { sql, params } = eb.build()
    expect(sql).toBe('status IS NOT NULL AND age > ?')
    expect(params).toEqual([18])
  })
})

describe('SELECT expression allowlist (quoteSelect)', () => {
  it('allows allowlisted aggregates', () => {
    const driver = new MockDriver()
    const builder = new QueryBuilder(driver, 'users')
    builder.select('COUNT(*) as count', 'u.id', 'SUM(p.id) as postTotal')
    const { sql } = builder.build()
    expect(sql).toContain('COUNT(*) as count')
    expect(sql).toContain('"u"."id"')
    expect(sql).toContain('SUM(p.id) as postTotal')
  })

  it('rejects paren-bypass injection (CRITICAL regression)', () => {
    const driver = new MockDriver()
    const builder = new QueryBuilder(driver, 'users')
    expect(() =>
      builder.select('COUNT(*) FROM users; DROP TABLE users; --', 'name').build(),
    ).toThrow(/Unsafe SELECT expression/)
  })

  it('rejects nested/unknown function expressions', () => {
    const driver = new MockDriver()
    const builder = new QueryBuilder(driver, 'users')
    expect(() => builder.select('pg_sleep(1)').build()).toThrow(/Unsafe SELECT expression/)
    expect(() => builder.select('COALESCE(a, b)').build()).toThrow(/Unsafe SELECT expression/)
  })
})

describe('tsHeadline / search headline options (CRITICAL regression)', () => {
  it('escapes startSel/stopSel quotes (no string breakout)', () => {
    const driver = new MockDriver()
    const raw = new RawQuery(driver)
    const sql = raw.tsHeadline('english', 'title', 'q', {
      startSel: "x') , (SELECT 1), StartSel=(",
      stopSel: "y'",
    })
    // PG options: StartSel=<value> inside ONE outer string; ' doubled
    expect(sql).toContain("StartSel=x'') , (SELECT 1), StartSel=(")
    expect(sql).toContain("StopSel=y''")
    // Unescaped early close of options string must be impossible
    expect(sql).not.toMatch(/StartSel=x'\)/)
  })

  it('escapes headlineOptions inside search()', async () => {
    const driver = new MockDriver()
    const raw = new RawQuery(driver)
    await raw.search('docs', {
      column: 'body',
      query: 'hello',
      headline: true,
      headlineOptions: { startSel: "a') OR 1=1 --", stopSel: "b" },
    })
    const sql = driver.getQueries()[0].sql
    expect(sql).toContain("StartSel=a'') OR 1=1 --")
    expect(sql).not.toMatch(/StartSel=a'\)/)
  })

  it('rejects non-integer maxFragments', () => {
    const driver = new MockDriver()
    const raw = new RawQuery(driver)
    expect(() =>
      raw.tsHeadline('english', 'title', 'q', {
        maxFragments: '1); DROP TABLE users; --' as any,
      }),
    ).toThrow(/Unsafe MaxFragments/)
  })
})
