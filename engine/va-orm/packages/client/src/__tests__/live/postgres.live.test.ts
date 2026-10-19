// Live PostgreSQL integration test — real database, no mock driver, no skip.
//
// Setup (once):
//   createdb va_orm_live_test
// Run:
//   bun run test:live
// Override the target:
//   VA_TEST_PG_URL=postgres://user:pass@localhost:5432/va_orm_live_test bun run test:live
// Hosted TLS databases (Neon, RDS, ...):
//   VA_TEST_PG_URL='postgres://...?sslmode=require' VA_TEST_PG_SSL_MODE=require bun run test:live
//
// The suite fails loudly when the database is unreachable — a skipped live test
// hides regressions (ssl options dropped from the DSN, pool wiring, etc.).
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { PostgresDriver } from '../../drivers/postgres/postgres.driver.js';
import { ConnectionPool } from '../../core/connection.pool.js';
import { VaClient } from '../../core/va.client.js';

const PG_URL = process.env.VA_TEST_PG_URL ?? 'postgres://localhost:5432/va_orm_live_test';
// Local Postgres usually has ssl=off; hosted providers (Neon, etc.) require TLS.
const PG_SSL_MODE = process.env.VA_TEST_PG_SSL_MODE ?? 'disable';
const TABLE = `va_live_users_${process.pid}`;

type LiveUser = {
  id: number;
  name: string;
  email: string;
  balance: number;
  created_at: Date;
};

describe('live postgres', () => {
  let driver: PostgresDriver;

  beforeAll(async () => {
    driver = new PostgresDriver(PG_URL, { max: 2, min: 0, connectionTimeoutMs: 5000 });
    await driver.execute(`DROP TABLE IF EXISTS ${TABLE}`);
    await driver.execute(`
      CREATE TABLE ${TABLE} (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text NOT NULL UNIQUE,
        balance integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  });

  afterAll(async () => {
    await driver.execute(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
    await driver.close();
  });

  it('driver: DDL, insert, select, update', async () => {
    const inserted = await driver.query<LiveUser>(
      `INSERT INTO ${TABLE} (name, email, balance) VALUES ($1, $2, $3) RETURNING id, name, email, balance`,
      ['Alice', 'alice@live.test', 50],
    );
    expect(inserted.rowCount).toBe(1);
    expect(inserted.rows[0].name).toBe('Alice');
    expect(inserted.rows[0].balance).toBe(50);

    const updated = await driver.execute(`UPDATE ${TABLE} SET balance = $1 WHERE email = $2`, [
      75,
      'alice@live.test',
    ]);
    expect(updated.rowCount).toBe(1);

    const found = await driver.query<{ name: string; balance: number }>(
      `SELECT name, balance FROM ${TABLE} WHERE email = $1`,
      ['alice@live.test'],
    );
    expect(found.rows).toEqual([{ name: 'Alice', balance: 75 }]);
  });

  it('driver: transaction commits dan rollback', async () => {
    const committed = await driver.transaction(async (tx) => {
      const result = await tx.query<{ id: number }>(
        `INSERT INTO ${TABLE} (name, email, balance) VALUES ($1, $2, $3) RETURNING id`,
        ['Commit', 'commit@live.test', 1],
      );
      return result.rows[0].id;
    });
    expect(committed).toBeGreaterThan(0);

    await expect(
      driver.transaction(async (tx) => {
        await tx.execute(`INSERT INTO ${TABLE} (name, email, balance) VALUES ($1, $2, $3)`, [
          'Rollback',
          'rollback@live.test',
          2,
        ]);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow(/force rollback/);

    const rows = await driver.query(`SELECT 1 FROM ${TABLE} WHERE email = $1`, [
      'rollback@live.test',
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('pool: driverFactory memakai PostgresDriver yang diekspor', async () => {
    const pool = new ConnectionPool('postgres', PG_URL, {
      min: 0,
      max: 3,
      driverFactory: (dsn) => new PostgresDriver(dsn, { max: 1, min: 0 }),
    });

    try {
      const ping = await pool.ping();
      expect(ping.latencyMs).toBeGreaterThanOrEqual(0);

      await pool.execute(`INSERT INTO ${TABLE} (name, email, balance) VALUES ($1, $2, $3)`, [
        'Pool',
        'pool@live.test',
        5,
      ]);

      const count = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${TABLE} WHERE email = $1`,
        ['pool@live.test'],
      );
      expect(count.rows[0].count).toBe(1);

      const stats = pool.getStats();
      expect(stats.totalQueries).toBeGreaterThan(0);
      expect(stats.idleCount + stats.activeCount).toBeGreaterThan(0);
    } finally {
      await pool.close();
    }
  });

  it('pool: sslmode dari DSN tetap terbawa', async () => {
    const dsn = new URL(PG_URL);
    dsn.searchParams.set('sslmode', PG_SSL_MODE);
    const pool = new ConnectionPool('postgres', dsn.toString(), {
      min: 0,
      max: 1,
      driverFactory: (dsn, options) => new PostgresDriver(dsn, options),
    });

    try {
      const ping = await pool.ping();
      expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await pool.close();
    }
  });

  it('VaClient: repository CRUD lewat pool live', async () => {
    const client = VaClient.create({
      driver: 'postgres',
      dsn: PG_URL,
      models: { LiveUser: { tableName: TABLE } },
      connection: {
        min: 0,
        max: 2,
        driverFactory: (dsn) => new PostgresDriver(dsn, { max: 1, min: 0 }),
      },
    });

    try {
      await client.connect();
      const users = client.repository<LiveUser>('LiveUser');

      const created = await users.create({
        name: 'Buffy',
        email: 'buffy@live.test',
        balance: 10,
      });
      expect(created.id).toBeGreaterThan(0);

      const found = await users.findFirst({ email: 'buffy@live.test' });
      expect(found?.name).toBe('Buffy');

      const updated = await users.update({ id: created.id }, { balance: 99 });
      expect(updated.balance).toBe(99);

      await users.delete({ id: created.id });
      expect(await users.findFirst({ id: created.id })).toBeNull();
    } finally {
      await client.disconnect();
    }
  });
});
