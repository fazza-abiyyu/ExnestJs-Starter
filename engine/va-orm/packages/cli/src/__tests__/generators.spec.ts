// VA-ORM Generator Specs Spec

import { describe, it, expect } from 'bun:test'
import { TypeGenerator } from '../generator/type.generator.js'
import { ClientGenerator } from '../generator/client.generator.js'
import { SqlGenerator } from '../generator/sql.generator.js'
import type { SchemaAST } from '@exnest/va-schema'

const testAst: SchemaAST = {
  generator: [{ name: 'client', provider: 'va-client-js' }],
  datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
  model: [
    {
      name: 'User',
      fields: [
        { name: 'id', type: 'Int', isArray: false, isOptional: false, attributes: [{ name: '@id', args: {} }, { name: '@default', args: { autoincrement: true } }] },
        { name: 'email', type: 'String', isArray: false, isOptional: false, attributes: [{ name: '@unique', args: {} }] },
        { name: 'name', type: 'String', isArray: false, isOptional: true, attributes: [] },
        { name: 'role', type: 'Role', isArray: false, isOptional: false, attributes: [{ name: '@default', args: { 'USER': true } }] },
        { name: 'posts', type: 'Post', isArray: true, isOptional: false, attributes: [] },
        { name: 'createdAt', type: 'DateTime', isArray: false, isOptional: false, attributes: [{ name: '@default', args: { now: true } }] },
      ],
      attributes: [{ name: '@@map', args: { 'users': true } }],
    },
    {
      name: 'Post',
      fields: [
        { name: 'id', type: 'Int', isArray: false, isOptional: false, attributes: [{ name: '@id', args: {} }, { name: '@default', args: { autoincrement: true } }] },
        { name: 'title', type: 'String', isArray: false, isOptional: false, attributes: [] },
        { name: 'content', type: 'Text', isArray: false, isOptional: true, attributes: [] },
        { name: 'authorId', type: 'Int', isArray: false, isOptional: false, attributes: [] },
      ],
      attributes: [],
    },
  ],
  enum: [
    {
      name: 'Role',
      values: [{ name: 'ADMIN' }, { name: 'USER' }, { name: 'GUEST' }],
    },
  ],
}

describe('TypeGenerator', () => {
  const generator = new TypeGenerator()

  it('should generate enum types', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('export enum Role')
    expect(output).toContain("ADMIN = 'ADMIN'")
    expect(output).toContain("USER = 'USER'")
    expect(output).toContain("GUEST = 'GUEST'")
  })

  it('should generate model interface', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('export interface User {')
    expect(output).toContain('id: number')
    expect(output).toContain('email: string')
    expect(output).toContain('name?: string')
    expect(output).toContain('posts: Post[]')
  })

  it('should generate create input', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('export type UserCreateInput = {')
  })

  it('should generate update input', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('export type UserUpdateInput = {')
  })

  it('should generate where input', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('export type UserWhereInput = {')
  })

  it('should map types correctly', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('id: number') // Int -> number
    expect(output).toContain('createdAt: Date') // DateTime -> Date
  })

  it('should generate relation-aware where input', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('posts?: {')
    expect(output).toContain('some?: PostWhereInput;')
    expect(output).toContain('export type UserSelect = {')
    expect(output).toContain('export type UserInclude = {')
    expect(output).toContain('export type UserUniqueWhere = {')
  })

  it('should generate nested create/update inputs', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('connectOrCreate')
    expect(output).toContain('disconnect')
  })
})

describe('ClientGenerator', () => {
  const generator = new ClientGenerator()

  it('should generate client class', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('export class VaClientGenerated extends VaClient')
  })

  it('should generate typed delegate accessors', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('get user(): UserDelegate')
    expect(output).toContain('get post(): PostDelegate')
    expect(output).toContain('export class UserDelegate extends ModelDelegate<User>')
    expect(output).toContain("return this.delegate('User', UserDelegate)")
  })

  it('should embed schema AST', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('const schema: SchemaAST')
    expect(output).toContain('schema,')
  })

  it('should generate constructor with models', () => {
    const output = generator.generate(testAst)
    expect(output).toContain('const schema: SchemaAST')
    expect(output).toContain('@@map')
    expect(output).toContain('schema,')
  })

  it('should generate imports', () => {
    const output = generator.generate(testAst)
    expect(output).toContain("import { VaClient } from '@exnest/va'")
    expect(output).toContain("import { ModelDelegate } from '@exnest/va'")
  })
})

describe('SqlGenerator', () => {
  describe('PostgreSQL', () => {
    const generator = new SqlGenerator('postgres')

    it('should generate CREATE TABLE', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('CREATE TABLE IF NOT EXISTS user')
      expect(output).toContain('CREATE TABLE IF NOT EXISTS post')
    })

    it('should generate column definitions', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('id INTEGER PRIMARY KEY')
      expect(output).toContain('email VARCHAR(255) NOT NULL UNIQUE')
      expect(output).toContain('name VARCHAR(255)')
    })

    it('should generate DEFAULT for autoincrement', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('GENERATED ALWAYS AS IDENTITY')
    })

    it('should generate DEFAULT for now()', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('DEFAULT NOW()')
    })

    it('should generate enum type', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('CREATE TYPE Role AS ENUM')
    })

    it('should generate indexes', () => {
      const astWithIndex: SchemaAST = {
        ...testAst,
        model: [{
          ...testAst.model[0],
          attributes: [{ name: '@@index', args: { fields: ['email'] } }],
        }],
      }
      const output = generator.generateDDL(astWithIndex)
      expect(output).toContain('CREATE INDEX')
    })

    it('should generate DEFAULT NOW() for @updatedAt', () => {
      const astWithUpdatedAt: SchemaAST = {
        ...testAst,
        model: [{
          ...testAst.model[0],
          fields: [
            ...testAst.model[0].fields,
            { name: 'updatedAt', type: 'DateTime', isArray: false, isOptional: false, attributes: [{ name: '@updatedAt', args: {} }] },
          ],
        }],
      }
      const output = generator.generateDDL(astWithUpdatedAt)
      expect(output).toContain('updatedAt TIMESTAMP NOT NULL DEFAULT NOW()')
    })
  })

  describe('MySQL', () => {
    const generator = new SqlGenerator('mysql')

    it('should generate CREATE TABLE', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('CREATE TABLE IF NOT EXISTS user')
    })

    it('should use AUTO_INCREMENT instead of GENERATED ALWAYS', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('AUTO_INCREMENT')
    })

    it('should generate DEFAULT CURRENT_TIMESTAMP for @updatedAt', () => {
      const astWithUpdatedAt: SchemaAST = {
        ...testAst,
        model: [{
          ...testAst.model[0],
          fields: [
            ...testAst.model[0].fields,
            { name: 'updatedAt', type: 'DateTime', isArray: false, isOptional: false, attributes: [{ name: '@updatedAt', args: {} }] },
          ],
        }],
      }
      const output = generator.generateDDL(astWithUpdatedAt)
      expect(output).toContain('updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP')
    })
  })

  describe('SQLite', () => {
    const generator = new SqlGenerator('sqlite')

    it('should generate CREATE TABLE', () => {
      const output = generator.generateDDL(testAst)
      expect(output).toContain('CREATE TABLE IF NOT EXISTS user')
    })
  })
})
