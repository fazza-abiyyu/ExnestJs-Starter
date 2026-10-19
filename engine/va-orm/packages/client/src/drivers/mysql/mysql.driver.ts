// VA-ORM MySQL Driver

import { createRequire } from 'module';
import type { DatabaseDriver, QueryResult } from '../../core/types.js';
import { VaError } from '../../core/errors.js';

const require = createRequire(import.meta.url);

interface MySqlPool {
  query(sql: string, values?: any[]): Promise<any>;
  getConnection(): Promise<MySqlConnection>;
  end(): Promise<void>;
}

interface MySqlConnection {
  query(sql: string, values?: any[]): Promise<any>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export type MysqlSslOption =
  boolean | { rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string };

/**
 * Resolve SSL for mysql2 from the driver option or the connection string.
 * The DSN is the usual carrier in env config (`DATABASE_URL=mysql://...?ssl=...`),
 * and previously those params were dropped because only the option was read.
 */
export function resolveMysqlSsl(
  connectionString: string,
  explicit?: MysqlSslOption,
): Record<string, unknown> | undefined {
  if (explicit !== undefined) {
    if (explicit === true) return {};
    if (explicit === false) return undefined;
    return explicit;
  }

  const url = new URL(connectionString);
  const raw = url.searchParams.get('ssl');
  if (raw !== null && raw !== '') {
    if (raw === 'true' || raw === '1') return {};
    if (raw === 'false' || raw === '0') return undefined;
    if (raw.trimStart().startsWith('{')) {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch (error) {
        throw VaError.wrap(error, 'invalid ssl query parameter (expected JSON)', 'INVALID_SSL');
      }
    }
  }

  // Both libpq (`sslmode=require`) and MySQL (`ssl-mode=REQUIRED`) spellings.
  const mode = (
    url.searchParams.get('sslmode') ??
    url.searchParams.get('ssl-mode') ??
    url.searchParams.get('ssl_mode')
  )?.toLowerCase();
  switch (mode) {
    case 'disable':
    case 'disabled':
    case 'prefer':
    case 'preferred':
      return undefined;
    case 'require':
    case 'required':
      return { rejectUnauthorized: false };
    case 'verify-ca':
    case 'verify_ca':
    case 'verify-full':
    case 'verify_identity':
      return { rejectUnauthorized: true };
    default:
      return undefined;
  }
}

export class MysqlDriver implements DatabaseDriver {
  private pool: MySqlPool;

  constructor(
    private connectionString: string,
    private options: {
      max?: number;
      min?: number;
      idleTimeoutMs?: number;
      connectionTimeoutMs?: number;
      ssl?: MysqlSslOption;
    } = {},
  ) {
    this.pool = this.createPool();
  }

  private createPool(): MySqlPool {
    const mysql = require('mysql2/promise');
    const url = new URL(this.connectionString);
    const ssl = resolveMysqlSsl(this.connectionString, this.options.ssl);
    return mysql.createPool({
      host: url.hostname,
      port: parseInt(url.port || '3306'),
      user: url.username,
      password: url.password,
      database: url.pathname.slice(1),
      // mysql2 names the pool limit `connectionLimit`; `max` triggers a
      // "Ignoring invalid configuration option" warning and is dropped.
      connectionLimit: this.options.max ?? 20,
      idleTimeout: this.options.idleTimeoutMs ?? 10000,
      connectTimeout: this.options.connectionTimeoutMs ?? 5000,
      ...(ssl ? { ssl } : {}),
    });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    try {
      const [rows] = await this.pool.query(sql, params);
      return {
        rows: (Array.isArray(rows) ? rows : []) as T[],
        rowCount: Array.isArray(rows) ? rows.length : 0,
      };
    } catch (error) {
      throw VaError.wrap(error, 'mysql query');
    }
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    try {
      const [result] = await this.pool.query(sql, params);
      return { rowCount: (result as any).affectedRows ?? 0 };
    } catch (error) {
      throw VaError.wrap(error, 'mysql execute');
    }
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    let txDepth = 0;
    const txDriver: DatabaseDriver = {
      query: async <R = any>(sql: string, params?: any[]) => {
        const [rows] = await connection.query(sql, params);
        return {
          rows: (Array.isArray(rows) ? rows : []) as R[],
          rowCount: Array.isArray(rows) ? rows.length : 0,
        };
      },
      execute: async (sql: string, params?: any[]) => {
        const [result] = await connection.query(sql, params);
        return { rowCount: (result as any).affectedRows ?? 0 };
      },
      transaction: async <R>(nested: (driver: DatabaseDriver) => Promise<R>) => {
        const depth = txDepth;
        const savepoint = depth === 0 ? null : `va_sp_${depth}`;
        txDepth = depth + 1;
        try {
          if (savepoint) await connection.query(`SAVEPOINT ${savepoint}`);
          const result = await nested(txDriver);
          if (savepoint) await connection.query(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (error) {
          try {
            if (savepoint) await connection.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          } catch {
            // ignore
          }
          throw VaError.wrap(error, 'mysql nested transaction');
        } finally {
          txDepth = depth;
        }
      },
      close: async () => {},
      getPlaceholder: (_index: number) => '?',
      getDialect: () => 'mysql' as const,
    };
    try {
      await connection.beginTransaction();
      const result = await fn(txDriver);
      await connection.commit();
      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // ignore
      }
      throw VaError.wrap(error, 'mysql transaction');
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getDialect(): 'mysql' {
    return 'mysql';
  }

  getPlaceholder(_index: number): string {
    return '?';
  }
}
