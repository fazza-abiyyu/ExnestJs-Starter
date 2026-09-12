// VA-ORM Schema Differ
//
// Makes `va db push` actually fix drift (like Prisma db push), not just
// CREATE missing tables. Compares desired DDL (generated from va.schema)
// against the live database and emits:
//   - CREATE TABLE / CREATE INDEX for missing objects (existing behavior)
//   - ALTER TABLE ... ADD COLUMN for missing columns
//   - ALTER TABLE ... ALTER COLUMN ... TYPE / SET|DROP NOT NULL (postgres)
//   - ALTER TABLE ... MODIFY COLUMN (mysql)
//   - warnings for sqlite (cannot alter column types — recreate the table)
//
// Type comparison is done on NORMALIZED types (VARCHAR(255) ==
// character varying(255), DECIMAL == NUMERIC, ...). When the desired type
// has no parameters (TIMESTAMP) only the base type is compared, so
// precision noise (TIMESTAMP vs TIMESTAMP(6)) does not false-positive.
// Defaults are intentionally NOT compared (noisy across engines).

import type { DatabaseDriver } from '../../../client/src/core/types.js'
import type { CliProvider } from '../commands/driver.factory.js'

export interface DiffResult {
  statements: string[]
  warnings: string[]
}

interface DesiredColumn {
  name: string
  def: string
  type: string
  nullable: boolean
}

interface DesiredTable {
  name: string
  columns: DesiredColumn[]
  rawCreate: string
}

interface DesiredIndex {
  name: string
  rawCreate: string
}

interface ActualColumn {
  type: string
  nullable: boolean
}

// Split SQL on top-level ';' (paren/quote aware — naive split breaks on
// defaults like DEFAULT 'a;b').
export function splitStatements(ddl: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < ddl.length; i++) {
    const ch = ddl[i]
    if (quote) {
      current += ch
      if (ch === quote && ddl[i - 1] !== '\\') quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ';' && depth === 0) {
      const trimmed = current.trim()
      if (trimmed.length > 0 && !trimmed.startsWith('--')) out.push(trimmed)
      current = ''
      continue
    }
    current += ch
  }
  const trimmed = current.trim()
  if (trimmed.length > 0 && !trimmed.startsWith('--')) out.push(trimmed)
  return out
}

// Split a CREATE TABLE body on top-level commas (DECIMAL(10, 2) has one).
function splitColumns(body: string): string[] {
  const out: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      if (current.trim().length > 0) out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim().length > 0) out.push(current.trim())
  return out
}

const CONSTRAINT_LEADS = ['primary', 'foreign', 'unique', 'check', 'constraint', 'exclude']

function stripQuotes(name: string): string {
  return name.replace(/^"|"$/g, '').replace(/^`|`$/g, '')
}

/** Extract the type portion: tokens after the name up to a constraint keyword. */
function extractType(rest: string): string {
  const stop = /\b(not\s+null|null|primary\s+key|unique|default|check|references|collate|generated|constraint)\b/i
  const m = rest.match(stop)
  const typePart = (m ? rest.slice(0, m.index) : rest).trim()
  return typePart.replace(/\s+/g, ' ').toUpperCase()
}

function isNullable(def: string): boolean {
  if (/primary\s+key/i.test(def)) return false
  return !/not\s+null/i.test(def)
}

function parseCreateTable(statement: string): DesiredTable | null {
  const m = statement.match(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?("?)(.+?)\2\s*\(/is)
  if (!m) return null
  const table = stripQuotes(m[3].trim())
  const bodyStart = statement.indexOf('(')
  // Find matching close paren for the body (last ')' before trailing ';')
  const bodyEnd = statement.lastIndexOf(')')
  const body = statement.slice(bodyStart + 1, bodyEnd)
  const columns: DesiredColumn[] = []
  for (const part of splitColumns(body)) {
    const first = part.split(/\s+/)[0] ?? ''
    if (CONSTRAINT_LEADS.includes(first.toLowerCase())) continue
    const name = stripQuotes(first)
    const rest = part.slice(first.length).trim()
    if (!rest) continue
    columns.push({ name, def: part, type: extractType(rest), nullable: isNullable(part) })
  }
  return { name: table, columns, rawCreate: statement }
}

function parseCreateIndex(statement: string): DesiredIndex | null {
  const m = statement.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(IF\s+NOT\s+EXISTS\s+)?("?)([\w$]+)\3\s+ON/i)
  if (!m) return null
  return { name: m[4], rawCreate: statement }
}

// Map engine-reported types to the canonical form our DDL uses.
const TYPE_ALIASES: Record<string, string> = {
  'CHARACTER VARYING': 'VARCHAR',
  CHARACTER: 'CHAR',
  NUMERIC: 'NUMERIC',
  DECIMAL: 'NUMERIC',
  'DOUBLE PRECISION': 'DOUBLE PRECISION',
  'TIMESTAMP WITHOUT TIME ZONE': 'TIMESTAMP',
  'TIMESTAMP WITH TIME ZONE': 'TIMESTAMPTZ',
  'TIME WITHOUT TIME ZONE': 'TIME',
  INT: 'INTEGER',
  INT4: 'INTEGER',
  INT8: 'BIGINT',
  INT2: 'SMALLINT',
  BOOL: 'BOOLEAN',
  DATETIME: 'TIMESTAMP',
}

function canonicalBase(type: string): string {
  const base = type.replace(/\(.*\)/, '').trim().toUpperCase().replace(/\s+/g, ' ')
  return TYPE_ALIASES[base] ?? base
}

function paramsOf(type: string): string | null {
  const m = type.match(/\((.*)\)/)
  return m ? m[1].replace(/\s+/g, '') : null
}

/**
 * Compare desired vs actual column type. When the desired type carries no
 * parameters (TIMESTAMP) only the base is compared; with parameters
 * (VARCHAR(255)) the full signature must match.
 */
export function typesMatch(desired: string, actual: string): boolean {
  const dBase = canonicalBase(desired)
  const aBase = canonicalBase(actual)
  if (dBase !== aBase) return false
  const dParams = paramsOf(desired)
  if (dParams === null) return true
  const aParams = paramsOf(actual)
  return aParams !== null && dParams.replace(/\s+/g, '') === aParams.replace(/\s+/g, '')
}

interface ActualSchema {
  tables: Set<string>
  columns: Map<string, Map<string, ActualColumn>>
  indexes: Set<string>
}

async function introspectPostgres(driver: DatabaseDriver): Promise<ActualSchema> {
  const tables = new Set<string>()
  const tableRows = await driver.query<any>(
    `SELECT tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`
  )
  for (const row of tableRows.rows ?? []) tables.add(String(row.tablename).toLowerCase())

  const columns = new Map<string, Map<string, ActualColumn>>()
  const indexNames = new Set<string>()
  for (const table of tables) {
    const cols = new Map<string, ActualColumn>()
    const colRows = await driver.query<any>(
      `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, datetime_precision, is_nullable
       FROM information_schema.columns
       WHERE table_name = '${table}'`
    )
    for (const row of colRows.rows ?? []) {
      let type = String(row.data_type)
      if (row.character_maximum_length !== null && row.character_maximum_length !== undefined) {
        type += `(${row.character_maximum_length})`
      } else if (row.numeric_precision !== null && row.numeric_precision !== undefined) {
        type +=
          row.numeric_scale !== null && row.numeric_scale !== undefined
            ? `(${row.numeric_precision},${row.numeric_scale})`
            : `(${row.numeric_precision})`
      }
      cols.set(String(row.column_name).toLowerCase(), {
        type,
        nullable: String(row.is_nullable).toUpperCase() === 'YES',
      })
    }
    columns.set(table, cols)

    const idxRows = await driver.query<any>(
      `SELECT indexname FROM pg_indexes WHERE tablename = '${table}'`
    )
    for (const row of idxRows.rows ?? []) indexNames.add(String(row.indexname).toLowerCase())
  }
  return { tables, columns, indexes: indexNames }
}

async function introspectMysql(driver: DatabaseDriver): Promise<ActualSchema> {
  const tables = new Set<string>()
  const tableRows = await driver.query<any>(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`
  )
  for (const row of tableRows.rows ?? []) tables.add(String(row.name).toLowerCase())

  const columns = new Map<string, Map<string, ActualColumn>>()
  const indexNames = new Set<string>()
  for (const table of tables) {
    const cols = new Map<string, ActualColumn>()
    const colRows = await driver.query<any>(
      `SELECT column_name AS name, column_type AS type, is_nullable AS nullable
       FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = '${table}'`
    )
    for (const row of colRows.rows ?? []) {
      cols.set(String(row.name).toLowerCase(), {
        type: String(row.type),
        nullable: String(row.nullable).toUpperCase() === 'YES',
      })
    }
    columns.set(table, cols)

    const idxRows = await driver.query<any>(
      `SELECT index_name AS name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${table}'`
    )
    for (const row of idxRows.rows ?? []) indexNames.add(String(row.name).toLowerCase())
  }
  return { tables, columns, indexes: indexNames }
}

async function introspectSqlite(driver: DatabaseDriver): Promise<ActualSchema> {
  const tables = new Set<string>()
  const tableRows = await driver.query<any>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  )
  for (const row of tableRows.rows ?? []) tables.add(String(row.name).toLowerCase())

  const columns = new Map<string, Map<string, ActualColumn>>()
  const indexNames = new Set<string>()
  for (const table of tables) {
    const cols = new Map<string, ActualColumn>()
    const colRows = await driver.query<any>(`PRAGMA table_info("${table}")`)
    for (const row of colRows.rows ?? []) {
      cols.set(String(row.name).toLowerCase(), {
        type: String(row.type ?? ''),
        nullable: Number(row.notnull ?? 0) === 0,
      })
    }
    columns.set(table, cols)

    const idxRows = await driver.query<any>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${table}' AND sql IS NOT NULL`
    )
    for (const row of idxRows.rows ?? []) indexNames.add(String(row.name).toLowerCase())
  }
  return { tables, columns, indexes: indexNames }
}

export async function diffStatements(
  ddl: string,
  driver: DatabaseDriver,
  provider: CliProvider,
): Promise<DiffResult> {
  const statements: string[] = []
  const warnings: string[] = []

  const creates: DesiredTable[] = []
  const indexes: DesiredIndex[] = []
  const others: string[] = []
  for (const statement of splitStatements(ddl)) {
    if (/^CREATE\s+TABLE/i.test(statement)) {
      const parsed = parseCreateTable(statement)
      if (parsed) creates.push(parsed)
      else others.push(statement)
    } else if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(statement)) {
      const parsed = parseCreateIndex(statement)
      if (parsed) indexes.push(parsed)
      else others.push(statement)
    } else {
      others.push(statement)
    }
  }

  const actual =
    provider === 'mysql'
      ? await introspectMysql(driver)
      : provider === 'sqlite'
        ? await introspectSqlite(driver)
        : await introspectPostgres(driver)

  for (const table of creates) {
    const key = table.name.toLowerCase()
    if (!actual.tables.has(key)) {
      statements.push(table.rawCreate)
      continue
    }
    const actualCols = actual.columns.get(key) ?? new Map<string, ActualColumn>()
    for (const col of table.columns) {
      const colKey = stripQuotes(col.name).toLowerCase()
      const found = actualCols.get(colKey)
      if (!found) {
        statements.push(`ALTER TABLE ${table.name} ADD COLUMN ${col.def}`)
        continue
      }
      if (provider === 'sqlite') {
        if (!typesMatch(col.type, found.type) || col.nullable !== found.nullable) {
          warnings.push(
            `sqlite cannot alter ${table.name}.${col.name} (wanted ${col.type}${col.nullable ? '' : ' NOT NULL'}, has ${found.type}) — recreate the table manually`,
          )
        }
        continue
      }
      const typeDrift = !typesMatch(col.type, found.type)
      const nullDrift = col.nullable !== found.nullable
      if (provider === 'mysql') {
        // MODIFY carries the full definition — fixes type + nullability at once.
        if (typeDrift || nullDrift) {
          statements.push(`ALTER TABLE ${table.name} MODIFY COLUMN ${col.def}`)
        }
      } else {
        if (typeDrift) {
          const colRef = stripQuotes(col.name)
          const newType = col.type.replace(/\s+/g, ' ')
          statements.push(
            `ALTER TABLE ${table.name} ALTER COLUMN ${colRef} TYPE ${newType} USING ${colRef}::${newType}`,
          )
        }
        if (nullDrift) {
          const colRef = stripQuotes(col.name)
          statements.push(
            `ALTER TABLE ${table.name} ALTER COLUMN ${colRef} ${col.nullable ? 'DROP' : 'SET'} NOT NULL`,
          )
        }
      }
    }
  }

  for (const index of indexes) {
    if (!actual.indexes.has(index.name.toLowerCase())) {
      statements.push(index.rawCreate)
    }
  }

  statements.push(...others)

  return { statements, warnings }
}
