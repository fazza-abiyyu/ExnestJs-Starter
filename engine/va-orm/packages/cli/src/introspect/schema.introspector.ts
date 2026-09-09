// VA-ORM Schema Introspector
//
// Reads live database metadata and generates va.schema text.
// Supports PostgreSQL and SQLite.

import type { DatabaseDriver } from '../../../client/src/core/types.js'

export interface IntrospectedColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
}

export interface IntrospectedForeignKey {
  columns: string[]
  refTable: string
  refColumns: string[]
  onDelete?: string
}

export interface IntrospectedTable {
  schema: string
  name: string
  columns: IntrospectedColumn[]
  primaryKey: string[]
  uniques: string[][]
  indexes: string[][]
  foreignKeys: IntrospectedForeignKey[]
  enums: Map<string, string[]>
}

const COLUMN_TYPE_MAP: Array<[RegExp, string]> = [
  [/^(serial|int(eger)?|smallint|mediumint|tinyint)$/i, 'Int'],
  [/^(bigserial|bigint)$/i, 'BigInt'],
  [/^((var)?char(acter)?( varying)?|text|citext|clob|nchar|nvarchar|varying character)$/i, 'String'],
  [/^(bool(ean)?)$/i, 'Boolean'],
  [/^(timestamp(tz)?( with time zone)?( without time zone)?|timestamptz|datetime)$/i, 'DateTime'],
  [/^(numeric|decimal)(\(\d+(,\s*\d+)?\))?$/i, 'Decimal'],
  [/^(real|float(4|8)?|double( precision)?)$/i, 'Float'],
  [/^jsonb?$/i, 'Json'],
  [/^uuid$/i, 'Uuid'],
  [/^(bytea|blob)$/i, 'Bytes'],
]

export function mapColumnType(dbType: string): string {
  const raw = dbType.trim()
  if (/^tinyint\(1\)$/i.test(raw)) return 'Boolean'
  const base = raw.split('(')[0].trim()
  for (const [pattern, scalar] of COLUMN_TYPE_MAP) {
    if (pattern.test(base)) return scalar
  }
  return 'String'
}

export function mapDefault(dbDefault: string | null, scalar: string): string | null {
  if (!dbDefault) return null
  const d = dbDefault.trim()
  if (/nextval/i.test(d)) return 'autoincrement()'
  if (/gen_random_uuid|uuid_generate/i.test(d)) return 'uuid()'
  if (/now\(\)|current_timestamp/i.test(d)) return 'now()'
  if (/^'.*'$/.test(d)) {
    if (scalar === 'String' || scalar === 'Text') return `"${d.slice(1, -1).replace(/''/g, "'")}"`
    return d.slice(1, -1)
  }
  if (/^(true|false)$/i.test(d)) return d.toLowerCase()
  if (/^-?\d+(\.\d+)?$/.test(d)) return d
  return null
}

function pascalCase(table: string): string {
  const singular = table.endsWith('s') && !table.endsWith('ss') && table.length > 3
    ? table.slice(0, -1)
    : table
  return singular.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function pascalCaseKeepPlural(name: string): string {
  return name.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

function relationFieldName(fkColumn: string, refModel: string): string {
  const stripped = fkColumn.replace(/(_id|Id)$/, '')
  if (stripped.length > 0 && stripped.toLowerCase() !== fkColumn.toLowerCase()) {
    const camel = stripped.split('_').map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1))).join('')
    return camel
  }
  return camelCase(refModel)
}

function camelCase(name: string): string {
  const pascal = pascalCase(name)
  return pascal.charAt(0).toLowerCase() + pascal.slice(1)
}

const ON_DELETE_MAP: Record<string, string> = {
  CASCADE: 'Cascade',
  RESTRICT: 'Restrict',
  'NO ACTION': 'NoAction',
  'SET NULL': 'SetNull',
  'SET DEFAULT': 'SetDefault',
}

export class SchemaIntrospector {
  constructor(
    private driver: DatabaseDriver,
    private provider: 'postgres' | 'sqlite' = 'postgres',
    private schemas: string[] = ['public']
  ) {}

  async introspect(): Promise<IntrospectedTable[]> {
    if (this.provider === 'sqlite') return this.introspectSqlite()
    return this.introspectPostgres()
  }

  private async introspectPostgres(): Promise<IntrospectedTable[]> {
    const schemaList = this.schemas.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ')
    const tablesResult = await this.driver.query<{ tablename: string; schemaname: string }>(
      `SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN (${schemaList}) ORDER BY tablename`
    )

    const tables: IntrospectedTable[] = []
    for (const t of tablesResult.rows) {
      tables.push(await this.introspectPostgresTable(t.schemaname, t.tablename))
    }
    return tables
  }

  private async introspectPostgresTable(schema: string, table: string): Promise<IntrospectedTable> {
    const columnsResult = await this.driver.query<any>(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = '${schema}' AND table_name = '${table}'
       ORDER BY ordinal_position`
    )

    const pkResult = await this.driver.query<any>(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = '${schema}' AND tc.table_name = '${table}'
         AND tc.constraint_type = 'PRIMARY KEY'
       ORDER BY kcu.ordinal_position`
    )

    const uniqueResult = await this.driver.query<any>(
      `SELECT kcu.constraint_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.table_schema = '${schema}' AND tc.table_name = '${table}'
         AND tc.constraint_type = 'UNIQUE'
       ORDER BY kcu.constraint_name, kcu.ordinal_position`
    )

    const indexResult = await this.driver.query<any>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = '${table}'`
    )

    const fkResult = await this.driver.query<any>(
      `SELECT kcu.column_name, ccu.table_name AS ref_table, ccu.column_name AS ref_column,
              rc.delete_rule, rc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
       WHERE tc.table_schema = '${schema}' AND tc.table_name = '${table}'
         AND tc.constraint_type = 'FOREIGN KEY'
       ORDER BY rc.constraint_name, kcu.ordinal_position`
    )

    const enumResult = await this.driver.query<any>(
      `SELECT t.typname AS enum_name, e.enumlabel AS label
       FROM pg_type t
       JOIN pg_enum e ON t.oid = e.enumtypid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = '${schema}'
       ORDER BY t.typname, e.enumsortorder`
    )

    const enums = new Map<string, string[]>()
    for (const row of enumResult.rows) {
      const list = enums.get(row.enum_name) ?? []
      list.push(row.label)
      enums.set(row.enum_name, list)
    }

    const enumTypes = new Set(enums.keys())
    const columns: IntrospectedColumn[] = columnsResult.rows.map((c) => ({
      name: c.column_name,
      type: enumTypes.has(c.udt_name) ? `enum:${c.udt_name}` : c.data_type,
      nullable: c.is_nullable === 'YES',
      default: c.column_default,
    }))

    const uniqueGroups = new Map<string, string[]>()
    for (const row of uniqueResult.rows) {
      const list = uniqueGroups.get(row.constraint_name) ?? []
      list.push(row.column_name)
      uniqueGroups.set(row.constraint_name, list)
    }

    const indexes: string[][] = []
    const uniqueKeySet = new Set(
      [...uniqueGroups.values()].map((cols) => [...cols].sort().join('|'))
    )
    for (const row of indexResult.rows as Array<{ indexname: string; indexdef: string }>) {
      if (row.indexname.endsWith('_pkey')) continue
      const match = /\(([^)]+)\)/.exec(row.indexdef ?? '')
      if (!match) continue
      const cols = match[1].split(',').map((c) => c.trim().replace(/"/g, '').split(' ')[0])
      if (/UNIQUE/.test(row.indexdef ?? '') && uniqueKeySet.has([...cols].sort().join('|'))) continue
      indexes.push(cols)
    }

    const fkGroups = new Map<string, IntrospectedForeignKey>()
    for (const row of fkResult.rows) {
      const key = row.constraint_name as string
      const existing = fkGroups.get(key) ?? {
        columns: [],
        refTable: row.ref_table as string,
        refColumns: [],
        onDelete: ON_DELETE_MAP[row.delete_rule as string],
      }
      existing.columns.push(row.column_name)
      existing.refColumns.push(row.ref_column)
      fkGroups.set(key, existing)
    }

    return {
      schema,
      name: table,
      columns,
      primaryKey: pkResult.rows.map((r) => r.column_name),
      uniques: [...uniqueGroups.values()],
      indexes,
      foreignKeys: [...fkGroups.values()],
      enums,
    }
  }

  private async introspectSqlite(): Promise<IntrospectedTable[]> {
    const tablesResult = await this.driver.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_va_migrations' ORDER BY name`
    )

    const tables: IntrospectedTable[] = []
    for (const t of tablesResult.rows) {
      const columnsResult = await this.driver.query<any>(`PRAGMA table_info("${t.name}")`)
      const fkResult = await this.driver.query<any>(`PRAGMA foreign_key_list("${t.name}")`)
      const indexResult = await this.driver.query<any>(`PRAGMA index_list("${t.name}")`)

      const columns: IntrospectedColumn[] = columnsResult.rows.map((c) => ({
        name: c.name,
        type: String(c.type || 'TEXT'),
        nullable: c.notnull === 0,
        default: c.dflt_value !== null && c.dflt_value !== undefined ? String(c.dflt_value) : null,
      }))

      const primaryKey = columnsResult.rows
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name as string)

      const uniques: string[][] = []
      const indexes: string[][] = []
      for (const idx of indexResult.rows) {
        if (idx.origin === 'pk') continue
        const colsResult = await this.driver.query<any>(`PRAGMA index_info("${idx.name}")`)
        const cols = colsResult.rows
          .sort((a, b) => a.seqno - b.seqno)
          .map((c) => c.name as string)
        if (idx.origin === 'u') uniques.push(cols)
        else indexes.push(cols)
      }

      const fkGroups = new Map<number, IntrospectedForeignKey>()
      for (const row of fkResult.rows) {
        const existing = fkGroups.get(row.id) ?? {
          columns: [],
          refTable: row.table as string,
          refColumns: [],
          onDelete: ON_DELETE_MAP[String(row.on_delete || '').toUpperCase()],
        }
        existing.columns.push(row.from)
        existing.refColumns.push(row.to)
        fkGroups.set(row.id, existing)
      }

      tables.push({
        schema: 'main',
        name: t.name,
        columns,
        primaryKey,
        uniques,
        indexes,
        foreignKeys: [...fkGroups.values()],
        enums: new Map(),
      })
    }
    return tables
  }

  toSchema(tables: IntrospectedTable[], provider = 'postgresql'): string {
    const lines: string[] = []
    lines.push('generator client {')
    lines.push('  provider = "va-client-js"')
    lines.push('}')
    lines.push('')
    lines.push('datasource db {')
    lines.push(`  provider = "${provider}"`)
    lines.push('  url      = env("DATABASE_URL")')
    lines.push('}')
    lines.push('')

    const emittedEnums = new Set<string>()
    for (const table of tables) {
      for (const [enumName, labels] of table.enums) {
        if (emittedEnums.has(enumName)) continue
        emittedEnums.add(enumName)
        lines.push(`enum ${pascalCaseKeepPlural(enumName)} {`)
        for (const label of labels) lines.push(`  ${label}`)
        lines.push('}')
        lines.push('')
      }
    }

    const modelNames = new Map(tables.map((t) => [t.name, pascalCase(t.name)]))
    const backRefs = new Map<string, string[]>()
    for (const table of tables) {
      for (const fk of table.foreignKeys) {
        const list = backRefs.get(fk.refTable) ?? []
        list.push(table.name)
        backRefs.set(fk.refTable, list)
      }
    }

    for (const table of tables) {
      const modelName = modelNames.get(table.name)!
      const usedFields = new Set<string>()
      lines.push(`model ${modelName} {`)

      for (const column of table.columns) {
        usedFields.add(column.name)
        lines.push(`  ${this.fieldLine(table, column)}`)
      }

      for (const fk of table.foreignKeys) {
        const refModel = modelNames.get(fk.refTable) ?? pascalCase(fk.refTable)
        let fieldName = relationFieldName(fk.columns[0] ?? '', refModel)
        if (usedFields.has(fieldName)) {
          fieldName = `${fieldName}_${fk.columns[0] ?? 'fk'}`
        }
        usedFields.add(fieldName)
        const onDelete = fk.onDelete ? `, onDelete: ${fk.onDelete}` : ''
        lines.push(
          `  ${fieldName} ${refModel} @relation(fields: [${fk.columns.join(', ')}], references: [${fk.refColumns.join(', ')}]${onDelete})`
        )
      }

      for (const fromTable of backRefs.get(table.name) ?? []) {
        const fromModel = modelNames.get(fromTable) ?? pascalCase(fromTable)
        lines.push(`  ${camelCase(fromModel)}s ${fromModel}[]`)
      }

      if (table.primaryKey.length > 1) {
        lines.push(`  @@id([${table.primaryKey.join(', ')}])`)
      }
      for (const unique of table.uniques) {
        if (unique.length > 1) lines.push(`  @@unique([${unique.join(', ')}])`)
      }
      for (const index of table.indexes) {
        lines.push(`  @@index([${index.join(', ')}])`)
      }
      lines.push(`  @@map("${table.name}")`)
      lines.push('}')
      lines.push('')
    }

    return lines.join('\n')
  }

  private fieldLine(table: IntrospectedTable, column: IntrospectedColumn): string {
    let scalar: string
    if (column.type.startsWith('enum:')) {
      scalar = pascalCaseKeepPlural(column.type.slice('enum:'.length))
    } else {
      scalar = mapColumnType(column.type)
    }

    const isSinglePk = table.primaryKey.length === 1 && table.primaryKey[0] === column.name
    const parts = [column.name, scalar + (column.nullable && !isSinglePk ? '?' : '')]
    const attrs: string[] = []

    if (isSinglePk) {
      attrs.push('@id')
    }
    const singleUnique = table.uniques.find((u) => u.length === 1 && u[0] === column.name)
    if (singleUnique && !isSinglePk) {
      attrs.push('@unique')
    }

    const mapped = mapDefault(column.default, scalar)
    if (mapped && !(scalar === 'String' && mapped === 'now()')) {
      if (mapped === 'autoincrement()' && scalar !== 'Int' && scalar !== 'BigInt') {
        // keep raw default out; serial-like on non-int is unusual
      } else {
        attrs.push(`@default(${mapped})`)
      }
    }

    if (attrs.length > 0) parts.push(attrs.join(' '))
    return parts.join(' ')
  }
}
