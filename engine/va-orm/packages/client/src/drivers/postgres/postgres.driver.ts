// VA-ORM PostgreSQL Driver

import { createRequire } from 'module';
import type { DatabaseDriver, QueryResult } from '../../core/types.js';
import { VaError } from '../../core/errors.js';

const require = createRequire(import.meta.url);

interface PgPool {
  query(sql: string, values?: any[]): Promise<any>;
  connect(): Promise<any>;
  end(): Promise<void>;
}

/**
 * pg 8.23 warns that `sslmode=require|prefer|verify-ca` are aliases of
 * `verify-full`. Rewrite those modes so pg does not emit the deprecation
 * warning — the effective behavior is unchanged because pg already treats
 * them as verify-full. `uselibpqcompat=true` opts into libpq semantics
 * explicitly, so it is left untouched.
 *
 * String-level replacement keeps every other byte of the DSN (password
 * encoding, params, channel_binding, ...) exactly as provided.
 */
export function normalizeSslMode(connectionString: string): string {
  if (/[?&]uselibpqcompat=true(?:&|#|$)/i.test(connectionString)) {
    return connectionString;
  }
  return connectionString.replace(
    /([?&]sslmode=)([^&#]*)/i,
    (match, prefix: string, value: string) => {
      let mode = value;
      try {
        mode = decodeURIComponent(value);
      } catch {
        return match;
      }
      const normalized = mode.toLowerCase();
      if (normalized === 'require' || normalized === 'prefer' || normalized === 'verify-ca') {
        return `${prefix}verify-full`;
      }
      return match;
    },
  );
}

export class PostgresDriver implements DatabaseDriver {
  private pool: PgPool;
  private appName: string;
  private pgbouncerMode: boolean;

  constructor(
    private connectionString: string,
    private options: {
      max?: number;
      min?: number;
      idleTimeoutMs?: number;
      connectionTimeoutMs?: number;
      ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string };
      applicationName?: string;
      disablePreparedStatements?: boolean;
    } = {},
  ) {
    this.appName = options.applicationName || 'va-orm';
    this.pgbouncerMode = this.detectPgBouncer() || options.disablePreparedStatements === true;
    this.pool = this.createPool();
  }

  private detectPgBouncer(): boolean {
    return (
      this.connectionString.includes('pgbouncer') ||
      this.connectionString.includes('supavisor') ||
      this.connectionString.includes('transaction_mode=true')
    );
  }

  private createPool(): PgPool {
    // Uses native `pg` Pool when available
    const { Pool } = require('pg');
    const config: Record<string, unknown> = {
      connectionString: normalizeSslMode(this.connectionString),
      max: this.options.max ?? 20,
      min: this.options.min ?? 2,
      idleTimeoutMillis: this.options.idleTimeoutMs ?? 10000,
      connectionTimeoutMillis: this.options.connectionTimeoutMs ?? 5000,
      application_name: this.appName,
      // PgBouncer compatibility: disable prepared statements
      ...(this.pgbouncerMode ? { prepareThreshold: 0 } : {}),
    };

    // Only set `ssl` when explicitly configured. Forcing `ssl: false` shadows
    // `sslmode` in the DSN and the PGSSLMODE environment variable inside pg.
    if (this.options.ssl !== undefined) {
      config.ssl = this.options.ssl;
    }

    const pool = new Pool(config);

    // Wajib: error event tanpa listener → crash proses (unhandled 'error').
    // Koneksi idle yang dibanting server (mis. Aiven max_connections /
    // maintenance) masuk sini — cukup warning, pool menandai client
    // terlepas dan koneksi berikutnya dibuat baru otomatis.
    (pool as PgPool & { on: (event: 'error', fn: (err: Error, client: unknown) => void) => void }).on(
      'error',
      (err) => {
        console.warn(`[va-orm] postgres pool error (idle client disconnected): ${String(err)}`);
      },
    );

    return pool;
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    try {
      const result = await this.pool.query(sql, params);
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount ?? 0,
      };
    } catch (error) {
      throw VaError.wrap(error, 'postgres query');
    }
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    try {
      const result = await this.pool.query(sql, params);
      return { rowCount: result.rowCount ?? 0 };
    } catch (error) {
      throw VaError.wrap(error, 'postgres execute');
    }
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let txDepth = 0;
    const txDriver: DatabaseDriver = {
      query: async <R = any>(sql: string, params?: any[]) => {
        const result = await client.query(sql, params);
        return { rows: result.rows as R[], rowCount: result.rowCount ?? 0 };
      },
      execute: async (sql: string, params?: any[]) => {
        const result = await client.query(sql, params);
        return { rowCount: result.rowCount ?? 0 };
      },
      transaction: async <R>(nested: (driver: DatabaseDriver) => Promise<R>) => {
        const depth = txDepth;
        const savepoint = depth === 0 ? null : `va_sp_${depth}`;
        txDepth = depth + 1;
        try {
          if (savepoint) await client.query(`SAVEPOINT ${savepoint}`);
          else await client.query('BEGIN');
          const result = await nested(txDriver);
          if (savepoint) await client.query(`RELEASE SAVEPOINT ${savepoint}`);
          else await client.query('COMMIT');
          return result;
        } catch (error) {
          try {
            if (savepoint) await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            else await client.query('ROLLBACK');
          } catch {
            // ignore
          }
          throw VaError.wrap(error, 'postgres transaction');
        } finally {
          txDepth = depth;
        }
      },
      close: async () => {},
      getPlaceholder: (index: number) => this.getPlaceholder(index),
      getDialect: () => 'postgres' as const,
    };
    try {
      await client.query('BEGIN');
      const result = await fn(txDriver);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw VaError.wrap(error, 'postgres transaction');
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getDialect(): 'postgres' {
    return 'postgres';
  }

  getPlaceholder(index: number): string {
    return `$${index}`;
  }
}
