// VA-ORM Driver Factory (CLI)

import type { DatabaseDriver } from '../../../client/src/core/types.js'

export type CliProvider = 'postgres' | 'mysql' | 'sqlite'

export function detectProvider(connectionString: string): CliProvider {
  if (connectionString.startsWith('mysql://')) return 'mysql'
  if (connectionString.startsWith('file:') || connectionString.endsWith('.db')) return 'sqlite'
  return 'postgres'
}

export function datasourceToProvider(datasourceProvider: string): 'postgres' | 'mysql' | 'sqlite' {
  if (datasourceProvider === 'mysql') return 'mysql'
  if (datasourceProvider === 'sqlite') return 'sqlite'
  return 'postgres'
}

export async function createDriverFromUrl(connectionString: string): Promise<DatabaseDriver> {
  const provider = detectProvider(connectionString)
  if (provider === 'mysql') {
    const { MysqlDriver } = await import('../../../client/src/drivers/mysql/mysql.driver.js')
    return new MysqlDriver(connectionString)
  }
  if (provider === 'sqlite') {
    const { SqliteDriver } = await import('../../../client/src/drivers/sqlite/sqlite.driver.js')
    return new SqliteDriver(connectionString.replace('file:', ''))
  }
  const { PostgresDriver } = await import('../../../client/src/drivers/postgres/postgres.driver.js')
  return new PostgresDriver(connectionString)
}

export function requireDatabaseUrl(): string {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('\x1b[31mError: DATABASE_URL environment variable is required\x1b[0m')
    process.exit(1)
  }
  return connectionString
}
