// VA-ORM Connection Pool Spec

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConnectionPool } from '../core/connection.pool.js';

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  afterEach(async () => {
    if (pool) {
      await pool.close();
    }
  });

  describe('configuration', () => {
    it('should create pool with default config', () => {
      pool = new ConnectionPool('sqlite', ':memory:');
      const stats = pool.getStats();
      expect(stats.totalCount).toBeGreaterThanOrEqual(0);
    });

    it('should create pool with custom config', () => {
      pool = new ConnectionPool('sqlite', ':memory:', {
        max: 10,
        min: 2,
        idleTimeoutMs: 5000,
        connectionTimeoutMs: 3000,
      });
      const stats = pool.getStats();
      expect(stats.totalCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('acquire and release', () => {
    it('should acquire and release connection', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const driver = await pool.acquire();
      expect(driver).toBeDefined();
      await pool.release(driver);
    });

    it('should reuse released connections', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const driver1 = await pool.acquire();
      await pool.release(driver1);
      const driver2 = await pool.acquire();
      expect(driver2).toBe(driver1);
    });
  });

  describe('query', () => {
    it('should execute query through pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const result = await pool.query('SELECT 1 as value');
      expect(result.rows).toBeDefined();
      expect(result.rowCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('execute', () => {
    it('should execute statement through pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const result = await pool.execute('CREATE TABLE IF NOT EXISTS test (id INTEGER)');
      expect(result).toBeDefined();
    });
  });

  describe('transaction', () => {
    it('should execute transaction through pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const result = await pool.transaction(async (driver) => {
        return { success: true };
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('stats', () => {
    it('should return pool stats', () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const stats = pool.getStats();
      expect(stats).toHaveProperty('totalCount');
      expect(stats).toHaveProperty('idleCount');
      expect(stats).toHaveProperty('activeCount');
      expect(stats).toHaveProperty('waitingCount');
      expect(stats).toHaveProperty('totalQueries');
      expect(stats).toHaveProperty('totalErrors');
      expect(stats).toHaveProperty('slowQueries');
      expect(stats).toHaveProperty('avgQueryTimeMs');
      expect(stats).toHaveProperty('maxQueryTimeMs');
      expect(stats).toHaveProperty('uptimeMs');
    });
  });

  describe('health', () => {
    it('should report healthy with working driver', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      await expect(pool.isHealthy()).resolves.toBe(true);
    });

    it('should report unhealthy after close', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      await pool.close();
      await expect(pool.isHealthy()).resolves.toBe(false);
    });

    it('should ping with latency', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      const { latencyMs } = await pool.ping();
      expect(latencyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('slow queries', () => {
    it('should count slow queries and call handler', async () => {
      const slow: any[] = [];
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 1,
        slowQueryThresholdMs: 0,
        onSlowQuery: (info) => slow.push(info),
      });
      await pool.query('SELECT 1');
      const stats = pool.getStats();
      expect(stats.slowQueries).toBe(1);
      expect(slow).toHaveLength(1);
      expect(slow[0].sql).toBe('SELECT 1');
      expect(slow[0].elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('should not count fast queries', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 1,
        slowQueryThresholdMs: 60000,
      });
      await pool.query('SELECT 1');
      expect(pool.getStats().slowQueries).toBe(0);
    });
  });

  describe('close', () => {
    it('should close pool', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      await pool.close();
      const stats = pool.getStats();
      expect(stats.totalCount).toBe(0);
    });

    it('should reject queries after close', async () => {
      pool = new ConnectionPool('sqlite', ':memory:', { min: 1 });
      await pool.close();
      try {
        await pool.query('SELECT 1');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain('closed');
      }
    });
  });

  describe('security: capacity & retry (HIGH)', () => {
    it('does not exceed max under concurrent acquire', async () => {
      let created = 0;
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 0,
        max: 2,
        healthCheck: false,
        connectionTimeoutMs: 50,
        driverFactory: () => {
          created++;
          const { SqliteDriver } = require('../drivers/sqlite/sqlite.driver.js');
          return new SqliteDriver(':memory:');
        },
      });
      await (pool as any).ready;
      const drivers = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire().catch(() => null),
      ]);
      const held = drivers.filter(Boolean);
      expect(held.length).toBeLessThanOrEqual(2);
      expect(created).toBeLessThanOrEqual(2);
      for (const d of held) {
        await pool.release(d as any);
      }
    });

    it('does not auto-retry INSERT/UPDATE (default retryMode=reads)', async () => {
      let calls = 0;
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 1,
        retryAttempts: 3,
        retryDelayMs: 1,
        healthCheck: false,
        driverFactory: () => {
          const { SqliteDriver } = require('../drivers/sqlite/sqlite.driver.js');
          const driver = new SqliteDriver(':memory:');
          const orig = driver.execute.bind(driver);
          driver.execute = async (sql: string, params?: any[]) => {
            calls++;
            if (/^insert/i.test(sql.trim())) throw new Error('simulated write failure');
            return orig(sql, params);
          };
          return driver;
        },
      });
      await expect(pool.execute('INSERT INTO t VALUES (1)')).rejects.toThrow(
        'simulated write failure',
      );
      expect(calls).toBe(1);
    });

    it('may retry SELECT under retryMode=reads', async () => {
      let calls = 0;
      pool = new ConnectionPool('sqlite', ':memory:', {
        min: 1,
        retryAttempts: 2,
        retryDelayMs: 1,
        healthCheck: false,
        driverFactory: () => {
          const { SqliteDriver } = require('../drivers/sqlite/sqlite.driver.js');
          const driver = new SqliteDriver(':memory:');
          const orig = driver.query.bind(driver);
          driver.query = async (sql: string, params?: any[]) => {
            calls++;
            if (calls < 2) throw new Error('transient');
            return orig(sql, params);
          };
          return driver;
        },
      });
      const result = await pool.query('SELECT 1 as v');
      expect(result.rows).toBeDefined();
      expect(calls).toBe(2);
    });
  });
});
