import type { PrismaClient } from '@prisma/client';
import { config as appConfig } from '../../infrastructure/config/index.js';
import type {
  HealthStatus,
  ResponseMeta,
  HealthResponse,
  HealthCheckOptions,
} from './health.interface.js';

export class HealthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: typeof appConfig,
  ) {}

  private generateMeta(correlationId?: string): ResponseMeta {
    return {
      correlation_id: correlationId ?? null,
      request_id: Math.random().toString(36).substring(2, 15),
      idempotency_replayed: false,
      served_at: new Date().toISOString(),
    };
  }

  live(options?: HealthCheckOptions): HealthResponse {
    const status: HealthStatus = {
      status: 'ok',
      service: this.config.appName,
      version: process.env.npm_package_version ?? '0.0.1',
      checks: {},
      observed_at: new Date().toISOString(),
    };

    return {
      data: status,
      meta: this.generateMeta(options?.correlationId),
    };
  }

  async ready(options?: HealthCheckOptions): Promise<HealthResponse> {
    const checks: Record<string, unknown> = {};
    let status: 'ok' | 'degraded' | 'unavailable' = 'ok';

    let dbStatus = 'ok';
    let dbMessage: string | undefined;

    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch (error) {
      dbStatus = 'unavailable';
      dbMessage = error instanceof Error ? error.message : String(error);
      status = 'unavailable';
    }

    checks.database = {
      status: dbStatus,
      ...(dbMessage ? { message: dbMessage } : {}),
    };

    const healthStatus: HealthStatus = {
      status,
      service: this.config.appName,
      version: process.env.npm_package_version ?? '0.0.1',
      checks,
      observed_at: new Date().toISOString(),
    };

    return {
      data: healthStatus,
      meta: this.generateMeta(options?.correlationId),
    };
  }
}
