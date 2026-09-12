// VA-ORM Schema Mapping Spec (@map / @@map)

import { describe, it, expect } from 'bun:test'
import { SchemaParser } from '../schema.parser.js'
import { SchemaValidator } from '../schema.validator.js'
import { tableNameOf, columnNameOf, columnNameOfField } from '../schema.mapping.js'
import { SqlGenerator } from '../../../cli/src/generator/sql.generator.js'

const HEADER = `
generator client {
  provider = "va-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`

function parse(source: string) {
  return new SchemaParser().parse(HEADER + source)
}

const MAPPED_SCHEMA = `
model User {
  id        String   @id @default(uuid())
  tenantId  String   @map("tenant_id")
  firstName String   @map("first_name")
  email     String   @unique @map("email_address")
  createdAt DateTime @default(now()) @map("created_at")

  @@map("app_users")
  @@index([tenantId])
}
`

describe('map parsing', () => {
  it('should populate tableName from @@map', () => {
    const ast = parse(MAPPED_SCHEMA)
    expect(ast.model[0].tableName).toBe('app_users')
  })

  it('should populate columnName from @map', () => {
    const ast = parse(MAPPED_SCHEMA)
    const fields = new Map(ast.model[0].fields.map((f) => [f.name, f]))
    expect(fields.get('tenantId')!.columnName).toBe('tenant_id')
    expect(fields.get('firstName')!.columnName).toBe('first_name')
    expect(fields.get('email')!.columnName).toBe('email_address')
    expect(fields.get('id')!.columnName).toBeUndefined()
  })

  it('should resolve names with fallback', () => {
    const ast = parse(MAPPED_SCHEMA)
    const model = ast.model[0]
    expect(tableNameOf(model)).toBe('app_users')
    expect(columnNameOf(model, 'tenantId')).toBe('tenant_id')
    expect(columnNameOf(model, 'id')).toBe('id')
    expect(columnNameOfField(model.fields[0])).toBe('id')
  })

  it('should fall back to snake_case without map', () => {
    const ast = parse(`
model BlogPost {
  id        Int    @id @default(autoincrement())
  createdAt DateTime @default(now())
}
`)
    const model = ast.model[0]
    expect(tableNameOf(model)).toBe('blog_post')
    expect(model.tableName).toBeUndefined()
  })
})

describe('map validation', () => {
  it('should accept valid maps', () => {
    const ast = parse(MAPPED_SCHEMA)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors).toEqual([])
  })

  it('should reject empty @@map', () => {
    const ast = parse(`
model User {
  id String @id

  @@map()
}
`)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors.some((e) => e.message.includes('@@map'))).toBe(true)
  })
})

describe('map DDL', () => {
  it('should use mapped table and column names', () => {
    const ast = parse(MAPPED_SCHEMA)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS app_users')
    expect(sql).toContain('tenant_id')
    expect(sql).toContain('first_name')
    expect(sql).toContain('email_address')
    expect(sql).toContain('created_at')
    expect(sql).toContain('idx_app_users_tenant_id')
    expect(sql).not.toContain('tenantId')
    expect(sql).not.toContain('firstName')
  })

  it('should map FK columns', () => {
    const ast = parse(`
model User {
  id    String @id @default(uuid())
  posts Post[]

  @@map("app_users")
}

model Post {
  id       String @id @default(uuid())
  authorId String @map("author_id")
  author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)

  @@map("blog_posts")
}
`)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS app_users')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS blog_posts')
    expect(sql).toContain('FOREIGN KEY (author_id) REFERENCES app_users(id) ON DELETE CASCADE')
  })
})
