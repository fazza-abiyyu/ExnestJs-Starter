// VA-ORM Schema Validator Spec

import { describe, it, expect } from 'bun:test'
import { SchemaValidator } from '../schema.validator.js'
import type { SchemaAST } from '../schema.types.js'

describe('SchemaValidator', () => {
  const validator = new SchemaValidator()

  describe('generator validation', () => {
    it('should report error when no generator', () => {
      const ast: SchemaAST = {
        generator: [],
        datasource: [],
        model: [],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('No generator block'))).toBe(true)
    })

    it('should report error when generator has no provider', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: '' }],
        datasource: [],
        model: [],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('must have a provider'))).toBe(true)
    })
  })

  describe('datasource validation', () => {
    it('should report error when no datasource', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [],
        model: [],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('No datasource block'))).toBe(true)
    })

    it('should report error when datasource has no provider', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: '', url: 'env("DATABASE_URL")' }],
        model: [],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('must have a provider'))).toBe(true)
    })

    it('should report error when datasource has no url', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: '' }],
        model: [],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('must have a url'))).toBe(true)
    })
  })

  describe('model validation', () => {
    it('should report warning when model has no fields', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{ name: 'User', fields: [], attributes: [] }],
        enum: [],
      }
      const { warnings } = validator.validate(ast)
      expect(warnings.some(w => w.message.includes('has no fields'))).toBe(true)
    })

    it('should report warning when model has no @id', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{ name: 'name', type: 'String', isArray: false, isOptional: false, attributes: [] }],
          attributes: [],
        }],
        enum: [],
      }
      const { warnings } = validator.validate(ast)
      expect(warnings.some(w => w.message.includes('has no @id field'))).toBe(true)
    })

    it('should report error for duplicate model names', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [
          { name: 'User', fields: [], attributes: [] },
          { name: 'User', fields: [], attributes: [] },
        ],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('Duplicate model name'))).toBe(true)
    })

    it('should report error for invalid field type', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{ name: 'age', type: 'InvalidType', isArray: false, isOptional: false, attributes: [] }],
          attributes: [],
        }],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('Invalid type'))).toBe(true)
    })

    it('should report error for multiple @id', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{
            name: 'id',
            type: 'Int',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }, { name: '@id', args: {} }],
          }],
          attributes: [],
        }],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('multiple @id'))).toBe(true)
    })

    it('should report warning for @id with @unique', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{
            name: 'id',
            type: 'Int',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }, { name: '@unique', args: {} }],
          }],
          attributes: [],
        }],
        enum: [],
      }
      const { warnings } = validator.validate(ast)
      expect(warnings.some(w => w.message.includes('both @id and @unique'))).toBe(true)
    })
  })

  describe('enum validation', () => {
    it('should report error when enum has no values', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [],
        enum: [{ name: 'Role', values: [] }],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('has no values'))).toBe(true)
    })

    it('should report error for duplicate enum names', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [],
        enum: [
          { name: 'Role', values: [{ name: 'ADMIN' }] },
          { name: 'Role', values: [{ name: 'USER' }] },
        ],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('Duplicate enum name'))).toBe(true)
    })

    it('should report error for duplicate enum values', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [],
        enum: [{
          name: 'Role',
          values: [{ name: 'ADMIN' }, { name: 'ADMIN' }],
        }],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('Duplicate value'))).toBe(true)
    })
  })

  describe('relation validation', () => {
    it('should report error for invalid relation reference', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{
            name: 'id',
            type: 'String',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }],
          }],
          attributes: [],
        }, {
          name: 'Post',
          fields: [{
            name: 'id',
            type: 'String',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }],
          }, {
            name: 'userId',
            type: 'String',
            isArray: false,
            isOptional: false,
            attributes: [],
          }, {
            name: 'author',
            type: 'User',
            isArray: false,
            isOptional: false,
            attributes: [{
              name: '@relation',
              args: { fields: ['userId'], references: ['NonExistent'] },
            }],
          }],
          attributes: [],
        }],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('non-existent field'))).toBe(true)
    })

    it('should report error for invalid onDelete strategy', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{
            name: 'id',
            type: 'String',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }],
          }],
          attributes: [],
        }, {
          name: 'Post',
          fields: [{
            name: 'id',
            type: 'String',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }],
          }, {
            name: 'userId',
            type: 'String',
            isArray: false,
            isOptional: false,
            attributes: [],
          }, {
            name: 'author',
            type: 'User',
            isArray: false,
            isOptional: false,
            attributes: [{
              name: '@relation',
              args: { fields: ['userId'], references: ['id'], onDelete: 'InvalidStrategy' },
            }],
          }],
          attributes: [],
        }],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.some(e => e.message.includes('Invalid onDelete strategy'))).toBe(true)
    })
  })

  describe('valid schema', () => {
    it('should pass validation for valid schema', () => {
      const ast: SchemaAST = {
        generator: [{ name: 'client', provider: 'va-client-js' }],
        datasource: [{ name: 'db', provider: 'postgresql', url: 'env("DATABASE_URL")' }],
        model: [{
          name: 'User',
          fields: [{
            name: 'id',
            type: 'Int',
            isArray: false,
            isOptional: false,
            attributes: [{ name: '@id', args: {} }],
          }],
          attributes: [],
        }],
        enum: [],
      }
      const { errors } = validator.validate(ast)
      expect(errors.length).toBe(0)
    })
  })
})
