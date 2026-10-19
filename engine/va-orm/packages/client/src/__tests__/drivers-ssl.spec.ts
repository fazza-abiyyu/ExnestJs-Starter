// SSL propagation regressions: DSN params, PGSSLMODE env, and driverFactory options.
import { describe, it, expect, afterEach } from 'bun:test';
import { Client } from 'pg';
import { PostgresDriver, normalizeSslMode } from '../drivers/postgres/postgres.driver.js';
import { MysqlDriver, resolveMysqlSsl } from '../drivers/mysql/mysql.driver.js';
import { ConnectionPool } from '../core/connection.pool.js';
import { MockDriver } from '../../../../test-setup.js';

const PG_DSN = 'postgres://user:pass@localhost:5432/db';

/** Raw options handed to the `pg` Pool — what pg actually uses to connect. */
function pgOptions(driver: PostgresDriver): Record<string, any> {
  return (driver as any).pool.options;
}

/** Parsed pg connection parameters — `ssl` is what decides TLS at connect time. */
function pgSsl(config: Record<string, any>): unknown {
  return (new Client(config) as any).connectionParameters.ssl;
}

describe('postgres ssl propagation', () => {
  const originalSslMode = process.env.PGSSLMODE;

  afterEach(() => {
    if (originalSslMode === undefined) delete process.env.PGSSLMODE;
    else process.env.PGSSLMODE = originalSslMode;
  });

  it('does not force ssl:false when no ssl option is given', async () => {
    const driver = new PostgresDriver(PG_DSN);
    try {
      expect('ssl' in pgOptions(driver)).toBe(false);
    } finally {
      await driver.close();
    }
  });

  it('lets pg read PGSSLMODE from the environment', async () => {
    process.env.PGSSLMODE = 'require';
    const driver = new PostgresDriver(PG_DSN);
    try {
      expect(pgSsl(pgOptions(driver))).toBeTruthy();
    } finally {
      await driver.close();
    }
  });

  it('honors sslmode in the DSN', async () => {
    const driver = new PostgresDriver(`${PG_DSN}?sslmode=verify-full`);
    try {
      expect(pgSsl(pgOptions(driver))).toBeTruthy();
    } finally {
      await driver.close();
    }
  });

  it('honors sslmode=disable in the DSN', async () => {
    const driver = new PostgresDriver(`${PG_DSN}?sslmode=disable`);
    try {
      expect(pgSsl(pgOptions(driver))).toBe(false);
    } finally {
      await driver.close();
    }
  });

  it('forwards an explicit ssl option', async () => {
    const driver = new PostgresDriver(PG_DSN, { ssl: { rejectUnauthorized: false } });
    try {
      expect(pgOptions(driver).ssl).toEqual({ rejectUnauthorized: false });
    } finally {
      await driver.close();
    }
  });
});

describe('postgres sslmode normalization', () => {
  it('rewrites require/prefer/verify-ca to verify-full', () => {
    expect(normalizeSslMode(`${PG_DSN}?sslmode=require`)).toBe(`${PG_DSN}?sslmode=verify-full`);
    expect(normalizeSslMode(`${PG_DSN}?sslmode=prefer`)).toBe(`${PG_DSN}?sslmode=verify-full`);
    expect(normalizeSslMode(`${PG_DSN}?sslmode=verify-ca`)).toBe(`${PG_DSN}?sslmode=verify-full`);
  });

  it('keeps explicit modes untouched', () => {
    expect(normalizeSslMode(`${PG_DSN}?sslmode=disable`)).toBe(`${PG_DSN}?sslmode=disable`);
    expect(normalizeSslMode(`${PG_DSN}?sslmode=verify-full`)).toBe(`${PG_DSN}?sslmode=verify-full`);
  });

  it('respects uselibpqcompat=true', () => {
    expect(normalizeSslMode(`${PG_DSN}?sslmode=require&uselibpqcompat=true`)).toBe(
      `${PG_DSN}?sslmode=require&uselibpqcompat=true`,
    );
  });

  it('preserves credentials, params, and channel_binding', () => {
    const dsn = `${PG_DSN}?sslmode=require&channel_binding=require&application_name=va`;
    expect(normalizeSslMode(dsn)).toBe(
      `${PG_DSN}?sslmode=verify-full&channel_binding=require&application_name=va`,
    );
  });

  it('leaves non-URL strings untouched', () => {
    expect(normalizeSslMode('host=localhost dbname=db sslmode=require')).toBe(
      'host=localhost dbname=db sslmode=require',
    );
  });
});

describe('mysql ssl propagation from DSN', () => {
  const DSN = 'mysql://user:pass@localhost:3306/db';

  it('parses ssl=true', () => {
    expect(resolveMysqlSsl(`${DSN}?ssl=true`)).toEqual({});
  });

  it('parses ssl=false', () => {
    expect(resolveMysqlSsl(`${DSN}?ssl=false`)).toBeUndefined();
  });

  it('parses ssl as JSON', () => {
    const value = encodeURIComponent('{"rejectUnauthorized":false,"ca":"ca.pem"}');
    expect(resolveMysqlSsl(`${DSN}?ssl=${value}`)).toEqual({
      rejectUnauthorized: false,
      ca: 'ca.pem',
    });
  });

  it('maps libpq sslmode=require', () => {
    expect(resolveMysqlSsl(`${DSN}?sslmode=require`)).toEqual({ rejectUnauthorized: false });
  });

  it('maps MySQL ssl-mode=VERIFY_IDENTITY', () => {
    expect(resolveMysqlSsl(`${DSN}?ssl-mode=VERIFY_IDENTITY`)).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('maps ssl-mode=DISABLED', () => {
    expect(resolveMysqlSsl(`${DSN}?ssl-mode=DISABLED`)).toBeUndefined();
  });

  it('prefers the explicit option over the DSN', () => {
    expect(resolveMysqlSsl(`${DSN}?ssl=true`, false)).toBeUndefined();
    expect(resolveMysqlSsl(`${DSN}?ssl=false`, { rejectUnauthorized: true })).toEqual({
      rejectUnauthorized: true,
    });
  });

  it('rejects malformed ssl JSON', () => {
    expect(() => resolveMysqlSsl(`${DSN}?ssl=%7Bbroken`)).toThrow(/invalid ssl/i);
  });
});

describe('mysql driver options', () => {
  it('maps max to mysql2 connectionLimit', async () => {
    const driver = new MysqlDriver('mysql://user:pass@localhost:3306/db', { max: 3 });
    try {
      expect((driver as any).pool.pool.config.connectionLimit).toBe(3);
      expect((driver as any).pool.pool.config.max).toBeUndefined();
    } finally {
      await driver.close();
    }
  });
});

describe('ConnectionPool driverFactory options', () => {
  it('passes ssl and timeouts to the factory', async () => {
    const received: { options?: Record<string, any> } = {};
    const pool = new ConnectionPool('postgres', PG_DSN, {
      min: 0,
      max: 1,
      connectionTimeoutMs: 4321,
      ssl: { rejectUnauthorized: false },
      driverFactory: (_dsn, options) => {
        received.options = options as Record<string, any>;
        return new MockDriver();
      },
    });

    try {
      await pool.query('SELECT 1');
      expect(received.options?.ssl).toEqual({ rejectUnauthorized: false });
      expect(received.options?.connectionTimeoutMs).toBe(4321);
      expect(received.options?.max).toBe(1);
    } finally {
      await pool.close();
    }
  });
});
