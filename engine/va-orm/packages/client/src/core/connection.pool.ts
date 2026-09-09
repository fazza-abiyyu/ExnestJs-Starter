// VA-ORM Connection Pool

import type { DatabaseDriver, DriverType, ConnectionConfig, PoolStats, SlowQueryInfo } from './types.js'

interface PooledConnection {
  driver: DatabaseDriver
  lastUsed: number
  useCount: number
  isHealthy: boolean
}

export class ConnectionPool {
  private static globalFactories: Map<DriverType, (dsn: string) => DatabaseDriver> = new Map()

  static registerFactory(type: DriverType, factory: (dsn: string) => DatabaseDriver): void {
    ConnectionPool.globalFactories.set(type, factory)
  }

  private connections: PooledConnection[] = []
  private waitingQueue: Array<{
    resolve: (connection: DatabaseDriver) => void
    reject: (error: Error) => void
    timeout?: ReturnType<typeof setTimeout>
  }> = []
  private config: Required<Omit<ConnectionConfig, 'connectionString' | 'host' | 'port' | 'database' | 'user' | 'password' | 'filename' | 'ssl' | 'driverFactory' | 'slowQueryThresholdMs' | 'onSlowQuery'>> & { driverFactory?: (dsn: string) => DatabaseDriver; slowQueryThresholdMs?: number; onSlowQuery?: (info: SlowQueryInfo) => void }
  private stats = {
    totalQueries: 0,
    totalErrors: 0,
    slowQueries: 0,
    totalQueryTimeMs: 0,
    maxQueryTimeMs: 0,
    startTime: Date.now(),
  }
  private healthCheckInterval?: ReturnType<typeof setInterval>
  private closed = false
  private ready: Promise<void>

  constructor(
    private driverType: DriverType,
    private dsn: string,
    options: ConnectionConfig = {}
  ) {
    this.config = {
      max: options.max ?? 20,
      min: options.min ?? 2,
      idleTimeoutMs: options.idleTimeoutMs ?? 10000,
      connectionTimeoutMs: options.connectionTimeoutMs ?? 5000,
      maxLifetimeMs: options.maxLifetimeMs ?? 1800000, // 30 minutes
      maxUses: options.maxUses ?? 7500,
      statementTimeoutMs: options.statementTimeoutMs ?? 30000,
      lockTimeoutMs: options.lockTimeoutMs ?? 10000,
      healthCheck: options.healthCheck ?? true,
      healthCheckIntervalMs: options.healthCheckIntervalMs ?? 30000,
      healthCheckQuery: options.healthCheckQuery ?? this.getDefaultHealthCheckQuery(),
      retryAttempts: options.retryAttempts ?? 3,
      retryDelayMs: options.retryDelayMs ?? 1000,
      retryBackoff: options.retryBackoff ?? 'exponential',
      applicationName: options.applicationName ?? 'va-orm',
      disablePreparedStatements: options.disablePreparedStatements ?? false,
      driverFactory: options.driverFactory,
      slowQueryThresholdMs: options.slowQueryThresholdMs,
      onSlowQuery: options.onSlowQuery,
    }

    this.ready = this.init()
  }

  private getDefaultHealthCheckQuery(): string {
    switch (this.driverType) {
      case 'postgres':
        return 'SELECT 1'
      case 'mysql':
        return 'SELECT 1'
      case 'sqlite':
        return 'SELECT 1'
    }
  }

  private async init(): Promise<void> {
    // Pre-create minimum connections
    for (let i = 0; i < this.config.min; i++) {
      const connection = await this.createConnection()
      this.connections.push(connection)
    }

    // Start health check interval
    if (this.config.healthCheck) {
      this.healthCheckInterval = setInterval(
        () => this.performHealthCheck(),
        this.config.healthCheckIntervalMs
      )
    }
  }

  private async createConnection(): Promise<PooledConnection> {
    let driver: DatabaseDriver

    const factory = this.config.driverFactory || ConnectionPool.globalFactories.get(this.driverType)

    if (factory) {
      driver = factory(this.dsn)
    } else {
      switch (this.driverType) {
        case 'postgres': {
          const { PostgresDriver } = await import('../drivers/postgres/postgres.driver.js')
          driver = new PostgresDriver(this.dsn, {
            max: 1,
            connectionTimeoutMs: this.config.connectionTimeoutMs,
            applicationName: this.config.applicationName,
          })
          break
        }
        case 'mysql': {
          const { MysqlDriver } = await import('../drivers/mysql/mysql.driver.js')
          driver = new MysqlDriver(this.dsn, {
            max: 1,
            connectionTimeoutMs: this.config.connectionTimeoutMs,
          })
          break
        }
        case 'sqlite': {
          const { SqliteDriver } = await import('../drivers/sqlite/sqlite.driver.js')
          driver = new SqliteDriver(this.dsn)
          break
        }
        default:
          throw new Error(`Unsupported driver: ${this.driverType}`)
      }
    }

    return {
      driver,
      lastUsed: Date.now(),
      useCount: 0,
      isHealthy: true,
    }
  }

  async acquire(): Promise<DatabaseDriver> {
    await this.ready

    if (this.closed) {
      throw new Error('Pool is closed')
    }

    // Try to get an idle connection
    for (let i = 0; i < this.connections.length; i++) {
      const conn = this.connections[i]
      if (conn.isHealthy && conn.useCount < this.config.maxUses) {
        // Check if connection is too old
        if (Date.now() - conn.lastUsed < this.config.maxLifetimeMs) {
          this.connections.splice(i, 1)
          conn.lastUsed = Date.now()
          conn.useCount++
          return conn.driver
        }
      }
    }

    // Create new connection if under limit
    if (this.connections.length < this.config.max) {
      const conn = await this.createConnection()
      conn.lastUsed = Date.now()
      conn.useCount = 1
      return conn.driver
    }

    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingQueue.findIndex(w => w.resolve === resolve)
        if (index !== -1) {
          this.waitingQueue.splice(index, 1)
        }
        reject(new Error('Connection acquisition timeout'))
      }, this.config.connectionTimeoutMs)

      this.waitingQueue.push({ resolve, reject, timeout })
    })
  }

  async release(driver: DatabaseDriver): Promise<void> {
    if (this.closed) {
      await driver.close()
      return
    }

    // Find the waiting consumer
    const waiting = this.waitingQueue.shift()
    if (waiting) {
      if (waiting.timeout) {
        clearTimeout(waiting.timeout)
      }
      waiting.resolve(driver)
      return
    }

    // Return to pool
    const conn: PooledConnection = {
      driver,
      lastUsed: Date.now(),
      useCount: 0,
      isHealthy: true,
    }

    if (this.connections.length < this.config.max) {
      this.connections.push(conn)
    } else {
      await driver.close()
    }
  }

  private trackQuery(sql: string, params: any[] | undefined, start: number): void {
    const elapsedMs = Date.now() - start
    this.stats.totalQueries++
    this.stats.totalQueryTimeMs += elapsedMs
    if (elapsedMs > this.stats.maxQueryTimeMs) {
      this.stats.maxQueryTimeMs = elapsedMs
    }
    if (this.config.slowQueryThresholdMs !== undefined && elapsedMs >= this.config.slowQueryThresholdMs) {
      this.stats.slowQueries++
      this.config.onSlowQuery?.({ sql, elapsedMs, params })
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount: number }> {
    const start = Date.now()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      const driver = await this.acquire()
      try {
        const result = await driver.query<T>(sql, params)
        this.trackQuery(sql, params, start)
        await this.release(driver)
        return result
      } catch (error) {
        lastError = error as Error
        this.stats.totalErrors++
        await driver.close().catch(() => {})

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryBackoff === 'exponential'
            ? this.config.retryDelayMs * Math.pow(2, attempt)
            : this.config.retryDelayMs
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    const start = Date.now()
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      const driver = await this.acquire()
      try {
        const result = await driver.execute(sql, params)
        this.trackQuery(sql, params, start)
        await this.release(driver)
        return result
      } catch (error) {
        lastError = error as Error
        this.stats.totalErrors++
        await driver.close().catch(() => {})

        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryBackoff === 'exponential'
            ? this.config.retryDelayMs * Math.pow(2, attempt)
            : this.config.retryDelayMs
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const driver = await this.acquire()
    try {
      const result = await driver.transaction(fn)
      this.stats.totalQueries++
      return result
    } finally {
      await this.release(driver)
    }
  }

  private async performHealthCheck(): Promise<void> {
    const toRemove: number[] = []

    for (let i = 0; i < this.connections.length; i++) {
      const conn = this.connections[i]
      try {
        await conn.driver.query(this.config.healthCheckQuery)
        conn.isHealthy = true
      } catch {
        conn.isHealthy = false
        toRemove.push(i)
      }
    }

    // Remove unhealthy connections (reverse order to maintain indices)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const index = toRemove[i]
      const conn = this.connections[index]
      await conn.driver.close().catch(() => {})
      this.connections.splice(index, 1)
    }
  }

  async close(): Promise<void> {
    await this.ready
    this.closed = true

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }

    // Reject all waiting consumers
    for (const waiting of this.waitingQueue) {
      if (waiting.timeout) {
        clearTimeout(waiting.timeout)
      }
      waiting.reject(new Error('Pool is closed'))
    }
    this.waitingQueue = []

    // Close all connections
    await Promise.all(
      this.connections.map(conn => conn.driver.close().catch(() => {}))
    )
    this.connections = []
  }

  async isHealthy(): Promise<boolean> {
    try {
      const driver = await this.acquire()
      try {
        await driver.query(this.config.healthCheckQuery)
        return true
      } finally {
        await this.release(driver)
      }
    } catch {
      return false
    }
  }

  async ping(): Promise<{ latencyMs: number }> {
    const start = Date.now()
    const driver = await this.acquire()
    try {
      await driver.query(this.config.healthCheckQuery)
      return { latencyMs: Date.now() - start }
    } finally {
      await this.release(driver)
    }
  }

  getStats(): PoolStats {
    return {
      totalCount: this.connections.length + this.waitingQueue.length,
      idleCount: this.connections.length,
      activeCount: this.waitingQueue.length,
      waitingCount: this.waitingQueue.length,
      totalQueries: this.stats.totalQueries,
      totalErrors: this.stats.totalErrors,
      slowQueries: this.stats.slowQueries,
      avgQueryTimeMs: this.stats.totalQueries > 0
        ? this.stats.totalQueryTimeMs / this.stats.totalQueries
        : 0,
      maxQueryTimeMs: this.stats.maxQueryTimeMs,
      uptimeMs: Date.now() - this.stats.startTime,
    }
  }
}
