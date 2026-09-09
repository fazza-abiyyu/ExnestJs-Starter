// VA-ORM Relation Filters
//
// Translates Prisma-style WhereInput into ExpressionBuilder clauses,
// including relation filters (some/every/none/is/isNot) via EXISTS subqueries.
// All identifiers are quoted to support camelCase columns on PostgreSQL.

import { ExpressionBuilder } from '../core/expression.js'
import type { ModelMeta, RelationMeta, WhereInput } from '../core/types.js'
import { JoinBuilder } from './join.builder.js'
import { ansiQuote } from './quote.js'
import type { QuoteFn } from './quote.js'

const RESERVED_KEYS = new Set(['AND', 'OR', 'NOT'])

function isRelationFilterObject(value: any): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return ['some', 'every', 'none', 'is', 'isNot'].some((k) => k in value)
}

export function applyWhere(
  eb: ExpressionBuilder,
  where: WhereInput | undefined,
  model: ModelMeta,
  registry: Map<string, ModelMeta>,
  quote: QuoteFn = ansiQuote,
  parentAlias?: string,
  depth = 1
): void {
  if (!where) return
  const alias = parentAlias ?? model.table

  if (Array.isArray(where.AND)) {
    eb.group((g) => {
      for (const clause of where.AND as WhereInput[]) {
        applyWhere(g, clause, model, registry, quote, alias, depth)
      }
    })
  }

  if (Array.isArray(where.OR)) {
    eb.group((g) => {
      const clauses = where.OR as WhereInput[]
      clauses.forEach((clause, i) => {
        if (i > 0) g.or()
        applyWhere(g, clause, model, registry, quote, alias, depth)
      })
    })
  }

  if (where.NOT !== undefined) {
    const clauses = Array.isArray(where.NOT) ? where.NOT : [where.NOT]
    for (const clause of clauses as WhereInput[]) {
      eb.not().group((g) => applyWhere(g, clause, model, registry, quote, alias, depth))
    }
  }

  for (const [field, condition] of Object.entries(where)) {
    if (RESERVED_KEYS.has(field) || condition === undefined) continue
    const meta = model.relations.get(field)
    if (meta && isRelationFilterObject(condition)) {
      applyRelationFilter(eb, meta, condition as Record<string, WhereInput>, model, registry, quote, alias, depth)
    } else {
      applyScalarFilter(eb, quote(field), condition)
    }
  }
}

function applyScalarFilter(eb: ExpressionBuilder, column: string, condition: any): void {
  if (condition === null) {
    eb.isNull(column)
    return
  }

  if (typeof condition !== 'object' || Array.isArray(condition)) {
    eb.eq(column, condition)
    return
  }

  const insensitive = condition.mode === 'insensitive'
  if (condition.equals !== undefined) {
    if (condition.equals === null) eb.isNull(column)
    else eb.eq(column, condition.equals)
  }
  if (condition.not !== undefined) {
    if (condition.not === null) eb.isNotNull(column)
    else eb.neq(column, condition.not)
  }
  if (condition.in !== undefined) eb.in(column, condition.in)
  if (condition.notIn !== undefined) eb.notIn(column, condition.notIn)
  if (condition.lt !== undefined) eb.lt(column, condition.lt)
  if (condition.lte !== undefined) eb.lte(column, condition.lte)
  if (condition.gt !== undefined) eb.gt(column, condition.gt)
  if (condition.gte !== undefined) eb.gte(column, condition.gte)
  if (condition.contains !== undefined) {
    if (insensitive) eb.ilike(column, `%${condition.contains}%`)
    else eb.like(column, `%${condition.contains}%`)
  }
  if (condition.startsWith !== undefined) {
    if (insensitive) eb.ilike(column, `${condition.startsWith}%`)
    else eb.like(column, `${condition.startsWith}%`)
  }
  if (condition.endsWith !== undefined) {
    if (insensitive) eb.ilike(column, `%${condition.endsWith}`)
    else eb.like(column, `%${condition.endsWith}`)
  }
}

function childCondition(
  childWhere: WhereInput | undefined,
  childModel: ModelMeta,
  registry: Map<string, ModelMeta>,
  quote: QuoteFn,
  depth: number
): { sql: string; params: any[] } {
  const child = ExpressionBuilder.create(() => '?')
  applyWhere(child, childWhere, childModel, registry, quote, depth === 1 ? '__rel' : `__rel${depth}`, depth + 1)
  return child.build()
}

function applyRelationFilter(
  eb: ExpressionBuilder,
  meta: RelationMeta,
  filter: Record<string, WhereInput>,
  parent: ModelMeta,
  registry: Map<string, ModelMeta>,
  quote: QuoteFn,
  parentAlias: string,
  depth: number
): void {
  const child = registry.get(meta.targetModel)
  if (!child) {
    throw new Error(`Relation target model "${meta.targetModel}" is not registered`)
  }
  const childTable = quote(child.table)
  const relAlias = depth === 1 ? '__rel' : `__rel${depth}`

  if (filter.some !== undefined) {
    const { sql, params } = childCondition(filter.some, child, registry, quote, depth)
    eb.raw(
      `EXISTS (SELECT 1 FROM ${childTable} AS ${relAlias} WHERE ${existsJoin(meta, parent, child, relAlias, quote, parentAlias, depth)} ${andWrap(sql)})`,
      ...params
    )
  }
  if (filter.every !== undefined) {
    const { sql, params } = childCondition(filter.every, child, registry, quote, depth)
    eb.raw(
      `NOT EXISTS (SELECT 1 FROM ${childTable} AS ${relAlias} WHERE ${existsJoin(meta, parent, child, relAlias, quote, parentAlias, depth)} AND NOT (${sql || '1 = 1'}))`,
      ...params
    )
  }
  if (filter.none !== undefined) {
    const { sql, params } = childCondition(filter.none, child, registry, quote, depth)
    eb.raw(
      `NOT EXISTS (SELECT 1 FROM ${childTable} AS ${relAlias} WHERE ${existsJoin(meta, parent, child, relAlias, quote, parentAlias, depth)} ${andWrap(sql)})`,
      ...params
    )
  }
  if (filter.is !== undefined) {
    const { sql, params } = childCondition(filter.is, child, registry, quote, depth)
    eb.raw(
      `EXISTS (SELECT 1 FROM ${childTable} AS ${relAlias} WHERE ${existsJoin(meta, parent, child, relAlias, quote, parentAlias, depth)} ${andWrap(sql)})`,
      ...params
    )
  }
  if (filter.isNot !== undefined) {
    const { sql, params } = childCondition(filter.isNot, child, registry, quote, depth)
    const nullChecks = parentFkNullChecks(meta, parent, quote, parentAlias)
    eb.group((g) => {
      if (nullChecks) g.raw(nullChecks)
      if (nullChecks) g.or()
      g.raw(
        `NOT EXISTS (SELECT 1 FROM ${childTable} AS __rel WHERE ${existsJoin(meta, parent, child, relAlias, quote, parentAlias, depth)} ${andWrap(sql)})`,
        ...params
      )
    })
  }
}

function andWrap(sql: string): string {
  return sql ? `AND (${sql})` : ''
}

function existsJoin(
  meta: RelationMeta,
  parent: ModelMeta,
  child: ModelMeta,
  alias: string,
  quote: QuoteFn,
  parentAlias: string,
  depth: number
): string {
  const joinAlias = depth === 1 ? '__j' : `__j${depth}`
  if (meta.kind === 'many-to-many-implicit' && meta.joinTable) {
    const parentIsA = meta.pkModel < meta.targetModel
    const parentCol = parentIsA ? 'A' : 'B'
    const childCol = parentIsA ? 'B' : 'A'
    const parentPk = meta.pkFields[0] ?? 'id'
    const childPk = meta.pkFields[0] ?? 'id'
    void child
    return (
      `EXISTS (SELECT 1 FROM ${quote(meta.joinTable)} AS ${joinAlias} WHERE ${joinAlias}.${quote(parentCol)} = ${quote(`${parentAlias}.${parentPk}`)} AND ` +
      `${quote(`${alias}.${childPk}`)} = ${joinAlias}.${quote(childCol)})`
    )
  }
  return JoinBuilder.joinCondition(meta, parentAlias, alias, quote)
}

function parentFkNullChecks(
  meta: RelationMeta,
  parent: ModelMeta,
  quote: QuoteFn,
  parentAlias: string
): string {
  if (meta.kind === 'many-to-one' || (meta.kind === 'one-to-one' && meta.isFkHolder)) {
    return meta.fkFields.map((f) => `${quote(`${parentAlias}.${f}`)} IS NULL`).join(' AND ')
  }
  void parent
  return ''
}

export function buildWhere(
  where: WhereInput | undefined,
  model: ModelMeta,
  registry: Map<string, ModelMeta>,
  placeholderFn?: (index: number) => string,
  quote: QuoteFn = ansiQuote
): { sql: string; params: any[] } {
  const eb = ExpressionBuilder.create(placeholderFn)
  applyWhere(eb, where, model, registry, quote)
  return eb.build()
}
