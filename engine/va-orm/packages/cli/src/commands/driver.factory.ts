// VA-ORM Driver Factory (CLI)

import type { DatabaseDriver } from '../../../client/src/core/types.js';

export type CliProvider = 'postgres' | 'mysql' | 'sqlite' | 'http';

/** Dialect SQL untuk DDL/introspeksi (bukan transport). */
export type CliDialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Deteksi transport dari DSN.
 *
 * `http://` / `https://` → transport http (SQL over HTTP).
 * `mysql://` → mysql, `file:` / `*.db` → sqlite, sisanya postgres.
 */
export function detectProvider(connectionString: string): CliProvider {
  if (/^https?:\/\//i.test(connectionString)) return 'http';
  if (connectionString.startsWith('mysql://')) return 'mysql';
  if (connectionString.startsWith('file:') || connectionString.endsWith('.db')) return 'sqlite';
  return 'postgres';
}

/**
 * Provider di `va.schema` → dialect SQL untuk generate DDL.
 *
 * `http+sqlite` memakai DDL sqlite (D1/Turso), `http`/`http+postgres` memakai
 * DDL postgres (Neon/Accelerate).
 */
export function datasourceToProvider(datasourceProvider: string): CliDialect {
  const p = datasourceProvider.toLowerCase();
  if (p === 'mysql') return 'mysql';
  if (p === 'sqlite') return 'sqlite';
  if (p === 'http+sqlite') return 'sqlite';
  return 'postgres';
}

/** True bila provider di schema memakai transport http. */
export function isHttpProvider(datasourceProvider: string | undefined): boolean {
  if (!datasourceProvider) return false;
  const p = datasourceProvider.toLowerCase();
  return p === 'http' || p === 'https' || p.startsWith('http+');
}

/** Dialect SQL remote untuk transport http (default postgres). */
export function httpDialectFor(datasourceProvider: string | undefined): 'postgres' | 'sqlite' {
  if (datasourceProvider && datasourceProvider.toLowerCase() === 'http+sqlite') return 'sqlite';
  return 'postgres';
}

export async function createDriverFromUrl(connectionString: string): Promise<DatabaseDriver> {
  const provider = detectProvider(connectionString);
  if (provider === 'http') {
    const { HttpDriver } = await import('../../../client/src/drivers/http/http.driver.js');
    // Protocol dideteksi otomatis dari host (neon/accelerate/d1/turso).
    // Override via env: VA_HTTP_PROTOCOL=generic|neon|accelerate|d1|turso
    const protocol = process.env.VA_HTTP_PROTOCOL as any;
    return new HttpDriver(connectionString, protocol ? { protocol } : {});
  }
  if (provider === 'mysql') {
    const { MysqlDriver } = await import('../../../client/src/drivers/mysql/mysql.driver.js');
    return new MysqlDriver(connectionString);
  }
  if (provider === 'sqlite') {
    const { SqliteDriver } = await import('../../../client/src/drivers/sqlite/sqlite.driver.js');
    return new SqliteDriver(connectionString.replace('file:', ''));
  }
  const { PostgresDriver } =
    await import('../../../client/src/drivers/postgres/postgres.driver.js');
  return new PostgresDriver(connectionString);
}

export function requireDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('\x1b[31mError: DATABASE_URL environment variable is required\x1b[0m');
    process.exit(1);
  }
  return connectionString;
}

/**
 * DSN untuk operasi DDL (`db push`, `migrate`, `db pull`).
 *
 * Dipisah dari `DATABASE_URL` supaya role aplikasi (R/W) dan role migrator
 * (DDL) bisa berbeda — pola umum di produksi:
 *
 * ```bash
 * # app runtime (DML)
 * DATABASE_URL=postgresql://research_app:...@host/db
 * # tooling (DDL)
 * MIGRATOR_DATABASE_URL=postgresql://research_migrator:...@host/db
 * ```
 *
 * Kalau `MIGRATOR_DATABASE_URL` tidak diset, jatuh ke `DATABASE_URL`.
 */
export function requireMigratorUrl(): string {
  const connectionString =
    process.env.MIGRATOR_DATABASE_URL ??
    process.env.VA_MIGRATOR_DATABASE_URL ??
    process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      '\x1b[31mError: MIGRATOR_DATABASE_URL (or DATABASE_URL) environment variable is required\x1b[0m',
    );
    process.exit(1);
  }
  return connectionString;
}
