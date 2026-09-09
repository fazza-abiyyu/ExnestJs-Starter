// VA-ORM Introspect Spec

import { describe, it, expect, afterEach } from 'bun:test'
import { SchemaIntrospector, mapColumnType, mapDefault } from '../introspect/schema.introspector.js'
import { SqliteDriver } from '../../../client/src/drivers/sqlite/sqlite.driver.js'
import { pushCommand } from '../commands/push.command.js'
import { pullCommand } from '../commands/pull.command.js'

const tmpFiles: string[] = []
const originalDatabaseUrl = process.env.DATABASE_URL

afterEach(async () => {
  const fs = await import('fs/promises')
  for (const file of tmpFiles.splice(0)) {
    try {
      await fs.rm(file, { force: true })
    } catch {}
  }
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = originalDatabaseUrl
})

function createBlogDb(): SqliteDriver {
  const driver = new SqliteDriver(':memory:')
  return driver
}

async function seedBlog(driver: SqliteDriver): Promise<void> {
  await driver.execute(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL DEFAULT 'anon',
    age INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`)
  await driver.execute(`CREATE INDEX idx_users_first_name ON users (first_name)`)
  await driver.execute(`CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  )`)
}

describe('mapColumnType', () => {
  it('should map common types', () => {
    expect(mapColumnType('integer')).toBe('Int')
    expect(mapColumnType('bigint')).toBe('BigInt')
    expect(mapColumnType('varchar(255)')).toBe('String')
    expect(mapColumnType('text')).toBe('String')
    expect(mapColumnType('boolean')).toBe('Boolean')
    expect(mapColumnType('timestamp')).toBe('DateTime')
    expect(mapColumnType('numeric')).toBe('Decimal')
    expect(mapColumnType('double precision')).toBe('Float')
    expect(mapColumnType('jsonb')).toBe('Json')
    expect(mapColumnType('uuid')).toBe('Uuid')
    expect(mapColumnType('bytea')).toBe('Bytes')
    expect(mapColumnType('mystery')).toBe('String')
  })
})

describe('mapDefault', () => {
  it('should map defaults', () => {
    expect(mapDefault("nextval('users_id_seq')", 'Int')).toBe('autoincrement()')
    expect(mapDefault('gen_random_uuid()', 'Uuid')).toBe('uuid()')
    expect(mapDefault('now()', 'DateTime')).toBe('now()')
    expect(mapDefault('CURRENT_TIMESTAMP', 'DateTime')).toBe('now()')
    expect(mapDefault("'anon'", 'String')).toBe('"anon"')
    expect(mapDefault('42', 'Int')).toBe('42')
    expect(mapDefault('true', 'Boolean')).toBe('true')
    expect(mapDefault(null, 'String')).toBeNull()
  })
})

describe('SchemaIntrospector (sqlite)', () => {
  it('should introspect tables, columns, pk, uniques, indexes, FKs', async () => {
    const driver = createBlogDb()
    try {
      await seedBlog(driver)
      const introspector = new SchemaIntrospector(driver, 'sqlite')
      const tables = await introspector.introspect()

      expect(tables.map((t) => t.name).sort()).toEqual(['posts', 'users'])

      const users = tables.find((t) => t.name === 'users')!
      expect(users.primaryKey).toEqual(['id'])
      expect(users.uniques).toEqual([['email']])
      expect(users.indexes).toEqual([['first_name']])
      expect(users.columns.find((c) => c.name === 'email')!.nullable).toBe(false)
      expect(users.columns.find((c) => c.name === 'age')!.nullable).toBe(true)

      const posts = tables.find((t) => t.name === 'posts')!
      expect(posts.foreignKeys).toHaveLength(1)
      expect(posts.foreignKeys[0].columns).toEqual(['author_id'])
      expect(posts.foreignKeys[0].refTable).toBe('users')
      expect(posts.foreignKeys[0].refColumns).toEqual(['id'])
    } finally {
      await driver.close()
    }
  })

  it('should generate va.schema text', async () => {
    const driver = createBlogDb()
    try {
      await seedBlog(driver)
      const introspector = new SchemaIntrospector(driver, 'sqlite')
      const tables = await introspector.introspect()
      const schema = introspector.toSchema(tables, 'sqlite')

      expect(schema).toContain('model User {')
      expect(schema).toContain('model Post {')
      expect(schema).toContain('author User @relation(fields: [author_id], references: [id], onDelete: Cascade)')
      expect(schema).toContain('@@map("users")')
      expect(schema).toContain('@@index([first_name])')
      expect(schema).toContain('@unique')
      expect(schema).toContain('datasource db {')
    } finally {
      await driver.close()
    }
  })

  it('should round-trip through parser and validator', async () => {
    const driver = createBlogDb()
    try {
      await seedBlog(driver)
      const introspector = new SchemaIntrospector(driver, 'sqlite')
      const tables = await introspector.introspect()
      const schema = introspector.toSchema(tables, 'sqlite')

      const { SchemaParser } = await import('../../../schema/src/schema.parser.js')
      const { SchemaValidator } = await import('../../../schema/src/schema.validator.js')
      const ast = new SchemaParser().parse(schema)
      const { errors } = new SchemaValidator().validate(ast)
      expect(errors).toEqual([])
    } finally {
      await driver.close()
    }
  })
})

describe('db push/pull round-trip', () => {
  it('should push schema DDL then pull it back', async () => {
    const fs = await import('fs/promises')
    const dbFile = `/tmp/va-push-test-${Date.now()}.db`
    const schemaFile = `/tmp/va-push-test-${Date.now()}.schema`
    const pulledFile = `/tmp/va-pulled-test-${Date.now()}.schema`
    tmpFiles.push(dbFile, schemaFile, pulledFile)

    await fs.writeFile(
      schemaFile,
      `generator client {
  provider = "va-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id
  email String @unique
  name  String?
}
`
    )

    process.env.DATABASE_URL = `file:${dbFile}`
    await pushCommand({ schema: schemaFile })

    const check = new SqliteDriver(dbFile)
    try {
      const tables = await check.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'`
      )
      expect(tables.rows).toHaveLength(1)
    } finally {
      await check.close()
    }

    await pullCommand({ output: pulledFile })
    const pulled = await fs.readFile(pulledFile, 'utf-8')
    expect(pulled).toContain('model User {')
    expect(pulled).toContain('@@map("user")')
  })
})
