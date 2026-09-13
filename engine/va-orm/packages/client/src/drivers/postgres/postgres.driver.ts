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
      ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string };
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
    return new Pool({
      connectionString: this.connectionString,
      max: this.options.max ?? 20,
      min: this.options.min ?? 2,
      idleTimeoutMillis: this.options.idleTimeoutMs ?? 10000,
      connectionTimeoutMillis: this.options.connectionTimeoutMs ?? 5000,
      ssl: this.options.ssl || false,
      application_name: this.appName,
      // PgBouncer compatibility: disable prepared statements
      ...(this.pgbouncerMode ? { prepareThreshold: 0 } : {}),
    });
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
