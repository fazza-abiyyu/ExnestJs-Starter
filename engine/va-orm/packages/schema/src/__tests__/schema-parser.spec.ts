// VA-ORM Schema Parser Spec

import { describe, it, expect } from 'bun:test'
import { SchemaParser } from '../schema.parser.js'

describe('SchemaParser', () => {
  const parser = new SchemaParser()

  describe('generator', () => {
    it('should parse generator block', () => {
      const schema = `
        generator client {
          provider = "va-client-js"
          output = "../generated"
        }
      `
      const ast = parser.parse(schema)
      expect(ast.generator.length).toBe(1)
      expect(ast.generator[0].name).toBe('client')
      expect(ast.generator[0].provider).toBe('va-client-js')
      expect(ast.generator[0].output).toBe('../generated')
    })

    it('should parse generator with binaryTargets', () => {
      const schema = `
        generator client {
          provider = "va-client-js"
          binaryTargets = ["native", "rhel-openssl-1.0.x"]
        }
      `
      const ast = parser.parse(schema)
      expect(ast.generator[0].binaryTargets).toEqual(['native', 'rhel-openssl-1.0.x'])
    })
  })

  describe('datasource', () => {
    it('should parse datasource block', () => {
      const schema = `
        datasource db {
          provider = "postgresql"
          url = env("DATABASE_URL")
        }
      `
      const ast = parser.parse(schema)
      expect(ast.datasource.length).toBe(1)
      expect(ast.datasource[0].name).toBe('db')
      expect(ast.datasource[0].provider).toBe('postgresql')
      expect(ast.datasource[0].url).toBe('env("DATABASE_URL")')
    })
  })

  describe('model', () => {
    it('should parse simple model', () => {
      const schema = `
        model User {
          id    Int    @id @default(autoincrement())
          name  String
          email String @unique
        }
      `
      const ast = parser.parse(schema)
      expect(ast.model.length).toBe(1)
      expect(ast.model[0].name).toBe('User')
      expect(ast.model[0].fields.length).toBe(3)
    })

    it('should parse model with optional fields', () => {
      const schema = `
        model User {
          id       Int     @id
          name     String
          bio      String?
          age      Int?
        }
      `
      const ast = parser.parse(schema)
      const bioField = ast.model[0].fields.find(f => f.name === 'bio')
      expect(bioField?.isOptional).toBe(true)
    })

    it('should parse model with array fields', () => {
      const schema = `
        model User {
          id    Int      @id
          tags  String[]
        }
      `
      const ast = parser.parse(schema)
      const tagsField = ast.model[0].fields.find(f => f.name === 'tags')
      expect(tagsField?.isArray).toBe(true)
      expect(tagsField?.type).toBe('String')
    })

    it('should parse model with attributes', () => {
      const schema = `
        model User {
          id    Int    @id @default(autoincrement())
          name  String @map("user_name")
          
          @@map("users")
          @@index([email])
        }
      `
      const ast = parser.parse(schema)
      expect(ast.model[0].attributes.length).toBe(2)
      expect(ast.model[0].attributes[0].name).toBe('@@map')
      expect(ast.model[0].attributes[1].name).toBe('@@index')
    })

    it('should parse model with relation', () => {
      const schema = `
        model User {
          id    Int    @id
          posts Post[]
        }
        
        model Post {
          id       Int  @id
          author   User @relation(fields: [authorId], references: [id])
          authorId Int
        }
      `
      const ast = parser.parse(schema)
      expect(ast.model.length).toBe(2)
    })

    it('should parse multiple models', () => {
      const schema = `
        model User {
          id   Int    @id
          name String
        }
        
        model Post {
          id    Int    @id
          title String
        }
        
        model Comment {
          id   Int    @id
          text String
        }
      `
      const ast = parser.parse(schema)
      expect(ast.model.length).toBe(3)
    })
  })

  describe('enum', () => {
    it('should parse enum', () => {
      const schema = `
        enum Role {
          ADMIN
          USER
          GUEST
        }
      `
      const ast = parser.parse(schema)
      expect(ast.enum.length).toBe(1)
      expect(ast.enum[0].name).toBe('Role')
      expect(ast.enum[0].values.length).toBe(3)
    })

    it('should parse multiple enums', () => {
      const schema = `
        enum Role {
          ADMIN
          USER
        }
        
        enum Status {
          ACTIVE
          INACTIVE
        }
      `
      const ast = parser.parse(schema)
      expect(ast.enum.length).toBe(2)
    })
  })

  describe('complex schema', () => {
    it('should parse complete schema', () => {
      const schema = `
        generator client {
          provider = "va-client-js"
        }
        
        datasource db {
          provider = "postgresql"
          url      = env("DATABASE_URL")
        }
        
        model User {
          id        Int      @id @default(autoincrement())
          email     String   @unique
          name      String?
          role      Role     @default(USER)
          posts     Post[]
          createdAt DateTime @default(now())
          
          @@map("users")
        }
        
        model Post {
          id        Int      @id @default(autoincrement())
          title     String
          content   String?
          author    User     @relation(fields: [authorId], references: [id])
          authorId  Int
          createdAt DateTime @default(now())
          
          @@index([authorId])
        }
        
        enum Role {
          ADMIN
          USER
          GUEST
        }
      `
      const ast = parser.parse(schema)
      expect(ast.generator.length).toBe(1)
      expect(ast.datasource.length).toBe(1)
      expect(ast.model.length).toBe(2)
      expect(ast.enum.length).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should throw on invalid syntax', () => {
      const schema = `
        model User {
          id Int @id @default(
        }
      `
      expect(() => parser.parse(schema)).toThrow()
    })
  })
})
