// Live SQLite integration test — real file database, no mock driver.
import { describe, it, expect, afterAll } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SqliteDriver } from '../../drivers/sqlite/sqlite.driver.js';
import { ConnectionPool } from '../../core/connection.pool.js';

const dir = await mkdtemp(join(tmpdir(), 'va-live-'));
const DB = join(dir, 'live.db');

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('live sqlite', () => {
  it('driver: data tersimpan dan terbaca ulang dari file', async () => {
    const driver = new SqliteDriver(DB);
    try {
      await driver.execute(
        'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)',
      );
      const inserted = await driver.execute('INSERT INTO users (name) VALUES (?)', ['Alice']);
      expect(inserted.rowCount).toBe(1);

      const rows = await driver.query<{ id: number; name: string }>(
        'SELECT id, name FROM users ORDER BY id',
      );
      expect(rows.rows).toEqual([{ id: 1, name: 'Alice' }]);
    } finally {
      await driver.close();
    }

    // Reopen: proves the data hit the real file, not memory.
    const reopened = new SqliteDriver(DB);
    try {
      const rows = await reopened.query<{ name: string }>('SELECT name FROM users');
      expect(rows.rows).toEqual([{ name: 'Alice' }]);
    } finally {
      await reopened.close();
    }
  });

  it('driver: transaction rollback', async () => {
    const driver = new SqliteDriver(DB);
    try {
      await expect(
        driver.transaction(async (tx) => {
          await tx.execute('INSERT INTO users (name) VALUES (?)', ['Rollback']);
          throw new Error('force rollback');
        }),
      ).rejects.toThrow(/force rollback/);

      const rows = await driver.query('SELECT 1 FROM users WHERE name = ?', ['Rollback']);
      expect(rows.rows).toHaveLength(0);
    } finally {
      await driver.close();
    }
  });

  it('pool: driverFactory memakai SqliteDriver yang diekspor', async () => {
    const pool = new ConnectionPool('sqlite', DB, {
      min: 0,
      max: 2,
      driverFactory: (dsn) => new SqliteDriver(dsn),
    });

    try {
      const count = await pool.query<{ count: number }>('SELECT count(*) AS count FROM users');
      expect(count.rows[0].count).toBe(1);
      expect(pool.getStats().totalQueries).toBeGreaterThan(0);
    } finally {
      await pool.close();
    }
  });
});
