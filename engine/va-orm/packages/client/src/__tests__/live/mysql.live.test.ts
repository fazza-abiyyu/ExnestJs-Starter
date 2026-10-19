// Live MySQL/MariaDB integration test — real database, no mock driver, no skip.
//
// Setup (MySQL):
//   mysql -u root -e "CREATE DATABASE IF NOT EXISTS va_orm_live_test"
// Run:
//   bun run test:live
// MariaDB on another port:
//   VA_TEST_MYSQL_URL=mysql://root@127.0.0.1:3307/va_orm_live_test bun run test:live
//
// The suite fails loudly when the server is unreachable — skipping live tests
// hides regressions such as ssl/sslmode params being dropped from the DSN.
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { MysqlDriver } from '../../drivers/mysql/mysql.driver.js';
import { ConnectionPool } from '../../core/connection.pool.js';

const MYSQL_URL = process.env.VA_TEST_MYSQL_URL ?? 'mysql://root@127.0.0.1:3306/va_orm_live_test';
const TABLE = `va_live_users_${process.pid}`;

describe('live mysql', () => {
  let driver: MysqlDriver;

  beforeAll(async () => {
    driver = new MysqlDriver(MYSQL_URL, { max: 2, min: 0 });
    await driver.execute(`DROP TABLE IF EXISTS ${TABLE}`);
    await driver.execute(`
      CREATE TABLE ${TABLE} (
        id int AUTO_INCREMENT PRIMARY KEY,
        name varchar(100) NOT NULL,
        email varchar(190) NOT NULL UNIQUE,
        balance int NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterAll(async () => {
    await driver.execute(`DROP TABLE IF EXISTS ${TABLE}`).catch(() => {});
    await driver.close();
  });

  it('driver: DDL, insert, select, update', async () => {
    const inserted = await driver.execute(
      `INSERT INTO ${TABLE} (name, email, balance) VALUES (?, ?, ?)`,
      ['Alice', 'alice@live.test', 50],
    );
    expect(inserted.rowCount).toBe(1);

    const updated = await driver.execute(`UPDATE ${TABLE} SET balance = ? WHERE email = ?`, [
      75,
      'alice@live.test',
    ]);
    expect(updated.rowCount).toBe(1);

    const found = await driver.query<{ name: string; balance: number }>(
      `SELECT name, balance FROM ${TABLE} WHERE email = ?`,
      ['alice@live.test'],
    );
    expect(found.rows).toEqual([{ name: 'Alice', balance: 75 }]);
  });

  it('driver: transaction commits dan rollback', async () => {
    await driver.transaction(async (tx) => {
      await tx.execute(`INSERT INTO ${TABLE} (name, email, balance) VALUES (?, ?, ?)`, [
        'Commit',
        'commit@live.test',
        1,
      ]);
    });

    await expect(
      driver.transaction(async (tx) => {
        await tx.execute(`INSERT INTO ${TABLE} (name, email, balance) VALUES (?, ?, ?)`, [
          'Rollback',
          'rollback@live.test',
          2,
        ]);
        throw new Error('force rollback');
      }),
    ).rejects.toThrow(/force rollback/);

    const rows = await driver.query(`SELECT 1 FROM ${TABLE} WHERE email = ?`, [
      'rollback@live.test',
    ]);
    expect(rows.rows).toHaveLength(0);
  });

  it('pool: driverFactory memakai MysqlDriver yang diekspor', async () => {
    const pool = new ConnectionPool('mysql', MYSQL_URL, {
      min: 0,
      max: 2,
      driverFactory: (dsn, options) => new MysqlDriver(dsn, options),
    });

    try {
      const ping = await pool.ping();
      expect(ping.latencyMs).toBeGreaterThanOrEqual(0);

      const count = await pool.query<{ count: number }>(
        `SELECT count(*) AS count FROM ${TABLE} WHERE email = ?`,
        ['commit@live.test'],
      );
      expect(Number(count.rows[0].count)).toBe(1);
      expect(pool.getStats().totalQueries).toBeGreaterThan(0);
    } finally {
      await pool.close();
    }
  });

  it('pool: ssl-mode dari DSN tetap terbawa', async () => {
    const separator = MYSQL_URL.includes('?') ? '&' : '?';
    const pool = new ConnectionPool('mysql', `${MYSQL_URL}${separator}ssl-mode=DISABLED`, {
      min: 0,
      max: 1,
      driverFactory: (dsn, options) => new MysqlDriver(dsn, options),
    });

    try {
      const ping = await pool.ping();
      expect(ping.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await pool.close();
    }
  });
});
