// VA-ORM Schema Relations Spec

import { describe, it, expect } from 'bun:test'
import { SchemaParser } from '../schema.parser.js'
import { SchemaValidator } from '../schema.validator.js'
import { resolveRelations, implicitJoinTable } from '../schema.relations.js'
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

const BLOG_SCHEMA = `
model User {
  id    String @id @default(uuid())
  email String @unique
  posts Post[]
}

model Post {
  id     String @id @default(uuid())
  userId String
  author User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
`

function parse(source: string) {
  return new SchemaParser().parse(HEADER + source)
}

describe('resolveRelations', () => {
  it('should resolve FK-holder side as many-to-one', () => {
    const ast = parse(BLOG_SCHEMA)
    const relations = resolveRelations(ast.model)
    const author = relations.get('Post.author')
    expect(author).toBeDefined()
    expect(author!.kind).toBe('many-to-one')
    expect(author!.targetModel).toBe('User')
    expect(author!.fkModel).toBe('Post')
    expect(author!.fkFields).toEqual(['userId'])
    expect(author!.pkFields).toEqual(['id'])
    expect(author!.onDelete).toBe('Cascade')
    expect(author!.backField).toBe('posts')
  })

  it('should link back-reference side as one-to-many', () => {
    const ast = parse(BLOG_SCHEMA)
    const relations = resolveRelations(ast.model)
    const posts = relations.get('User.posts')
    expect(posts).toBeDefined()
    expect(posts!.kind).toBe('one-to-many')
    expect(posts!.targetModel).toBe('Post')
    expect(posts!.fkModel).toBe('Post')
    expect(posts!.fkFields).toEqual(['userId'])
    expect(posts!.pkFields).toEqual(['id'])
  })

  it('should detect one-to-one via unique FK', () => {
    const ast = parse(`
model User {
  id      String   @id @default(uuid())
  profile Profile?
}

model Profile {
  id     String @id @default(uuid())
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}
`)
    const relations = resolveRelations(ast.model)
    expect(relations.get('Profile.user')!.kind).toBe('one-to-one')
    expect(relations.get('User.profile')!.kind).toBe('one-to-one')
  })

  it('should resolve named relations', () => {
    const ast = parse(`
model User {
  id          String @id @default(uuid())
  authored    Post[] @relation("Author")
  edited      Post[] @relation("Editor")
}

model Post {
  id       String @id @default(uuid())
  authorId String
  editorId String?
  author   User   @relation("Author", fields: [authorId], references: [id])
  editor   User?  @relation("Editor", fields: [editorId], references: [id])
}
`)
    const relations = resolveRelations(ast.model)
    expect(relations.get('Post.author')!.relationName).toBe('Author')
    expect(relations.get('Post.editor')!.relationName).toBe('Editor')
    expect(relations.get('Post.author')!.backField).toBe('authored')
    expect(relations.get('Post.editor')!.backField).toBe('edited')
  })

  it('should resolve self-relation', () => {
    const ast = parse(`
model User {
  id       String  @id @default(uuid())
  parentId String?
  parent   User?   @relation("Tree", fields: [parentId], references: [id])
  children User[]  @relation("Tree")
}
`)
    const relations = resolveRelations(ast.model)
    const parent = relations.get('User.parent')
    expect(parent).toBeDefined()
    expect(parent!.targetModel).toBe('User')
    expect(parent!.fkFields).toEqual(['parentId'])
    expect(parent!.relationName).toBe('Tree')
    expect(relations.get('User.children')!.backField).toBe('parent')
  })

  it('should detect implicit many-to-many', () => {
    const ast = parse(`
model Post {
  id   String @id @default(uuid())
  tags Tag[]
}

model Tag {
  id    String @id @default(uuid())
  name  String @unique
  posts Post[]
}
`)
    const relations = resolveRelations(ast.model)
    expect(relations.get('Post.tags')!.kind).toBe('many-to-many-implicit')
    expect(relations.get('Tag.posts')!.kind).toBe('many-to-many-implicit')
    expect(relations.get('Post.tags')!.joinTable).toBe('_PostToTag')
    expect(implicitJoinTable('Tag', 'Post')).toBe('_PostToTag')
  })
})

describe('relation validation', () => {
  it('should accept valid relations', () => {
    const ast = parse(BLOG_SCHEMA)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors).toEqual([])
  })

  it('should reject references to non-existent fields', () => {
    const ast = parse(`
model User {
  id    String @id @default(uuid())
  posts Post[]
}

model Post {
  id     String @id @default(uuid())
  userId String
  author User   @relation(fields: [userId], references: [nope])
}
`)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors.some((e) => e.message.includes('non-existent field "nope"'))).toBe(true)
  })

  it('should reject missing FK fields', () => {
    const ast = parse(`
model User {
  id    String @id @default(uuid())
  posts Post[]
}

model Post {
  id     String @id @default(uuid())
  author User   @relation(fields: [ghostId], references: [id])
}
`)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors.some((e) => e.message.includes('does not exist in model "Post"'))).toBe(true)
  })

  it('should reject duplicate unnamed relations', () => {
    const ast = parse(`
model User {
  id    String @id @default(uuid())
  posts Post[]
  edits Post[]
}

model Post {
  id String @id @default(uuid())
}
`)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors.some((e) => e.message.includes('require a relation name'))).toBe(true)
  })

  it('should reject invalid onDelete strategy', () => {
    const ast = parse(`
model User {
  id    String @id @default(uuid())
  posts Post[]
}

model Post {
  id     String @id @default(uuid())
  userId String
  author User   @relation(fields: [userId], references: [id], onDelete: Explode)
}
`)
    const { errors } = new SchemaValidator().validate(ast)
    expect(errors.some((e) => e.message.includes('Invalid onDelete strategy'))).toBe(true)
  })
})

describe('relation DDL', () => {
  it('should emit FK with ON DELETE', () => {
    const ast = parse(BLOG_SCHEMA)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).toContain('FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE')
  })

  it('should not emit relation fields as columns', () => {
    const ast = parse(BLOG_SCHEMA)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).not.toMatch(/author\s/)
    expect(sql).not.toMatch(/posts\s/)
  })

  it('should auto-index FK columns', () => {
    const ast = parse(BLOG_SCHEMA)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "fk_post_userId" ON post (userId);')
  })

  it('should skip auto-index when user declared the same index', () => {
    const ast = parse(`
model User {
  id    String @id @default(uuid())
  posts Post[]
}

model Post {
  id     String @id @default(uuid())
  userId String
  author User   @relation(fields: [userId], references: [id])

  @@index([userId])
}
`)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).not.toContain('fk_post_userId')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_post_userId ON post (userId);')
  })

  it('should emit implicit M:N join table', () => {    const ast = parse(`
model Post {
  id   String @id @default(uuid())
  tags Tag[]
}

model Tag {
  id    String @id @default(uuid())
  name  String @unique
  posts Post[]
}
`)
    const sql = new SqlGenerator('postgres').generateDDL(ast)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "_PostToTag"')
    expect(sql).toContain('"_PostToTag_B_idx"')
  })
})
