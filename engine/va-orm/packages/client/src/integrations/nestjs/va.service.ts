// VA-ORM NestJS Service

import { VaClient, Repository } from '../../core/va.client.js'
import type { VaClientOptions } from '../../core/va.client.js'

let Injectable: ClassDecorator
let OnModuleInit: ClassDecorator
let OnModuleDestroy: ClassDecorator
try {
  const nestCommon = require('@nestjs/common')
  Injectable = nestCommon.Injectable
  OnModuleInit = nestCommon.OnModuleInit
  OnModuleDestroy = nestCommon.OnModuleDestroy
} catch {
  Injectable = () => (target: any) => target
  OnModuleInit = () => (target: any) => target
  OnModuleDestroy = () => (target: any) => target
}

@Injectable()
export class VaService implements OnModuleInit, OnModuleDestroy {
  private client: VaClient

  constructor(private options: VaClientOptions) {
    this.client = VaClient.create(options)
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.disconnect()
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

  // ============ CLIENT ACCESS ============

  getClient(): VaClient {
    return this.client
  }
}
