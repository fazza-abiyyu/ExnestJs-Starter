// VA-ORM Nested Writes
//
// Prisma-style nested operations executed atomically inside a transaction:
// create, connect, connectOrCreate, disconnect, set, update.

import type { DatabaseDriver, ModelMeta, RelationMeta } from '../core/types.js'
import { ansiQuote } from '../relation/quote.js'
import type { QuoteFn } from '../relation/quote.js'
import { buildSetClause } from './field.ops.js'

export interface NestedCreateOp {
  create?: Record<string, any> | Record<string, any>[]
  connect?: Record<string, any> | Record<string, any>[]
  connectOrCreate?: ConnectOrCreateOp | ConnectOrCreateOp[]
}

export interface ConnectOrCreateOp {
  where: Record<string, any>
  create: Record<string, any>
}

export interface NestedUpdateOp extends NestedCreateOp {
  disconnect?: Record<string, any> | Record<string, any>[]
  set?: Record<string, any> | Record<string, any>[]
  update?: NestedUpdateItem | NestedUpdateItem[]
}

export interface NestedUpdateItem {
  where: Record<string, any>
  data: Record<string, any>
}

export type NestedData = Record<string, any>

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

export class NestedWriter {
  private quote: QuoteFn

  constructor(
    private driver: DatabaseDriver,
    private registry: Map<string, ModelMeta>,
    quote: QuoteFn = ansiQuote
  ) {
    this.quote = quote
  }

  /**
   * Quote a COLUMN identifier. VA-ORM DDL is unquoted so the DB folds
   * identifiers to lowercase — columns must be lowercased to match
   * (e.g. userId → "userid"), consistent with SELECT/INSERT elsewhere.
   * Safe on MySQL/SQLite (column resolution is case-insensitive there).
   * NOTE: table names are intentionally NOT lowercased (MySQL tables
   * are case-sensitive) — schemas targeting PostgreSQL should use
   * lowercase table names (e.g. @@map("customers")).
   */
  private col(name: string): string {
    return this.quote(name.toLowerCase())
  }

  private metaOf(model: string): ModelMeta {
    const meta = this.registry.get(model)
    if (!meta) throw new Error(`Model "${model}" is not registered`)
    return meta
  }

  private splitData(model: ModelMeta, data: NestedData): { scalars: Record<string, any>; relations: Record<string, any> } {
    const scalars: Record<string, any> = {}
    const relations: Record<string, any> = {}
    for (const [key, value] of Object.entries(data)) {
      if (model.relations.has(key)) relations[key] = value
      else scalars[key] = value
    }
    return { scalars, relations }
  }

  async insertRow(model: ModelMeta, data: Record<string, any>): Promise<Record<string, any>> {
    const columns = Object.keys(data)
    if (columns.length === 0) {
      throw new Error(`Cannot create ${model.name} with empty data`)
    }
    const values = Object.values(data)
    const placeholders = values.map((_, i) => this.driver.getPlaceholder(i + 1))
    const quotedColumns = columns.map((c) => this.col(c))
    const sql = `INSERT INTO ${this.quote(model.table)} (${quotedColumns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`
    const result = await this.driver.query(sql, values)
    return result.rows[0]
  }

  async create(modelName: string, data: NestedData): Promise<Record<string, any>> {
    const model = this.metaOf(modelName)
    const { scalars, relations } = this.splitData(model, data)
    const parent = await this.insertRow(model, scalars)

    for (const [field, ops] of Object.entries(relations)) {
      const meta = model.relations.get(field)!
      await this.applyCreateOps(meta, model, parent, ops)
    }

    return parent
  }

  private async applyCreateOps(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    ops: NestedCreateOp
  ): Promise<void> {
    for (const item of toArray(ops.create)) {
      await this.nestedCreate(meta, parent, parentRow, item)
    }
    for (const where of toArray(ops.connect)) {
      await this.connect(meta, parent, parentRow, where)
    }
    for (const op of toArray(ops.connectOrCreate)) {
      await this.connectOrCreate(meta, parent, parentRow, op)
    }
  }

  private async nestedCreate(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    data: Record<string, any>
  ): Promise<Record<string, any>> {
    const child = this.metaOf(meta.targetModel)

    if (meta.kind === 'many-to-many-implicit' && meta.joinTable) {
      const created = await this.create(child.name, data)
      await this.insertJoinRow(meta, parent, parentRow, child, created)
      return created
    }

    if (meta.isFkHolder) {
      const created = await this.create(child.name, data)
      const childPk = meta.pkFields[0] ?? child.primaryKey
      await this.updateRows(parent, { [parent.primaryKey]: parentRow[parent.primaryKey] }, { [meta.fkFields[0]]: created[childPk] })
      return created
    }

    const parentPk = meta.pkFields[0] ?? parent.primaryKey
    return this.create(child.name, { ...data, [meta.fkFields[0]]: parentRow[parentPk] })
  }

  private async connect(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    where: Record<string, any>
  ): Promise<void> {
    const child = this.metaOf(meta.targetModel)
    const found = await this.findByUnique(child, where)
    if (!found) {
      throw new Error(`connect: no ${child.name} found for ${JSON.stringify(where)}`)
    }

    if (meta.kind === 'many-to-many-implicit' && meta.joinTable) {
      await this.insertJoinRow(meta, parent, parentRow, child, found)
      return
    }

    if (meta.isFkHolder) {
      const childPk = meta.pkFields[0] ?? child.primaryKey
      await this.updateRows(parent, { [parent.primaryKey]: parentRow[parent.primaryKey] }, { [meta.fkFields[0]]: found[childPk] })
      return
    }

    const parentPk = meta.pkFields[0] ?? parent.primaryKey
    await this.updateRows(child, where, { [meta.fkFields[0]]: parentRow[parentPk] })
  }

  private async connectOrCreate(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    op: ConnectOrCreateOp
  ): Promise<void> {
    const child = this.metaOf(meta.targetModel)

    // Use advisory lock to prevent race conditions
    const lockKey = this.generateLockKey(child.name, op.where)
    await this.acquireAdvisoryLock(lockKey)

    try {
      const found = await this.findByUnique(child, op.where)
      if (found) {
        await this.connect(meta, parent, parentRow, op.where)
      } else {
        await this.nestedCreate(meta, parent, parentRow, op.create)
      }
    } finally {
      await this.releaseAdvisoryLock(lockKey)
    }
  }

  private generateLockKey(modelName: string, where: Record<string, any>): string {
    const whereStr = JSON.stringify(where, Object.keys(where).sort())
    let hash = 0
    for (let i = 0; i < whereStr.length; i++) {
      const char = whereStr.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `${modelName}:${Math.abs(hash)}`
  }

  private async acquireAdvisoryLock(lockKey: string): Promise<void> {
    try {
      await this.driver.execute(
        `SELECT pg_advisory_lock(hashtext($1))`,
        [lockKey]
      )
    } catch {
      // Advisory locks not supported (non-PostgreSQL), skip locking
    }
  }

  private async releaseAdvisoryLock(lockKey: string): Promise<void> {
    try {
      await this.driver.execute(
        `SELECT pg_advisory_unlock(hashtext($1))`,
        [lockKey]
      )
    } catch {
      // Advisory locks not supported, skip unlocking
    }
  }

  async update(modelName: string, where: Record<string, any>, data: NestedData): Promise<Record<string, any>[]> {
    const model = this.metaOf(modelName)
    const { scalars, relations } = this.splitData(model, data)
    const targets = await this.findByWhere(model, where)

    const updated: Record<string, any>[] = []
    for (const row of targets) {
      if (Object.keys(scalars).length > 0) {
        await this.updateRows(model, { [model.primaryKey]: row[model.primaryKey] }, scalars)
      }
      for (const [field, ops] of Object.entries(relations)) {
        const meta = model.relations.get(field)!
        await this.applyUpdateOps(meta, model, row, ops)
      }
      updated.push(row)
    }

    return updated
  }

  private async applyUpdateOps(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    ops: NestedUpdateOp
  ): Promise<void> {
    await this.applyCreateOps(meta, parent, parentRow, ops)

    for (const where of toArray(ops.disconnect)) {
      await this.disconnect(meta, parent, parentRow, where)
    }

    if (ops.set !== undefined) {
      await this.replaceAll(meta, parent, parentRow, toArray(ops.set))
    }

    for (const item of toArray(ops.update)) {
      await this.nestedUpdate(meta, parent, parentRow, item)
    }
  }

  private async disconnect(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    where: Record<string, any>
  ): Promise<void> {
    const child = this.metaOf(meta.targetModel)
    const parentPk = meta.pkFields[0] ?? parent.primaryKey

    if (meta.kind === 'many-to-many-implicit' && meta.joinTable) {
      const found = await this.findByUnique(child, where)
      if (!found) return
      const childPk = this.uniqueKeyOf(where)
      const parentIsA = meta.pkModel < meta.targetModel
      const sql =
        `DELETE FROM ${this.quote(meta.joinTable!)} WHERE ${this.col(parentIsA ? 'A' : 'B')} = ${this.driver.getPlaceholder(1)} ` +
        `AND ${this.col(parentIsA ? 'B' : 'A')} = ${this.driver.getPlaceholder(2)}`
      await this.driver.execute(sql, [parentRow[parentPk], found[childPk]])
      return
    }

    if (meta.isFkHolder) {
      await this.updateRows(parent, { [parent.primaryKey]: parentRow[parent.primaryKey] }, { [meta.fkFields[0]]: null })
      return
    }

    const found = await this.findByUnique(child, where)
    if (!found) return
    await this.updateRows(child, where, { [meta.fkFields[0]]: null })
  }

  private async replaceAll(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    wheres: Record<string, any>[]
  ): Promise<void> {
    const child = this.metaOf(meta.targetModel)
    const parentPk = meta.pkFields[0] ?? parent.primaryKey

    if (meta.kind === 'many-to-many-implicit' && meta.joinTable) {
      const parentIsA = meta.pkModel < meta.targetModel
      await this.driver.execute(
        `DELETE FROM ${this.quote(meta.joinTable!)} WHERE ${this.col(parentIsA ? 'A' : 'B')} = ${this.driver.getPlaceholder(1)}`,
        [parentRow[parentPk]]
      )
    } else if (meta.isFkHolder) {
      await this.updateRows(parent, { [parent.primaryKey]: parentRow[parent.primaryKey] }, { [meta.fkFields[0]]: null })
    } else {
      await this.updateRows(
        child,
        { [meta.fkFields[0]]: parentRow[parentPk] } as Record<string, any>,
        { [meta.fkFields[0]]: null }
      )
    }

    for (const where of wheres) {
      await this.connect(meta, parent, parentRow, where)
    }
  }

  private async nestedUpdate(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    item: NestedUpdateItem
  ): Promise<void> {
    const child = this.metaOf(meta.targetModel)
    const parentPk = meta.pkFields[0] ?? parent.primaryKey

    if (meta.isFkHolder || meta.kind === 'many-to-many-implicit') {
      throw new Error(`Nested update on relation "${meta.field}" is not supported for this relation kind`)
    }

    const targets = await this.findByWhere(child, { ...item.where, [meta.fkFields[0]]: parentRow[parentPk] })
    for (const row of targets) {
      const childPk = child.primaryKey
      await this.updateRows(child, { [childPk]: row[childPk] }, this.stripRelations(child, item.data))
    }
  }

  private stripRelations(model: ModelMeta, data: Record<string, any>): Record<string, any> {
    const scalars: Record<string, any> = {}
    for (const [key, value] of Object.entries(data)) {
      if (!model.relations.has(key)) scalars[key] = value
    }
    return scalars
  }

  private uniqueKeyOf(where: Record<string, any>): string {
    const keys = Object.keys(where)
    if (keys.length === 0) throw new Error('connect/disconnect requires a unique where condition')
    return keys[0]
  }

  private async findByUnique(model: ModelMeta, where: Record<string, any>): Promise<Record<string, any> | null> {
    const rows = await this.findByWhere(model, where)
    return rows[0] ?? null
  }

  private async findByWhere(model: ModelMeta, where: Record<string, any>): Promise<Record<string, any>[]> {
    const entries = Object.entries(where)
    const params: any[] = []
    const clauses = entries.map(([key, value], i) => {
      params.push(value)
      return `${this.col(key)} = ${this.driver.getPlaceholder(i + 1)}`
    })
    const sql = `SELECT * FROM ${this.quote(model.table)}${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''}`
    const result = await this.driver.query(sql, params)
    return result.rows
  }

  private async updateRows(
    model: ModelMeta,
    where: Record<string, any>,
    data: Record<string, any>
  ): Promise<void> {
    const setEntries = Object.entries(data)
    if (setEntries.length === 0) return
    const whereEntries = Object.entries(where)
    const { setParts, params, nextIndex } = buildSetClause(data, (i) => this.driver.getPlaceholder(i), this.quote)
    const paramsWithWhere = [...params]
    const whereParts = whereEntries.map(([key], i) => {
      paramsWithWhere.push(where[key])
      return `${this.col(key)} = ${this.driver.getPlaceholder(nextIndex + i)}`
    })
    const sql = `UPDATE ${this.quote(model.table)} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`
    await this.driver.execute(sql, paramsWithWhere)
  }

  private async insertJoinRow(
    meta: RelationMeta,
    parent: ModelMeta,
    parentRow: Record<string, any>,
    child: ModelMeta,
    childRow: Record<string, any>
  ): Promise<void> {
    const parentIsA = meta.pkModel < meta.targetModel
    const parentPk = meta.pkFields[0] ?? parent.primaryKey
    const childPk = meta.pkFields[0] ?? child.primaryKey
    const a = parentIsA ? parentRow[parentPk] : childRow[childPk]
    const b = parentIsA ? childRow[childPk] : parentRow[parentPk]
    const sql =
      `INSERT INTO ${this.quote(meta.joinTable!)} (${this.col('A')}, ${this.col('B')}) VALUES ` +
      `(${this.driver.getPlaceholder(1)}, ${this.driver.getPlaceholder(2)}) ON CONFLICT DO NOTHING`
    await this.driver.execute(sql, [a, b])
  }
}
