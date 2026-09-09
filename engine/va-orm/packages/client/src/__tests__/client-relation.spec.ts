// VA-ORM Client Relation Wiring Spec

import { describe, it, expect, afterEach } from 'bun:test'
import { MockDriver } from '../../../../test-setup.js'
import { ConnectionPool } from '../core/connection.pool.js'
import { SchemaParser } from '../../../schema/src/schema.parser.js'
import { VaClient } from '../core/va.client.js'

const BLOG_SCHEMA = `
generator client {
  provider = "va-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./test.db"
}

model User {
  id    Int    @id @default(autoincrement())
  name  String
  posts Post[]
}

model Post {
  id     Int    @id @default(autoincrement())
  title  String
  userId Int
  author User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  tags   Tag[]
}

model Tag {
  id    Int    @id @default(autoincrement())
  name  String @unique
  posts Post[]
}
`

const sharedMock = new MockDriver()

ConnectionPool.registerFactory('sqlite', () => sharedMock)

afterEach(() => {
  sharedMock.clearQueries()
  sharedMock.clearResults()
})

function createClient() {
  const ast = new SchemaParser().parse(BLOG_SCHEMA)
  return VaClient.create({ driver: 'sqlite', dsn: ':memory:', schema: ast })
}

describe('VaClient relation wiring', () => {
  it('should register models from schema', () => {
    const client = createClient()
    expect(() => client.model('User')).not.toThrow()
    expect(() => client.model('user')).not.toThrow()
    expect(() => client.model('Post')).not.toThrow()
    expect(() => client.model('Tag')).not.toThrow()
  })

  it('should throw for unregistered model', () => {
    const client = createClient()
    expect(() => client.model('nope')).toThrow('Model "nope" is not registered')
  })

  it('should findMany with include through schema registry', async () => {
    sharedMock.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    sharedMock.setResult({ rows: [{ id: 10, userId: 1, title: 'Hello' }], rowCount: 1 })

    const client = createClient()
    const result = await client.model('User').findMany({ include: { posts: true } })

    expect(result[0].posts).toEqual([{ id: 10, userId: 1, title: 'Hello' }])
    const queries = sharedMock.getQueries()
    expect(queries[0].sql).toBe('SELECT * FROM "user"')
    expect(queries[1].sql).toContain('FROM "post"')
  })

  it('should filter by relation with some', async () => {
    sharedMock.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })

    const client = createClient()
    const result = await client.model('User').findMany({
      where: { posts: { some: { title: 'Hello' } } },
    })

    expect(result).toHaveLength(1)
    expect(sharedMock.getQueries()[0].sql).toContain('EXISTS (SELECT 1 FROM "post" AS __rel')
  })

  it('should create with nested relation through schema registry', async () => {
    sharedMock.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 })
    sharedMock.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }], rowCount: 1 })

    const client = createClient()
    const user = await client.model('User').create({
      data: { name: 'John', posts: { create: [{ title: 'A' }] } },
    })

    expect(user).toEqual({ id: 1, name: 'John' })
    const queries = sharedMock.getQueries()
    expect(queries[0].sql).toContain('INSERT INTO "user"')
    expect(queries[1].sql).toContain('INSERT INTO "post"')
  })
})
