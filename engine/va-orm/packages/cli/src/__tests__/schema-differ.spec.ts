// VA-ORM Schema Differ Spec

import { describe, it, expect } from 'bun:test'
import { diffStatements, splitStatements, typesMatch } from '../generator/schema.differ.js'

// Minimal stub: canned rows matched by SQL fragment.
function stubDriver(routes: Array<[string, any]>) {
  return {
    async query(sql: string) {
      for (const [fragment, result] of routes) {
        if (sql.includes(fragment)) return result
      }
      return { rows: [], rowCount: 0 }
    },
    async execute() {
      return { rowCount: 0 }
    },
    async close() {},
    getPlaceholder(index: number) {
      return `$${index}`
    },
  } as any
}

const DDL = `CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  createdAt TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);`

function pgRows(table: string, cols: any[]) {
  return [
    ['FROM pg_tables', { rows: [{ tablename: table }], rowCount: 1 }],
    ['information_schema.columns', { rows: cols, rowCount: cols.length }],
    ['FROM pg_indexes', { rows: [], rowCount: 0 }],
  ] as Array<[string, any]>
}

describe('typesMatch', () => {
  it('matches identical types', () => {
    expect(typesMatch('VARCHAR(255)', 'VARCHAR(255)')).toBe(true)
  })

  it('normalizes character varying to VARCHAR', () => {
    expect(typesMatch('VARCHAR(255)', 'character varying(255)')).toBe(true)
  })

  it('normalizes DECIMAL to NUMERIC', () => {
    expect(typesMatch('DECIMAL(10, 2)', 'numeric(10,2)')).toBe(true)
  })

  it('compares base only when desired has no params', () => {
    expect(typesMatch('TIMESTAMP', 'timestamp(6) without time zone')).toBe(true)
  })

  it('detects real mismatches', () => {
    expect(typesMatch('VARCHAR(255)', 'TEXT')).toBe(false)
    expect(typesMatch('VARCHAR(255)', 'VARCHAR(100)')).toBe(false)
    expect(typesMatch('INTEGER', 'BIGINT')).toBe(false)
  })
})

describe('splitStatements', () => {
  it('does not split on semicolons inside strings/parens', () => {
    const parts = splitStatements(`SELECT 'a;b'; SELECT f(1, 2);`)
    expect(parts).toHaveLength(2)
  })
})

describe('diffStatements (postgres)', () => {
  const cols = [
    {
      column_name: 'id',
      data_type: 'character varying',
      character_maximum_length: 255,
      numeric_precision: null,
      numeric_scale: null,
      datetime_precision: null,
      is_nullable: 'NO',
    },
    {
      column_name: 'email',
      data_type: 'character varying',
      character_maximum_length: 255,
      numeric_precision: null,
      numeric_scale: null,
      datetime_precision: null,
      is_nullable: 'NO',
    },
    {
      column_name: 'name',
      data_type: 'character varying',
      character_maximum_length: 255,
      numeric_precision: null,
      numeric_scale: null,
      datetime_precision: null,
      is_nullable: 'YES',
    },
    {
      column_name: 'createdat',
      data_type: 'timestamp without time zone',
      character_maximum_length: null,
      numeric_precision: null,
      numeric_scale: null,
      datetime_precision: 6,
      is_nullable: 'YES',
    },
  ]

  it('emits nothing when schema matches (except missing index)', async () => {
    const driver = stubDriver(pgRows('users', cols))
    const { statements, warnings } = await diffStatements(DDL, driver, 'postgres')
    // Only the missing index remains — everything else matches.
    expect(warnings).toEqual([])
    expect(statements).toEqual([
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)',
    ])
  })

  it('emits ALTER for drifted column type', async () => {
    const drifted = cols.map((c) =>
      c.column_name === 'name'
        ? { ...c, data_type: 'text', character_maximum_length: null }
        : c,
    )
    const driver = stubDriver(pgRows('users', drifted))
    const { statements } = await diffStatements(DDL, driver, 'postgres')
    const alter = statements.find((s) => s.includes('ALTER COLUMN name TYPE'))
    expect(alter).toBe('ALTER TABLE users ALTER COLUMN name TYPE VARCHAR(255) USING name::VARCHAR(255)')
  })

  it('emits ADD COLUMN for missing columns', async () => {
    const driver = stubDriver(pgRows('users', cols.slice(0, 2)))
    const { statements } = await diffStatements(DDL, driver, 'postgres')
    const add = statements.find((s) => s.includes('ADD COLUMN'))
    expect(add).toContain('name VARCHAR(255)')
  })

  it('emits full CREATE for missing tables', async () => {
    const driver = stubDriver([
      ['FROM pg_tables', { rows: [], rowCount: 0 }],
      ['FROM pg_indexes', { rows: [], rowCount: 0 }],
    ])
    const { statements } = await diffStatements(DDL, driver, 'postgres')
    expect(statements.some((s) => s.startsWith('CREATE TABLE IF NOT EXISTS users'))).toBe(true)
  })

  it('emits SET/DROP NOT NULL for nullability drift', async () => {
    const drifted = cols.map((c) =>
      c.column_name === 'email' ? { ...c, is_nullable: 'YES' } : c,
    )
    const driver = stubDriver(pgRows('users', drifted))
    const { statements } = await diffStatements(DDL, driver, 'postgres')
    expect(
      statements.some((s) => s === 'ALTER TABLE users ALTER COLUMN email SET NOT NULL'),
    ).toBe(true)
  })
})

describe('diffStatements (mysql)', () => {
  it('emits MODIFY COLUMN for drift', async () => {
    const driver = stubDriver([
      ['information_schema.tables', { rows: [{ name: 'users' }], rowCount: 1 }],
      [
        'information_schema.columns',
        {
          rows: [
            { name: 'id', type: 'varchar(255)', nullable: 'NO' },
            { name: 'email', type: 'text', nullable: 'NO' },
            { name: 'name', type: 'varchar(255)', nullable: 'YES' },
            { name: 'createdat', type: 'timestamp', nullable: 'YES' },
          ],
          rowCount: 4,
        },
      ],
      ['information_schema.statistics', { rows: [], rowCount: 0 }],
    ])
    const { statements } = await diffStatements(DDL, driver, 'mysql')
    expect(
      statements.some((s) => s === 'ALTER TABLE users MODIFY COLUMN email VARCHAR(255) NOT NULL UNIQUE'),
    ).toBe(true)
  })
})

describe('diffStatements (sqlite)', () => {
  it('warns instead of altering types', async () => {
    const driver = stubDriver([
      ['sqlite_master', { rows: [{ name: 'users' }], rowCount: 1 }],
      ['PRAGMA table_info', { rows: [{ name: 'id', type: 'TEXT', notnull: 1 }], rowCount: 1 }],
    ])
    const { statements, warnings } = await diffStatements(DDL, driver, 'sqlite')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]).toContain('sqlite cannot alter')
    expect(statements.some((s) => s.includes('ADD COLUMN'))).toBe(true)
  })
})
