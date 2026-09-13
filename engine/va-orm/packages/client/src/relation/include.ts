// VA-ORM Include Loader
//
// Eager-loads relations with one extra query per relation level
// (no N+1, no row fan-out). Supports nested include, where/orderBy/take/skip.

import type {
  DatabaseDriver,
  IncludeArg,
  IncludeMap,
  ModelMeta,
  RelationMeta,
  SelectArg,
  SortDirection,
  WhereInput,
} from '../core/types.js'
import { buildWhere } from './filters.js'
import { resolveSelect, stripColumns } from './select.js'
import { ansiQuote } from './quote.js'
import type { QuoteFn } from './quote.js'

interface ResolvedInclude {
  meta: RelationMeta
  child: ModelMeta
  where?: WhereInput
  orderBy?: Record<string, SortDirection>
  take?: number
  skip?: number
  select?: SelectArg
  include?: IncludeMap
}

function resolveIncludeArg(arg: IncludeArg): Omit<ResolvedInclude, 'meta' | 'child'> {
  if (typeof arg === 'boolean') return {}
  return {
    where: arg.where,
    orderBy: arg.orderBy,
    take: arg.take,
    skip: arg.skip,
    select: arg.select,
    include: arg.include,
  }
}

export class IncludeLoader {
  private quote: QuoteFn

  constructor(
    private driver: DatabaseDriver,
    private registry: Map<string, ModelMeta>,
    quote: QuoteFn = ansiQuote
  ) {
    this.quote = quote
  }

  async load<T extends Record<string, any>>(
    parents: T[],
    model: ModelMeta,
    include: IncludeMap
  ): Promise<T[]> {
    if (parents.length === 0) return parents

    for (const [field, arg] of Object.entries(include)) {
      if (arg === false) continue
      const meta = model.relations.get(field)
      if (!meta) {
        throw new Error(`Relation "${field}" is not defined on model "${model.name}"`)
      }
      const child = this.registry.get(meta.targetModel)
      if (!child) {
        throw new Error(`Relation target model "${meta.targetModel}" is not registered`)
      }
      const resolved: ResolvedInclude = { meta, child, ...resolveIncludeArg(arg) }

      if (meta.kind === 'many-to-many-implicit') {
        await this.loadManyToMany(parents, model, resolved)
      } else if (meta.isList) {
        await this.loadList(parents, model, resolved)
      } else {
        await this.loadSingle(parents, model, resolved)
      }
    }

    return parents
  }

  private parentKeys<T extends Record<string, any>>(parents: T[], model: ModelMeta): any[] {
    const pk = model.primaryKey
    return [...new Set(parents.map((p) => p[pk]).filter((v) => v !== undefined && v !== null))]
  }

  private async queryChildren(
    child: ModelMeta,
    where: { column: string; values: any[] } | null,
    opts: Omit<ResolvedInclude, 'meta' | 'child'>,
    extraColumns: string[] = []
  ): Promise<Record<string, any>[]> {
    const params: any[] = []
    let paramIndex = 1
    const ph = () => this.driver.getPlaceholder(paramIndex++)
    const clauses: string[] = []
    const resolved = resolveSelect(child, opts.select, opts.include)
    const projectionCols = resolved.columns
      ? [...new Set([...resolved.columns, ...extraColumns])]
      : null

    if (where && where.values.length > 0) {
      const placeholders = where.values.map(() => ph())
      clauses.push(`${this.quote(where.column)} IN (${placeholders.join(', ')})`)
      params.push(...where.values)
    } else if (where) {
      return []
    }

    if (opts.where) {
      const { sql, params: whereParams } = this.buildChildWhere(opts.where, child, paramIndex)
      if (sql) {
        clauses.push(`(${sql})`)
        params.push(...whereParams)
        paramIndex += whereParams.length
      }
    }

    const projection = projectionCols
      ? projectionCols.map((c) => this.quote(c)).join(', ')
      : '*'
    let sql = `SELECT ${projection} FROM ${this.quote(child.table)}`
    if (clauses.length > 0) sql += ` WHERE ${clauses.join(' AND ')}`
    if (opts.orderBy) {
      const order = Object.entries(opts.orderBy)
        .map(([col, dir]) => `${this.quote(col)} ${(dir as string).toUpperCase()}`)
        .join(', ')
      if (order) sql += ` ORDER BY ${order}`
    }
    if (opts.take !== undefined) sql += ` LIMIT ${opts.take}`
    if (opts.skip !== undefined) sql += ` OFFSET ${opts.skip}`

    const result = await this.driver.query(sql, params)
    return result.rows
  }

  private buildChildWhere(
    where: WhereInput,
    child: ModelMeta,
    startIndex: number
  ): { sql: string; params: any[] } {
    return buildWhere(
      where,
      child,
      this.registry,
      (i) => this.driver.getPlaceholder(startIndex + i - 1),
      this.quote
    )
  }

  private async loadList<T extends Record<string, any>>(
    parents: T[],
    model: ModelMeta,
    resolved: ResolvedInclude
  ): Promise<void> {
    const { meta, child } = resolved
    const keys = this.parentKeys(parents, model)
    if (keys.length === 0) return

    const fk = meta.fkFields[0]
    const pk = meta.pkFields[0] ?? model.primaryKey
    const children = await this.queryChildren(child, { column: fk, values: keys }, resolved, [fk])

    const grouped = new Map<any, Record<string, any>[]>()
    for (const c of children) {
      const key = c[fk]
      const list = grouped.get(key) ?? []
      list.push(c)
      grouped.set(key, list)
    }

    for (const parent of parents) {
      ;(parent as Record<string, unknown>)[meta.field] = grouped.get(parent[pk]) ?? []
    }

    if (resolved.include) {
      await this.load(children, child, resolved.include)
    }
    stripColumns(children, resolveSelect(child, resolved.select, resolved.include).keep)
  }

  private async loadSingle<T extends Record<string, any>>(
    parents: T[],
    model: ModelMeta,
    resolved: ResolvedInclude
  ): Promise<void> {
    const { meta, child } = resolved

    if (meta.isFkHolder) {
      const fkValues = [...new Set(
        parents.map((p) => p[meta.fkFields[0]]).filter((v) => v !== undefined && v !== null)
      )]
      if (fkValues.length === 0) {
        for (const parent of parents) (parent as Record<string, unknown>)[meta.field] = null
        return
      }
      const pk = meta.pkFields[0] ?? child.primaryKey
      const children = await this.queryChildren(child, { column: pk, values: fkValues }, resolved, [pk])
      const byPk = new Map(children.map((c) => [c[pk], c]))
      for (const parent of parents) {
        (parent as Record<string, unknown>)[meta.field] = byPk.get(parent[meta.fkFields[0]]) ?? null
      }
      if (resolved.include) {
        await this.load(children, child, resolved.include)
      }
      stripColumns(children, resolveSelect(child, resolved.select, resolved.include).keep)
    } else {
      const keys = this.parentKeys(parents, model)
      if (keys.length === 0) return
      const fk = meta.fkFields[0]
      const pk = meta.pkFields[0] ?? model.primaryKey
      const children = await this.queryChildren(child, { column: fk, values: keys }, resolved, [fk])
      const byFk = new Map(children.map((c) => [c[fk], c]))
      for (const parent of parents) {
        (parent as Record<string, unknown>)[meta.field] = byFk.get(parent[pk]) ?? null
      }
      if (resolved.include) {
        await this.load(children, child, resolved.include)
      }
      stripColumns(children, resolveSelect(child, resolved.select, resolved.include).keep)
    }
  }

  private async loadManyToMany<T extends Record<string, any>>(
    parents: T[],
    model: ModelMeta,
    resolved: ResolvedInclude
  ): Promise<void> {
    const { meta, child } = resolved
    if (!meta.joinTable) throw new Error(`Missing join table for relation "${meta.field}"`)
    const keys = this.parentKeys(parents, model)
    if (keys.length === 0) return

    const parentIsA = meta.pkModel < meta.targetModel
    const parentCol = parentIsA ? 'A' : 'B'
    const childCol = parentIsA ? 'B' : 'A'
    const parentPk = meta.pkFields[0] ?? model.primaryKey
    const childPk = meta.pkFields[0] ?? child.primaryKey

    const params: any[] = []
    let paramIndex = 1
    const ph = () => this.driver.getPlaceholder(paramIndex++)
    const placeholders = keys.map(() => ph())
    params.push(...keys)

    const resolvedSelect = resolveSelect(child, resolved.select, resolved.include)
    const projection = resolvedSelect.columns
      ? [...new Set([...resolvedSelect.columns, childPk])].map((c) => `__c.${this.quote(c)}`).join(', ')
      : '__c.*'
    let sql =
      `SELECT ${projection}, __j.${this.quote(parentCol)} AS __parent_key FROM ${this.quote(child.table)} AS __c ` +
      `JOIN ${this.quote(meta.joinTable)} AS __j ON __c.${this.quote(childPk)} = __j.${this.quote(childCol)} ` +
      `WHERE __j.${this.quote(parentCol)} IN (${placeholders.join(', ')})`

    if (resolved.where) {
      const { sql: whereSql, params: whereParams } = this.buildChildWhere(resolved.where, child, paramIndex)
      if (whereSql) {
        sql += ` AND (${whereSql})`
        params.push(...whereParams)
      }
    }
    if (resolved.take !== undefined) sql += ` LIMIT ${resolved.take}`
    if (resolved.skip !== undefined) sql += ` OFFSET ${resolved.skip}`

    const result = await this.driver.query(sql, params)
    const grouped = new Map<any, Record<string, any>[]>()
    for (const row of result.rows as Record<string, any>[]) {
      const { __parent_key, ...rest } = row
      const list = grouped.get(__parent_key) ?? []
      list.push(rest)
      grouped.set(__parent_key, list)
    }

    for (const parent of parents) {
      (parent as Record<string, unknown>)[meta.field] = grouped.get(parent[parentPk]) ?? []
    }

    if (resolved.include) {
      const all = [...grouped.values()].flat()
      await this.load(all, child, resolved.include)
    }
    stripColumns([...grouped.values()].flat(), resolvedSelect.keep)
  }
}
