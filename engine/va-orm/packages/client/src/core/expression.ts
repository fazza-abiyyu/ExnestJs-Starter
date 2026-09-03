// VA-ORM Expression Builder

import type { WhereClause, FilterOperator } from './types.js'

export class ExpressionBuilder {
  private clauses: WhereClause[] = []
  private params: any[] = []
  private placeholderFn: (index: number) => string
  private pendingConnector?: 'AND' | 'OR' | 'NOT'

  constructor(placeholderFn: (index: number) => string = (i) => `$${i}`) {
    this.placeholderFn = placeholderFn
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
    const nested = new ExpressionBuilder(this.placeholderFn)
    fn(nested)
    this.addClause({
      column: '',
      operator: '=',
      nested: nested.clauses,
    })
    return this
  }

  // ============ RAW ============

  raw(condition: string, ...values: any[]): this {
    return this.addClause({
      column: '',
      operator: '=',
      value: { raw: condition, values },
    })
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

      if (clause.nested) {
        const nested = this.buildNested(clause.nested, paramIndex)
        parts.push(`${prefix}(${nested.sql})`)
        params.push(...nested.params)
        paramIndex += nested.params.length
        continue
      }

      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        parts.push(`${prefix}${clause.column} ${clause.operator}`)
        continue
      }

      if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as any[]
        const placeholders = values.map(() => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${clause.column} ${clause.operator} (${placeholders.join(', ')})`)
        params.push(...values)
        continue
      }

      if (clause.operator === 'BETWEEN' || clause.operator === 'NOT BETWEEN') {
        const [min, max] = clause.value as [any, any]
        parts.push(`${prefix}${clause.column} ${clause.operator} ${this.placeholderFn(paramIndex++)} AND ${this.placeholderFn(paramIndex++)}`)
        params.push(min, max)
        continue
      }

      if (clause.value && typeof clause.value === 'object' && 'raw' in clause.value) {
        const rawValues = clause.value.values
        let valueIndex = 0
        const processed = clause.value.raw.replace(/\?/g, () => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${processed}`)
        params.push(...rawValues)
        continue
      }

      parts.push(`${prefix}${clause.column} ${clause.operator} ${this.placeholderFn(paramIndex++)}`)
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

      if (clause.nested) {
        const nested = this.buildNested(clause.nested, paramIndex)
        parts.push(`${prefix}(${nested.sql})`)
        params.push(...nested.params)
        paramIndex += nested.params.length
        continue
      }

      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        parts.push(`${prefix}${clause.column} ${clause.operator}`)
        continue
      }

      if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as any[]
        const placeholders = values.map(() => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${clause.column} ${clause.operator} (${placeholders.join(', ')})`)
        params.push(...values)
        continue
      }

      if (clause.value && typeof clause.value === 'object' && 'raw' in clause.value) {
        const rawValues = clause.value.values
        let valueIndex = 0
        const processed = clause.value.raw.replace(/\?/g, () => this.placeholderFn(paramIndex++))
        parts.push(`${prefix}${processed}`)
        params.push(...rawValues)
        continue
      }

      parts.push(`${prefix}${clause.column} ${clause.operator} ${this.placeholderFn(paramIndex++)}`)
      params.push(clause.value)
    }

    return {
      sql: parts.join(' ').trim(),
      params,
    }
  }

  // ============ STATIC ============

  static create(placeholderFn?: (index: number) => string): ExpressionBuilder {
    return new ExpressionBuilder(placeholderFn)
  }

  static from(clauses: WhereClause[], placeholderFn?: (index: number) => string): ExpressionBuilder {
    const builder = new ExpressionBuilder(placeholderFn)
    builder.clauses = [...clauses]
    return builder
  }
}
