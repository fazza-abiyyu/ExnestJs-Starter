// VA-ORM Subquery Builder

import type { DatabaseDriver } from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'

export class SubqueryBuilder {
  private placeholderFn: (index: number) => string

  constructor(
    private driver: DatabaseDriver,
    placeholderFn?: (index: number) => string
  ) {
    this.placeholderFn = placeholderFn || ((i) => driver.getPlaceholder(i))
  }

  // ============ CREATE SUBQUERY ============

  fromQueryBuilder<T>(builder: QueryBuilder<T>): { sql: string; params: any[] } {
    return builder.build()
  }

  fromRaw(sql: string, params: any[] = []): { sql: string; params: any[] } {
    return { sql, params }
  }

  // ============ SUBQUERY IN WHERE ============

  inSubquery(column: string, subquery: { sql: string; params: any[] }): string {
    return `${column} IN (${subquery.sql})`
  }

  notInSubquery(column: string, subquery: { sql: string; params: any[] }): string {
    return `${column} NOT IN (${subquery.sql})`
  }

  exists(subquery: { sql: string; params: any[] }): string {
    return `EXISTS (${subquery.sql})`
  }

  notExists(subquery: { sql: string; params: any[] }): string {
    return `NOT EXISTS (${subquery.sql})`
  }

  // ============ SUBQUERY IN FROM ============

  asTable(subquery: { sql: string; params: any[] }, alias: string): { sql: string; params: any[] } {
    return {
      sql: `(${subquery.sql}) AS ${alias}`,
      params: subquery.params,
    }
  }

  // ============ SUBQUERY IN SELECT ============

  asColumn(subquery: { sql: string; params: any[] }, alias: string): string {
    return `(${subquery.sql}) AS ${alias}`
  }

  // ============ SCALAR SUBQUERY ============

  scalar(subquery: { sql: string; params: any[] }): string {
    return `(${subquery.sql})`
  }

  // ============ AGGREGATE SUBQUERY ============

  countSubquery(subquery: { sql: string; params: any[] }): string {
    return `(SELECT COUNT(*) FROM (${subquery.sql}) AS _subquery)`
  }

  sumSubquery(column: string, subquery: { sql: string; params: any[] }): string {
    return `(SELECT SUM(${column}) FROM (${subquery.sql}) AS _subquery)`
  }

  avgSubquery(column: string, subquery: { sql: string; params: any[] }): string {
    return `(SELECT AVG(${column}) FROM (${subquery.sql}) AS _subquery)`
  }

  minSubquery(column: string, subquery: { sql: string; params: any[] }): string {
    return `(SELECT MIN(${column}) FROM (${subquery.sql}) AS _subquery)`
  }

  maxSubquery(column: string, subquery: { sql: string; params: any[] }): string {
    return `(SELECT MAX(${column}) FROM (${subquery.sql}) AS _subquery)`
  }

  // ============ STATIC ============

  static create(driver: DatabaseDriver, placeholderFn?: (index: number) => string): SubqueryBuilder {
    return new SubqueryBuilder(driver, placeholderFn)
  }
}
