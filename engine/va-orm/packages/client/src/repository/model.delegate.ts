// VA-ORM Model Delegate
//
// Prisma-style per-model API: findUnique/findFirst/findMany
// with where/orderBy/take/skip/include.

import type {
  DatabaseDriver,
  IncludeMap,
  ModelMeta,
  SelectArg,
  SortDirection,
  WhereInput,
} from '../core/types.js'
import { QueryBuilder } from '../core/query-builder.js'
import { applyWhere } from '../relation/filters.js'
import { IncludeLoader } from '../relation/include.js'
import { resolveSelect, stripColumns } from '../relation/select.js'
import { NestedWriter } from './nested.writes.js'
import { AggregationRepository } from './aggregation.js'
import type { AggregateArgs, GroupByArgs } from './aggregation.js'
import { ansiQuote } from '../relation/quote.js'
import type { QuoteFn } from '../relation/quote.js'

export interface FindUniqueArgs {
  where: WhereInput
  select?: SelectArg
  include?: IncludeMap
}

export interface FindFirstArgs {
  where?: WhereInput
  orderBy?: Record<string, SortDirection>
  select?: SelectArg
  include?: IncludeMap
}

export interface FindManyArgs {
  where?: WhereInput
  orderBy?: Record<string, SortDirection>
  take?: number
  skip?: number
  select?: SelectArg
  include?: IncludeMap
}

export interface CreateArgs {
  data: Record<string, any>
  include?: IncludeMap
}

export interface UpdateArgs {
  where: Record<string, any>
  data: Record<string, any>
  include?: IncludeMap
}

export class ModelDelegate<T extends Record<string, any> = Record<string, any>> {
  private loader: IncludeLoader
  private quote: QuoteFn

  constructor(
    private driver: DatabaseDriver,
    private meta: ModelMeta,
    private registry: Map<string, ModelMeta>,
    quote: QuoteFn = ansiQuote
  ) {
    this.quote = quote
    this.loader = new IncludeLoader(driver, registry, quote)
  }

  async findUnique(args: FindUniqueArgs): Promise<(T & Record<string, any>) | null> {
    const rows = await this.findMany({ where: args.where, take: 1, select: args.select, include: args.include })
    return rows[0] ?? null
  }

  async findFirst(args: FindFirstArgs = {}): Promise<(T & Record<string, any>) | null> {
    const rows = await this.findMany({ ...args, take: 1 })
    return rows[0] ?? null
  }

  async findMany(args: FindManyArgs = {}): Promise<(T & Record<string, any>)[]> {
    const builder = new QueryBuilder<T>(this.driver, this.quote(this.meta.table))
    const quote = this.quote
    const resolved = resolveSelect(this.meta, args.select, args.include)

    if (resolved.columns) {
      builder.select(...resolved.columns.map((c) => quote(c)))
    }

    if (args.where) {
      const meta = this.meta
      const registry = this.registry
      builder.where((eb) => applyWhere(eb, args.where, meta, registry, quote))
    }

    if (args.orderBy) {
      for (const [column, direction] of Object.entries(args.orderBy)) {
        builder.orderBy(quote(column), direction)
      }
    }

    if (args.take !== undefined) builder.limit(args.take)
    if (args.skip !== undefined) builder.offset(args.skip)

    const rows = await builder.execute()

    if (args.include) {
      await this.loader.load(rows, this.meta, args.include)
    }

    return stripColumns(rows, resolved.keep)
  }

  async count(where?: WhereInput): Promise<number> {
    const builder = new QueryBuilder(this.driver, this.quote(this.meta.table))
    if (where) {
      const meta = this.meta
      const registry = this.registry
      const quote = this.quote
      builder.where((eb) => applyWhere(eb, where, meta, registry, quote))
    }
    return builder.count()
  }

  async exists(where?: WhereInput): Promise<boolean> {
    return (await this.count(where)) > 0
  }

  async aggregate(args?: AggregateArgs): Promise<Record<string, any>> {
    return new AggregationRepository(this.driver, this.meta.table, this.quote).aggregate(args)
  }

  async groupBy(args: GroupByArgs): Promise<Record<string, any>[]> {
    return new AggregationRepository(this.driver, this.meta.table, this.quote).groupBy(args)
  }

  async create(args: CreateArgs): Promise<Record<string, any>> {
    return this.driver.transaction(async (txDriver) => {
      const writer = new NestedWriter(txDriver, this.registry, this.quote)
      const row = await writer.create(this.meta.name, args.data)
      if (args.include) {
        const loader = new IncludeLoader(txDriver, this.registry, this.quote)
        await loader.load([row], this.meta, args.include)
      }
      return row
    })
  }

  async update(args: UpdateArgs): Promise<Record<string, any>[]> {
    return this.driver.transaction(async (txDriver) => {
      const writer = new NestedWriter(txDriver, this.registry, this.quote)
      const rows = await writer.update(this.meta.name, args.where, args.data)
      if (args.include && rows.length > 0) {
        const loader = new IncludeLoader(txDriver, this.registry, this.quote)
        await loader.load(rows, this.meta, args.include)
      }
      return rows
    })
  }
}
