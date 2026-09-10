// VA-ORM VaClient

import type { DatabaseDriver, DriverType, ConnectionConfig, ModelMeta, RelationMeta, TransactionOptions } from './types.js'
import type { SchemaAST } from '../../../schema/src/schema.types.js'
import { resolveRelations } from '../../../schema/src/schema.relations.js'
import { tableNameOf } from '../../../schema/src/schema.mapping.js'
import { quoterFor } from '../relation/quote.js'
import type { QuoteFn } from '../relation/quote.js'
import { ConnectionPool } from './connection.pool.js'
import { Repository } from '../repository/repository.js'
import { ModelDelegate } from '../repository/model.delegate.js'
import { RawQuery } from '../raw/raw-query.js'
import { CTEBuilder } from '../raw/cte.js'
import { SubqueryBuilder } from '../raw/subquery.js'
import { QueryMiddleware, type MiddlewareFn } from '../middleware/query.middleware.js'
import { EventEmitter, type EventListener, type EventData } from '../events/query.event.js'

export interface VaClientModelOptions {
  tableName?: string
  primaryKey?: string
  softDelete?: boolean
}

export interface VaClientOptions {
  driver: DriverType
  dsn: string
  pooling?: boolean
  connection?: ConnectionConfig
  models?: Record<string, { tableName: string; softDelete?: boolean } & { primaryKey?: string }>
  schema?: SchemaAST
  modelOptions?: Record<string, VaClientModelOptions>
}

export class VaClient {
  private driver: DatabaseDriver
  private pool?: ConnectionPool
  private repositories = new Map<string, Repository<any>>()
  private delegates = new Map<string, ModelDelegate<any>>()
  private modelRegistry = new Map<string, ModelMeta>()
  private rawQuery: RawQuery
  private middleware = new QueryMiddleware()
  private events = new EventEmitter()

  constructor(private options: VaClientOptions) {
    if (options.pooling !== false) {
      this.pool = new ConnectionPool(options.driver, options.dsn, options.connection)
      this.driver = this.createDriverProxy()
    } else {
      this.driver = this.createDirectDriver()
    }

    this.rawQuery = new RawQuery(this.driver)

    // Register repositories for models
    if (options.models) {
      for (const [name, model] of Object.entries(options.models)) {
        this.repositories.set(name, new Repository(this.driver, model.tableName, {
          softDelete: model.softDelete,
        }))
      }
    }

    // Build relation-aware model registry from schema
    if (options.schema) {
      const relations = resolveRelations(options.schema.model)
      for (const model of options.schema.model) {
        const key = model.name.charAt(0).toLowerCase() + model.name.slice(1)
        const explicit = options.models?.[model.name] ?? options.models?.[key]
        const override = options.modelOptions?.[model.name] ?? options.modelOptions?.[key]
        const table = explicit?.tableName ?? override?.tableName ?? tableNameOf(model)
        const idField = model.fields.find((f) => f.attributes.some((a) => a.name === '@id'))
        const primaryKey = explicit?.primaryKey ?? override?.primaryKey ?? idField?.name ?? 'id'
        const modelRelations = new Map<string, RelationMeta>()
        for (const [relKey, info] of relations) {
          if (relKey.startsWith(`${model.name}.`)) {
            modelRelations.set(info.field, { ...info })
          }
        }
        this.modelRegistry.set(model.name, { name: model.name, table, primaryKey, relations: modelRelations })
        this.modelRegistry.set(key, this.modelRegistry.get(model.name)!)
      }
    }
  }

  private createDriverProxy(): DatabaseDriver {
    const pool = this.pool!
    return {
      query: (sql, params) => pool.query(sql, params),
      execute: (sql, params) => pool.execute(sql, params),
      transaction: (fn) => pool.transaction(fn),
      close: () => pool.close(),
      getPlaceholder: (index) => pool['connections'][0]?.driver.getPlaceholder(index) ?? `$${index}`,
    }
  }

  private createDirectDriver(): DatabaseDriver {
    switch (this.options.driver) {
      case 'postgres': {
        const { PostgresDriver } = require('../drivers/postgres/postgres.driver.js')
        return new PostgresDriver(this.options.dsn, this.options.connection)
      }
      case 'mysql': {
        const { MysqlDriver } = require('../drivers/mysql/mysql.driver.js')
        return new MysqlDriver(this.options.dsn, this.options.connection)
      }
      case 'sqlite': {
        const { SqliteDriver } = require('../drivers/sqlite/sqlite.driver.js')
        return new SqliteDriver(this.options.dsn, this.options.connection)
      }
      default:
        throw new Error(`Unsupported driver: ${this.options.driver}`)
    }
  }

  // ============ REPOSITORY ACCESS ============

  repository<T extends Record<string, any>>(name: string): Repository<T> {
    if (!this.repositories.has(name)) {
      throw new Error(`Repository "${name}" not registered. Register it in VaClient options.models.`)
    }
    return this.repositories.get(name) as Repository<T>
  }

  model<T extends Record<string, any> = Record<string, any>>(name: string): ModelDelegate<T> {
    const meta = this.modelRegistry.get(name)
    if (!meta) {
      throw new Error(
        `Model "${name}" is not registered. Provide options.schema or register it in VaClient options.models.`
      )
    }
    if (!this.delegates.has(name)) {
      this.delegates.set(
        name,
        new ModelDelegate<T>(this.driver, meta, this.modelRegistry, quoterFor(this.options.driver))
      )
    }
    return this.delegates.get(name) as ModelDelegate<T>
  }

  protected delegate<T extends ModelDelegate<any>>(
    modelName: string,
    Ctor: new (
      driver: DatabaseDriver,
      meta: ModelMeta,
      registry: Map<string, ModelMeta>,
      quote: QuoteFn
    ) => T
  ): T {
    const key = `${modelName}:${Ctor.name}`
    if (!this.delegates.has(key)) {
      const meta = this.modelRegistry.get(modelName)
      if (!meta) {
        throw new Error(
          `Model "${modelName}" is not registered. Provide options.schema or register it in VaClient options.models.`
        )
      }
      this.delegates.set(key, new Ctor(this.driver, meta, this.modelRegistry, quoterFor(this.options.driver)))
    }
    return this.delegates.get(key) as T
  }

  // ============ RAW QUERIES ============

  get raw(): RawQuery {
    return this.rawQuery
  }

  get query(): RawQuery['query'] {
    return this.rawQuery.query.bind(this.rawQuery)
  }

  get queryOne(): RawQuery['queryOne'] {
    return this.rawQuery.queryOne.bind(this.rawQuery)
  }

  get execute(): RawQuery['execute'] {
    return this.rawQuery.execute.bind(this.rawQuery)
  }

  // ============ SQL TAGGED TEMPLATE ============

  sql<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    return this.rawQuery.sql<T>(strings, ...values)
  }

  sqlOne<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T | null> {
    return this.rawQuery.sqlOne<T>(strings, ...values)
  }

  // ============ CTE ============

  cte(): CTEBuilder {
    return CTEBuilder.create(this.driver)
  }

  // ============ SUBQUERY ============

  subquery(): SubqueryBuilder {
    return SubqueryBuilder.create(this.driver)
  }

  // ============ TRANSACTIONS ============

  async transaction<R>(fn: (client: VaClient) => Promise<R>, options?: TransactionOptions): Promise<R> {
    return this.driver.transaction(async (driver) => {
      const txClient = new VaClient({
        ...this.options,
        pooling: false,
      })
      txClient['driver'] = driver
      txClient['rawQuery'] = new RawQuery(driver)
      return fn(txClient)
    })
  }

  // ============ LIFECYCLE ============

  async connect(): Promise<void> {
    // Pool is created in constructor, just verify connection
    if (this.pool) {
      await this.pool.query('SELECT 1')
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close()
    }
  }

  getStats() {
    return this.pool?.getStats()
  }

  async isHealthy(): Promise<boolean> {
    if (!this.pool) return true
    return this.pool.isHealthy()
  }

  async ping(): Promise<{ latencyMs: number }> {
    if (!this.pool) return { latencyMs: 0 }
    return this.pool.ping()
  }

  // ============ MIDDLEWARE ============

  $use(middleware: MiddlewareFn): void {
    this.middleware.use(middleware)
  }

  // ============ EVENTS ============

  $on<T extends EventData = EventData>(event: T['type'], listener: EventListener<T>): () => void {
    return this.events.on(event, listener)
  }

  // ============ EXTENSIONS ============

  $extends(config: { query?: Record<string, (params: any, next: any) => Promise<any>> }): VaClient {
    const extended = new VaClient(this.options)
    if (config.query) {
      for (const [action, hook] of Object.entries(config.query)) {
        extended.middleware.use(async (params, next) => {
          if (params.action === action) {
            return hook(params, () => next(params))
          }
          return next(params)
        })
      }
    }
    return extended
  }

  // ============ STATIC ============

  static create(options: VaClientOptions): VaClient {
    return new VaClient(options)
  }
}
