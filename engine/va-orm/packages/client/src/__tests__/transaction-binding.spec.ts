// VA-ORM Transaction Binding Spec
//
// Regresi: repository di dalam `va.transaction()` harus memakai driver
// transaksi yang sama. Kalau tidak, write keluar dari transaksi dan TIDAK
// ter-rollback saat callback melempar error.

import { describe, it, expect } from 'bun:test';
import { VaClient } from '../core/va.client.js';
import { ConnectionPool } from '../core/connection.pool.js';
import type { DatabaseDriver, QueryResult } from '../core/types.js';

/** Driver yang mencatat statement + bisa dipaksa gagal. */
class RecordingDriver implements DatabaseDriver {
  statements: string[] = [];
  failNext = false;

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    this.statements.push(sql);
    if (this.failNext) {
      throw new Error('forced failure');
    }
    return { rows: [], rowCount: 0 };
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    this.statements.push(sql);
    return { rowCount: 0 };
  }

  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {}

  getPlaceholder(index: number): string {
    return `$${index}`;
  }

  getDialect(): 'postgres' {
    return 'postgres';
  }
}

describe('transaction driver binding', () => {
  it('repository inside a transaction uses the transaction driver', async () => {
    const driver = new RecordingDriver();
    ConnectionPool.registerFactory('postgres', () => driver);

    const va = VaClient.create({
      driver: 'postgres',
      dsn: 'postgres://localhost:5432/test',
      models: { user: { tableName: 'users' } },
    });

    let txDriver: unknown;
    let repoDriver: unknown;

    await va.transaction(async (tx) => {
      txDriver = (tx as any).driver;
      repoDriver = (tx.repository('user') as any).driver;
    });

    // Driver repository harus persis driver transaksi.
    expect(repoDriver).toBe(txDriver);
    await va.disconnect();
  });

  it('statements inside a transaction go through the transaction driver', async () => {
    const driver = new RecordingDriver();
    ConnectionPool.registerFactory('postgres', () => driver);

    const va = VaClient.create({
      driver: 'postgres',
      dsn: 'postgres://localhost:5432/test',
      models: { user: { tableName: 'users' } },
    });

    await va.transaction(async (tx) => {
      await tx.repository('user').create({ email: 'a@x.dev' });
    });

    expect(driver.statements.some((s) => s.includes('INSERT INTO'))).toBe(true);
    await va.disconnect();
  });

  it('a failing transaction callback propagates the error', async () => {
    const driver = new RecordingDriver();
    ConnectionPool.registerFactory('postgres', () => driver);

    const va = VaClient.create({
      driver: 'postgres',
      dsn: 'postgres://localhost:5432/test',
      models: { user: { tableName: 'users' } },
    });

    await expect(
      va.transaction(async (tx) => {
        await tx.repository('user').create({ email: 'a@x.dev' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await va.disconnect();
  });
});
