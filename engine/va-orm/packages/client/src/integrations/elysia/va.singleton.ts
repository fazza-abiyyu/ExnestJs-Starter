// VA-ORM Elysia Singleton

import { VaClient, Repository } from '../../core/va.client.js'
import type { VaClientOptions } from '../../core/va.client.js'

export class VaSingleton {
  private static instance: VaSingleton
  private client: VaClient

  private constructor(options: VaClientOptions) {
    this.client = VaClient.create(options)
  }

  static getInstance(options?: VaClientOptions): VaSingleton {
    if (!VaSingleton.instance) {
      if (!options) {
        throw new Error('VaSingleton must be initialized with options on first use')
      }
      VaSingleton.instance = new VaSingleton(options)
    }
    return VaSingleton.instance
  }

  // ============ REPOSITORY ACCESS ============

  repository<T extends Record<string, any>>(name: string): Repository<T> {
    return this.client.repository<T>(name)
  }

  // ============ RAW QUERIES ============

  get raw() {
    return this.client.raw
  }

  get query() {
    return this.client.query
  }

  get queryOne() {
    return this.client.queryOne
  }

  get execute() {
    return this.client.execute
  }

  // ============ SQL TAGGED TEMPLATE ============

  sql<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    return this.client.sql<T>(strings, ...values)
  }

  sqlOne<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<T | null> {
    return this.client.sqlOne<T>(strings, ...values)
  }

  // ============ CTE ============

  cte() {
    return this.client.cte()
  }

  // ============ SUBQUERY ============

  subquery() {
    return this.client.subquery()
  }

  // ============ TRANSACTIONS ============

  async transaction<R>(fn: (client: VaClient) => Promise<R>): Promise<R> {
    return this.client.transaction(fn)
  }

  // ============ LIFECYCLE ============

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async disconnect(): Promise<void> {
    await this.client.disconnect()
  }

  // ============ CLIENT ACCESS ============

  getClient(): VaClient {
    return this.client
  }
}

// ============ HELPER FUNCTION ============

export function createVaSingleton(options: VaClientOptions): VaSingleton {
  return VaSingleton.getInstance(options)
}

// ============ PLUGINS ============

export function vaPlugin(options: VaClientOptions) {
  const singleton = VaSingleton.getInstance(options)

  return {
    name: 'va-orm',
    async start() {
      await singleton.connect()
    },
    async stop() {
      await singleton.disconnect()
    },
  }
}
