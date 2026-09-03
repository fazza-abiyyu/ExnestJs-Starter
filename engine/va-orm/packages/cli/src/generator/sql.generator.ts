// VA-ORM SQL Generator

import type { SchemaAST, ModelBlock, FieldDefinition } from '../../../schema/src/schema.types.js'

export class SqlGenerator {
  private provider: string

  constructor(provider: string = 'postgres') {
    this.provider = provider
  }

  generateDDL(ast: SchemaAST): string {
    const lines: string[] = []

    for (const model of ast.model) {
      lines.push(this.generateTable(model))
      lines.push('')
    }

    // Generate enums
    for (const enumBlock of ast.enum) {
      lines.push(this.generateEnum(enumBlock))
      lines.push('')
    }

    // Generate indexes
    for (const model of ast.model) {
      const indexes = model.attributes.filter(a => a.name === '@@index')
      for (const index of indexes) {
        lines.push(this.generateIndex(model, index))
      }

      const uniqueIndexes = model.attributes.filter(a => a.name === '@@unique')
      for (const index of uniqueIndexes) {
        lines.push(this.generateUniqueIndex(model, index))
      }
    }

    return lines.join('\n')
  }

  private generateTable(model: ModelBlock): string {
    const tableName = model.tableName || this.toSnakeCase(model.name)
    const columns = model.fields.map(f => this.generateColumn(f)).join(',\n  ')

    return `CREATE TABLE ${tableName} (\n  ${columns}\n);`
  }

  private generateColumn(field: FieldDefinition): string {
    const parts: string[] = []

    parts.push(field.name)
    parts.push(this.mapColumnType(field))

    if (field.attributes.some(a => a.name === '@id')) {
      parts.push('PRIMARY KEY')
    }

    if (!field.isOptional && !field.attributes.some(a => a.name === '@default')) {
      parts.push('NOT NULL')
    }

    if (field.attributes.some(a => a.name === '@unique')) {
      parts.push('UNIQUE')
    }

    // Default value
    const defaultAttr = field.attributes.find(a => a.name === '@default')
    if (defaultAttr) {
      const defaultValue = this.generateDefaultValue(field, defaultAttr.args)
      if (defaultValue) {
        parts.push(`DEFAULT ${defaultValue}`)
      }
    }

    return parts.join(' ')
  }

  private mapColumnType(field: FieldDefinition): string {
    const typeMap: Record<string, string> = {
      'String': 'VARCHAR(255)',
      'Text': 'TEXT',
      'Int': 'INTEGER',
      'BigInt': 'BIGINT',
      'Float': 'DOUBLE PRECISION',
      'Decimal': 'DECIMAL(10, 2)',
      'Boolean': 'BOOLEAN',
      'DateTime': 'TIMESTAMP',
      'Uuid': 'UUID',
      'Json': 'JSONB',
      'Bytes': 'BYTEA',
    }

    const baseType = field.type.replace('[]', '')
    let sqlType = typeMap[baseType] ?? 'TEXT'

    if (field.type.endsWith('[]')) {
      if (this.provider === 'postgres') {
        sqlType = `${sqlType}[]`
      } else {
        // For MySQL/SQLite, we'd need a separate table for arrays
        sqlType = 'TEXT'
      }
    }

    return sqlType
  }

  private generateDefaultValue(field: FieldDefinition, args: Record<string, any>): string | null {
    if (typeof args === 'string') {
      // Direct value
      if (field.type === 'String' || field.type === 'Text') {
        return `'${args}'`
      }
      return String(args)
    }

    if (args && typeof args === 'object') {
      if (args['autoincrement']) {
        return this.provider === 'postgres' ? 'GENERATED ALWAYS AS IDENTITY' : 'AUTO_INCREMENT'
      }
      if (args['uuid']) {
        return this.provider === 'postgres' ? 'gen_random_uuid()' : '(UUID())'
      }
      if (args['cuid']) {
        return null // Application-generated
      }
      if (args['now']) {
        return 'NOW()'
      }
      if (args['dbgenerated']) {
        return null // Database-generated
      }
    }

    return null
  }

  private generateEnum(enumBlock: any): string {
    if (this.provider === 'postgres') {
      const values = enumBlock.values.map((v: any) => `'${v.name}'`).join(', ')
      return `CREATE TYPE ${enumBlock.name} AS ENUM (${values});`
    }

    // For MySQL/SQLite, we'd use CHECK constraints
    return `-- Enum ${enumBlock.name} (use CHECK constraint)`
  }

  private generateIndex(model: ModelBlock, attribute: any): string {
    const tableName = model.tableName || this.toSnakeCase(model.name)
    const fields = attribute.args['fields'] as string[]
    const indexName = `idx_${tableName}_${fields.join('_')}`

    return `CREATE INDEX ${indexName} ON ${tableName} (${fields.join(', ')});`
  }

  private generateUniqueIndex(model: ModelBlock, attribute: any): string {
    const tableName = model.tableName || this.toSnakeCase(model.name)
    const fields = attribute.args['fields'] as string[]
    const indexName = `uniq_${tableName}_${fields.join('_')}`

    return `CREATE UNIQUE INDEX ${indexName} ON ${tableName} (${fields.join(', ')});`
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
  }
}
