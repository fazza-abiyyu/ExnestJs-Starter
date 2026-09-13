// VA-ORM Expression Builder

import type { WhereClause, FilterOperator } from './types.js'
import { ansiQuote } from '../relation/quote.js'

/** Operators the builder accepts. Anything else (e.g. from a hand-built
 *  WhereClause) is rejected — operators must never carry user input. */
const VALID_OPERATORS: ReadonlySet<string> = new Set([
  '=', '!=', '>', '<', '>=', '<=',
  'LIKE', 'NOT LIKE', 'ILIKE', 'NOT ILIKE',
  'IN', 'NOT IN',
  'IS NULL', 'IS NOT NULL',
  'BETWEEN', 'NOT BETWEEN',
  '@>', '&&',
])

/** SQLite has no default LIKE escape char; PG/MySQL default to `\`. Always pin it. */
const LIKE_OPERATORS: ReadonlySet<string> = new Set([
  'LIKE', 'NOT LIKE', 'ILIKE', 'NOT ILIKE',
])

function likeSuffix(operator: string): string {
  return LIKE_OPERATORS.has(operator) ? ` ESCAPE '\\'` : ''
}

export function assertSafeOperator(operator: string): void {
  if (!VALID_OPERATORS.has(operator)) {
    throw new Error(`Unsafe SQL operator rejected: ${JSON.stringify(operator)}`)
  }
}

/** ORDER BY direction allowlist — never interpolate raw direction strings. */
export function assertSafeDirection(direction: string): 'ASC' | 'DESC' {
  const upper = String(direction).toUpperCase()
  if (upper !== 'ASC' && upper !== 'DESC') {
    throw new Error(`Unsafe ORDER BY direction rejected: ${JSON.stringify(direction)}`)
  }
  return upper
}

/** LIMIT/OFFSET must be non-negative integers — never interpolate raw values. */
export function assertSafeInteger(value: number | undefined, clause: string): void {
  if (value === undefined) return
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Unsafe ${clause} rejected: ${JSON.stringify(value)}`)
  }
}

/**
 * Trusted raw SQL fragment. Only library-constructed instances are treated as
 * SQL. Detection is `instanceof`, never `'raw' in value` — a plain object from
 * a JSON body (`{"raw":"1=1"}`) can never be an instance, closing the
 * duck-typing SQLi vector (CWE-89).
 */
export class RawSql {
  constructor(
    readonly raw: string,
    readonly values: any[] = [],
  ) {}
}

export function isRawSql(value: unknown): value is RawSql {
  return value instanceof RawSql
}

export class ExpressionBuilder {
  private clauses: WhereClause[] = []
  private params: any[] = []
  private placeholderFn: (index: number) => string
  private quote: (name: string) => string
  private pendingConnector?: 'AND' | 'OR' | 'NOT'

  constructor(
    placeholderFn: (index: number) => string = (i) => `$${i}`,
    quote: (name: string) => string = (n) => ansiQuote(n.toLowerCase()),
  ) {
    this.placeholderFn = placeholderFn
    this.quote = quote
  }

  private addClause(clause: WhereClause): this {
    if (this.pendingConnector) {
      clause.connector = this.pendingConnector
      this.pendingConnector = undefined
    } else if (this.clauses.length > 0 && !clause.connector) {
      clause.connector = 'AND'
    }
    this.clauses.push(clause)
    return this
  }

  // ============ COMPARISON ============

  eq(column: string, value: any): this {
    return this.addClause({ column, operator: '=', value })
  }

  neq(column: string, value: any): this {
    return this.addClause({ column, operator: '!=', value })
  }

  gt(column: string, value: any): this {
    return this.addClause({ column, operator: '>', value })
  }

  gte(column: string, value: any): this {
    return this.addClause({ column, operator: '>=', value })
  }

  lt(column: string, value: any): this {
    return this.addClause({ column, operator: '<', value })
  }

  lte(column: string, value: any): this {
    return this.addClause({ column, operator: '<=', value })
  }

  // ============ PATTERN ============

  like(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'LIKE', value: pattern })
  }

  notLike(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'NOT LIKE', value: pattern })
  }

  ilike(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'ILIKE', value: pattern })
  }

  notIlike(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'NOT ILIKE', value: pattern })
  }

  // ============ NULL ============

  isNull(column: string): this {
    return this.addClause({ column, operator: 'IS NULL' })
  }

  isNotNull(column: string): this {
    return this.addClause({ column, operator: 'IS NOT NULL' })
  }

  // ============ IN ============

  in(column: string, values: any[]): this {
    return this.addClause({ column, operator: 'IN', value: values })
  }

  notIn(column: string, values: any[]): this {
    return this.addClause({ column, operator: 'NOT IN', value: values })
  }

  // ============ BETWEEN ============

  between(column: string, min: any, max: any): this {
    return this.addClause({ column, operator: 'BETWEEN', value: [min, max] })
  }

  notBetween(column: string, min: any, max: any): this {
    return this.addClause({ column, operator: 'NOT BETWEEN', value: [min, max] })
  }

  // ============ LOGICAL ============

  and(): this {
    this.pendingConnector = 'AND'
    return this
  }

  or(): this {
    this.pendingConnector = 'OR'
    return this
  }

  not(): this {
    this.pendingConnector = 'NOT'
    return this
  }

  // ============ NESTED ============

  group(fn: (builder: ExpressionBuilder) => void): this {
    const nested = new ExpressionBuilder(this.placeholderFn, this.quote)
    fn(nested)
    this.addClause({
      column: '',
      operator: '=',
      nested: nested.clauses,
    })
    return this
  }

  // ============ RAW ============

  /**
   * Inject a raw SQL condition fragment.
   *
   * @remarks
   * **Trusted developer SQL only.** Never pass HTTP/user input here —
   * values must be bind parameters (`?` / `$n` placeholders), not inlined.
   * Prefer `eq`/`in`/`group` for anything user-influenced.
   * Alias of {@link rawUnsafe}.
   */
  raw(condition: string, ...values: any[]): this {
    return this.rawUnsafe(condition, ...values)
  }

  /**
   * Same as {@link raw} but named to signal danger.
   * Use only for static, developer-authored SQL fragments.
   */
  rawUnsafe(condition: string, ...values: any[]): this {
    if (condition.includes('\0')) {
      throw new Error('Unsafe raw SQL rejected: null byte in fragment')
    }
    return this.addClause({
      column: '',
      operator: '=',
      value: new RawSql(condition, values),
    })
  }

  // ============ ARRAY OPERATIONS (PostgreSQL) ============

  has(column: string, value: any): this {
    return this.addClause({ column, operator: '@>', value: [value] })
  }

  hasSome(column: string, values: any[]): this {
    return this.addClause({ column, operator: '&&', value: values })
  }

  hasEvery(column: string, values: any[]): this {
    return this.addClause({ column, operator: '@>', value: values })
  }

  isEmpty(column: string): this {
    return this.addClause({ column, operator: '=', value: new RawSql('ARRAY[]::[]') })
  }

  isNotEmpty(column: string): this {
    return this.addClause({ column, operator: '!=', value: new RawSql('ARRAY[]::[]') })
  }

  // ============ BUILD ============

  build(): { sql: string; params: any[] } {
    if (this.clauses.length === 0) {
      return { sql: '', params: [] }
    }

    const params: any[] = []
    const parts: string[] = []
    let paramIndex = 1

    for (let i = 0; i < this.clauses.length; i++) {
      const clause = this.clauses[i]
      const prefix = i === 0 ? '' : `${clause.connector || 'AND'} `
      assertSafeOperator(clause.operator)

      if (clause.nested) {
        const nested = this.buildNested(clause.nested, paramIndex)
        parts.push(`${prefix}(${nested.sql})`)
        params.push(...nested.params)
        paramIndex += nested.params.length
        continue
      }

      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator}`)
        continue
      }

      if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as any[]
        const placeholders = values.map(() => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator} (${placeholders.join(', ')})`)
        params.push(...values)
        continue
      }

      if (clause.operator === 'BETWEEN' || clause.operator === 'NOT BETWEEN') {
        const [min, max] = clause.value as [any, any]
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator} ${this.placeholderFn(paramIndex++)} AND ${this.placeholderFn(paramIndex++)}`)
        params.push(min, max)
        continue
      }

      if (isRawSql(clause.value)) {
        const rawValues = clause.value.values
        const processed = clause.value.raw.replace(/\?/g, () => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${processed}`)
        params.push(...rawValues)
        continue
      }

      // Array operators: @> (contains), && (overlaps)
      if (clause.operator === '@>' || clause.operator === '&&') {
        const values = clause.value as any[]
        if (Array.isArray(values)) {
          const placeholders = values.map(() => this.placeholderFn(paramIndex++))
          parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator} ARRAY[${placeholders.join(', ')}]::text[]`)
          params.push(...values)
        }
        continue
      }

      parts.push(
        `${prefix}${this.quote(clause.column)} ${clause.operator} ${this.placeholderFn(paramIndex++)}${likeSuffix(clause.operator)}`,
      )
      params.push(clause.value)
    }

    return {
      sql: parts.join(' ').trim(),
      params,
    }
  }

  private buildNested(clauses: WhereClause[], startIndex: number): { sql: string; params: any[] } {
    const params: any[] = []
    const parts: string[] = []
    let paramIndex = startIndex

    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i]
      const prefix = i === 0 ? '' : `${clause.connector || 'AND'} `
      assertSafeOperator(clause.operator)

      if (clause.nested) {
        const nested = this.buildNested(clause.nested, paramIndex)
        parts.push(`${prefix}(${nested.sql})`)
        params.push(...nested.params)
        paramIndex += nested.params.length
        continue
      }

      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator}`)
        continue
      }

      if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as any[]
        const placeholders = values.map(() => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator} (${placeholders.join(', ')})`)
        params.push(...values)
        continue
      }

      if (isRawSql(clause.value)) {
        const rawValues = clause.value.values
        let valueIndex = 0
        const processed = clause.value.raw.replace(/\?/g, () => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${processed}`)
        params.push(...rawValues)
        continue
      }

      parts.push(
        `${prefix}${this.quote(clause.column)} ${clause.operator} ${this.placeholderFn(paramIndex++)}${likeSuffix(clause.operator)}`,
      )
      params.push(clause.value)
    }

    return {
      sql: parts.join(' ').trim(),
      params,
    }
  }

  // ============ STATIC ============

  static create(
    placeholderFn?: (index: number) => string,
    quote?: (name: string) => string,
  ): ExpressionBuilder {
    return new ExpressionBuilder(placeholderFn, quote)
  }

  static from(
    clauses: WhereClause[],
    placeholderFn?: (index: number) => string,
    quote?: (name: string) => string,
  ): ExpressionBuilder {
    const builder = new ExpressionBuilder(placeholderFn, quote)
    builder.clauses = [...clauses]
    return builder
  }
}
