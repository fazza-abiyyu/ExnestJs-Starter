// VA-ORM SQL Generator

import type { SchemaAST, ModelBlock, FieldDefinition, FieldAttribute } from '../../../schema/src/schema.types.js'
import type { RelationFieldInfo } from '../../../schema/src/schema.types.js'
import { resolveRelations } from '../../../schema/src/schema.relations.js'
import { tableNameOf, columnNameOf, columnNameOfField } from '../../../schema/src/schema.mapping.js'

const ON_DELETE_SQL: Record<string, string> = {
  Cascade: 'CASCADE',
  Restrict: 'RESTRICT',
  NoAction: 'NO ACTION',
  SetNull: 'SET NULL',
  SetDefault: 'SET DEFAULT',
}

export class SqlGenerator {
  private provider: string

  constructor(provider: string = 'postgres') {
    this.provider = provider
  }

  generateDDL(ast: SchemaAST): string {
    const lines: string[] = []
    const modelNames = new Set(ast.model.map((m) => m.name))
    const relations = resolveRelations(ast.model)

    for (const model of ast.model) {
      if (model.isIgnored) continue
      lines.push(this.generateTable(model, modelNames, ast.model))
      lines.push('')
    }

    const emittedJoinTables = new Set<string>()
    for (const info of relations.values()) {
      if (info.kind !== 'many-to-many-implicit' || !info.joinTable) continue
      if (emittedJoinTables.has(info.joinTable)) continue
      emittedJoinTables.add(info.joinTable)
      lines.push(this.generateJoinTable(info, ast.model))
      lines.push('')
    }

    // Generate enums
    for (const enumBlock of ast.enum) {
      lines.push(this.generateEnum(enumBlock))
      lines.push('')
    }

    // Generate views
    if (ast.view) {
      for (const view of ast.view) {
        lines.push(this.generateView(view))
        lines.push('')
      }
    }

    // Generate indexes
    for (const model of ast.model) {
      if (model.isIgnored) continue
      const indexes = model.attributes.filter(a => a.name === '@@index')
      for (const index of indexes) {
        lines.push(this.generateIndex(model, index))
      }

      const uniqueIndexes = model.attributes.filter(a => a.name === '@@unique')
      for (const index of uniqueIndexes) {
        lines.push(this.generateUniqueIndex(model, index))
      }
    }

    // Auto-index FK columns so JOINs and EXISTS filters use an index scan.
    // Skipped when the user already declared an index on the same columns.
    for (const model of ast.model) {
      if (model.isIgnored) continue
      for (const indexSql of this.generateForeignKeyIndexes(model, modelNames, ast.model)) {
        lines.push(indexSql)
      }
    }

    return lines.join('\n')
  }

  private generateTable(model: ModelBlock, modelNames: Set<string>, allModels: ModelBlock[]): string {
    const tableName = tableNameOf(model)
    const scalarFields = model.fields.filter((f) => !modelNames.has(f.type.replace('[]', '')) && !f.isIgnored)
    const columns = scalarFields.map(f => this.generateColumn(f))
    const constraints = this.generateForeignKeys(model, modelNames, allModels)
    const compositePk = model.attributes.find((a) => a.name === '@@id')
    if (compositePk) {
      const fields = compositePk.args['fields']
      const cols = Array.isArray(fields) ? fields : []
      const mapped = cols.map((f) => columnNameOf(model, String(f)))
      if (mapped.length > 0) constraints.unshift(`PRIMARY KEY (${mapped.join(', ')})`)
    }
    const parts = [...columns, ...constraints]

    return `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${parts.join(',\n  ')}\n);`
  }

  private generateForeignKeyIndexes(model: ModelBlock, modelNames: Set<string>, allModels: ModelBlock[]): string[] {
    void modelNames
    const relations = resolveRelations(allModels)
    const declared = new Set<string>()
    for (const attr of model.attributes) {
      if (attr.name !== '@@index' && attr.name !== '@@unique') continue
      const fields = attr.args['fields']
      if (Array.isArray(fields)) {
        declared.add(fields.map((f) => columnNameOf(model, String(f))).sort().join('|'))
      }
    }

    const statements: string[] = []
    const tableName = tableNameOf(model)
    for (const info of relations.values()) {
      if (!info.isFkHolder || info.fkModel !== model.name || info.fkFields.length === 0) continue
      if (info.kind === 'many-to-many-implicit') continue
      const cols = info.fkFields.map((f) => columnNameOf(model, f))
      if (declared.has([...cols].sort().join('|'))) continue
      statements.push(
        `CREATE INDEX IF NOT EXISTS "fk_${tableName}_${cols.join('_')}" ON ${tableName} (${cols.join(', ')});`
      )
    }
    return statements
  }

  private generateForeignKeys(model: ModelBlock, modelNames: Set<string>, allModels: ModelBlock[]): string[] {
    const relations = resolveRelations(allModels)
    const constraints: string[] = []
    const byName = new Map(allModels.map((m) => [m.name, m]))

    for (const info of relations.values()) {
      if (!info.isFkHolder || info.fkModel !== model.name || info.fkFields.length === 0) continue
      if (info.kind === 'many-to-many-implicit') continue
      const targetTable = this.resolveTableName(info.pkModel, allModels)
      const target = byName.get(info.pkModel)
      const fkCols = info.fkFields.map((f) => columnNameOf(model, f))
      const pkCols = info.pkFields.map((f) => (target ? columnNameOf(target, f) : f))
      const onDelete = info.onDelete ? ` ON DELETE ${ON_DELETE_SQL[info.onDelete] ?? info.onDelete}` : ''
      constraints.push(
        `FOREIGN KEY (${fkCols.join(', ')}) REFERENCES ${targetTable}(${pkCols.join(', ')})${onDelete}`
      )
    }
    void modelNames

    return constraints
  }

  private generateJoinTable(info: RelationFieldInfo, allModels: ModelBlock[]): string {
    const [first, second] = [info.pkModel, info.targetModel].sort()
    const byName = new Map(allModels.map((m) => [m.name, m]))
    const pkTypeOf = (modelName: string): string => {
      const model = byName.get(modelName)
      const pkField = model?.fields.find((f) => f.attributes.some((a) => a.name === '@id'))
      if (!pkField) return 'TEXT'
      if (pkField.type === 'Int' || pkField.type === 'BigInt') return 'INTEGER'
      return 'TEXT'
    }
    const lines = [
      `CREATE TABLE IF NOT EXISTS "${info.joinTable}" (`,
      `  "A" ${pkTypeOf(first)} NOT NULL,`,
      `  "B" ${pkTypeOf(second)} NOT NULL,`,
      '  PRIMARY KEY ("A", "B")',
      ');',
      `CREATE INDEX IF NOT EXISTS "${info.joinTable}_B_idx" ON "${info.joinTable}"("B");`,
    ]
    return lines.join('\n')
  }

  private resolveTableName(modelName: string, allModels: ModelBlock[]): string {
    const model = allModels.find((m) => m.name === modelName)
    return model ? tableNameOf(model) : this.toSnakeCase(modelName)
  }

  private generateColumn(field: FieldDefinition): string {
    const parts: string[] = []

    parts.push(columnNameOfField(field))
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
        if (this.provider === 'sqlite' && defaultValue === 'AUTOINCREMENT') {
          parts.push('AUTOINCREMENT')
        } else {
          parts.push(`DEFAULT ${defaultValue}`)
        }
      }
    }

    return parts.join(' ')
  }

  private mapColumnType(field: FieldDefinition): string {
    // Check for native type attribute (@db.VarChar, @db.Text, etc.)
    const nativeTypeAttr = field.attributes.find((a) => a.name.startsWith('@db.'))
    if (nativeTypeAttr) {
      return this.resolveNativeType(nativeTypeAttr)
    }

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
        sqlType = 'TEXT'
      }
    }

    return sqlType
  }

  private resolveNativeType(attr: FieldAttribute): string {
    const name = attr.name // e.g. @db.VarChar
    const typeName = name.replace('@db.', '') // e.g. VarChar

    // Extract arguments (e.g., 255 from @db.VarChar(255))
    const args = attr.args
    const firstArg = typeof args.value === 'number' ? args.value
      : typeof args.value === 'string' ? parseInt(args.value, 10)
      : undefined

    const nativeTypeMap: Record<string, (p?: number) => string> = {
      'Text': () => this.provider === 'mysql' ? 'LONGTEXT' : 'TEXT',
      'VarChar': (p) => `VARCHAR(${p ?? 255})`,
      'Char': (p) => `CHAR(${p ?? 1})`,
      'Decimal': (p, s) => `DECIMAL(${p ?? 10}, ${s ?? 2})`,
      'Numeric': (p, s) => `NUMERIC(${p ?? 10}, ${s ?? 2})`,
      'Timestamp': () => {
        if (this.provider === 'mysql') return 'DATETIME(3)'
        if (this.provider === 'sqlite') return 'TEXT'
        return 'TIMESTAMP(3)'
      },
      'Timestamptz': () => {
        if (this.provider === 'mysql') return 'DATETIME(3)'
        if (this.provider === 'sqlite') return 'TEXT'
        return 'TIMESTAMPTZ'
      },
      'Date': () => this.provider === 'sqlite' ? 'TEXT' : 'DATE',
      'Time': () => this.provider === 'sqlite' ? 'TEXT' : 'TIME',
      'Bytes': () => {
        if (this.provider === 'mysql') return 'LONGBLOB'
        if (this.provider === 'sqlite') return 'BLOB'
        return 'BYTEA'
      },
      'Bit': (p) => this.provider === 'sqlite' ? 'INTEGER' : `BIT(${p ?? 1})`,
      'SmallInt': () => 'SMALLINT',
      'MediumInt': () => this.provider === 'mysql' ? 'MEDIUMINT' : 'INTEGER',
      'BigInt': () => 'BIGINT',
      'Real': () => {
        if (this.provider === 'mysql') return 'FLOAT'
        return 'REAL'
      },
      'DoublePrecision': () => {
        if (this.provider === 'mysql') return 'DOUBLE'
        if (this.provider === 'sqlite') return 'REAL'
        return 'DOUBLE PRECISION'
      },
      'Serial': () => {
        if (this.provider === 'postgres') return 'SERIAL'
        return 'INTEGER'
      },
      'BigSerial': () => {
        if (this.provider === 'postgres') return 'BIGSERIAL'
        return 'BIGINT'
      },
      'Uuid': () => {
        if (this.provider === 'mysql') return 'CHAR(36)'
        if (this.provider === 'sqlite') return 'TEXT'
        return 'UUID'
      },
      'Json': () => this.provider === 'sqlite' ? 'TEXT' : 'JSON',
      'JsonB': () => {
        if (this.provider === 'mysql') return 'JSON'
        if (this.provider === 'sqlite') return 'TEXT'
        return 'JSONB'
      },
      'Xml': () => this.provider === 'postgres' ? 'XML' : 'TEXT',
      'Inet': () => this.provider === 'postgres' ? 'INET' : 'TEXT',
      'Cidr': () => this.provider === 'postgres' ? 'CIDR' : 'TEXT',
      'MacAddr': () => this.provider === 'postgres' ? 'MACADDR' : 'TEXT',
      'Money': () => this.provider === 'postgres' ? 'MONEY' : 'DECIMAL(19,4)',
      'PgLSN': () => this.provider === 'postgres' ? 'PG_LSN' : 'TEXT',
      'PgSnapshot': () => this.provider === 'postgres' ? 'PG_SNAPSHOT' : 'TEXT',
      'TsVector': () => this.provider === 'postgres' ? 'TSVECTOR' : 'TEXT',
      'TsQuery': () => this.provider === 'postgres' ? 'TSQUERY' : 'TEXT',
    }

    // Handle Decimal(p,s) with two args
    if ((typeName === 'Decimal' || typeName === 'Numeric') && firstArg !== undefined) {
      // Parse second arg from raw attribute args
      const values = Object.values(args).filter(v => typeof v === 'number')
      const p = values[0] as number | undefined
      const s = values[1] as number | undefined
      return nativeTypeMap[typeName]?.(p, s) ?? 'TEXT'
    }

    const resolver = nativeTypeMap[typeName]
    if (resolver) return resolver(firstArg)

    return 'TEXT'
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
        if (this.provider === 'postgres') return 'GENERATED ALWAYS AS IDENTITY'
        if (this.provider === 'sqlite') return 'AUTOINCREMENT'
        return 'AUTO_INCREMENT'
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

  private generateView(view: any): string {
    const viewName = view.tableName ?? this.toSnakeCase(view.name)

    if (view.query) {
      return `CREATE VIEW "${viewName}" AS ${view.query};`
    }

    // Generate a basic view from fields (placeholder - real implementation would need query definition)
    const columns = view.fields.map((f: any) => `"${f.name}"`).join(', ')
    return `CREATE VIEW "${viewName}" AS SELECT ${columns} FROM /* TODO: define source */;`
  }

  private generateIndex(model: ModelBlock, attribute: any): string {
    const tableName = tableNameOf(model)
    const fields = attribute.args['fields'] as string[]
    const columns = fields.map((f) => columnNameOf(model, f))
    const indexName = `idx_${tableName}_${columns.join('_')}`

    // Index type (Hash, GIN, GiST, BRIN, SP-GiST)
    const indexType = this.resolveIndexType(attribute.args['type'])

    // Partial index (WHERE clause)
    const whereClause = attribute.args['where']

    // Sort order (ops)
    const ops = attribute.args['ops']
    let orderClause = ''
    if (ops && typeof ops === 'object') {
      const entries = Object.entries(ops)
      if (entries.length > 0) {
        const sortParts = entries.map(([field, direction]) => {
          const col = columnNameOf(model, field)
          return `${col} ${String(direction).toUpperCase()}`
        })
        orderClause = ` (${sortParts.join(', ')})`
      }
    }

    const using = indexType ? ` USING ${indexType}` : ''
    const where = whereClause ? ` WHERE ${whereClause}` : ''

    if (orderClause) {
      return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}${using}${orderClause};`
    }

    return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}${using} (${columns.join(', ')});${where}`
  }

  private resolveIndexType(type: any): string | null {
    if (!type) return null
    const typeName = String(type).toUpperCase()
    const supportedTypes: Record<string, string> = {
      'HASH': 'HASH',
      'GIN': 'GIN',
      'GIST': 'GiST',
      'BRIN': 'BRIN',
      'SPGIST': 'SP-GiST',
      'SP-GIST': 'SP-GiST',
    }

    // Validate per provider
    const type_ = supportedTypes[typeName]
    if (!type_) return null

    if (this.provider === 'sqlite') {
      // SQLite only supports B-tree (default)
      return null
    }
    if (this.provider === 'mysql' && !['HASH'].includes(type_)) {
      // MySQL only supports B-tree and Hash
      return null
    }

    return type_
  }

  private generateUniqueIndex(model: ModelBlock, attribute: any): string {
    const tableName = tableNameOf(model)
    const fields = attribute.args['fields'] as string[]
    const columns = fields.map((f) => columnNameOf(model, f))
    const indexName = `uniq_${tableName}_${columns.join('_')}`

    return `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns.join(', ')});`
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
  }
}
