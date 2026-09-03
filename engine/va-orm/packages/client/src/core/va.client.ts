// VA-ORM VaClient

import type { DatabaseDriver, DriverType, ConnectionConfig, TransactionOptions } from './types.js'
import { ConnectionPool } from './connection.pool.js'
import { Repository } from '../repository/repository.js'
import { RawQuery } from '../raw/raw-query.js'
import { CTEBuilder } from '../raw/cte.js'
import { SubqueryBuilder } from '../raw/subquery.js'

export interface VaClientOptions {
  driver: DriverType
  dsn: string
  pooling?: boolean
  connection?: ConnectionConfig
  models?: Record<string, { tableName: string; softDelete?: boolean }>
}

export class VaClient {
  private driver: DatabaseDriver
  private pool?: ConnectionPool
  private repositories = new Map<string, Repository<any>>()
  private rawQuery: RawQuery

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

  // ============ STATIC ============

  static create(options: VaClientOptions): VaClient {
    return new VaClient(options)
  }
}
