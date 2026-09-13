// VA-ORM Identifier Quoting
//
// Every interpolated identifier MUST go through these helpers — raw
// interpolation is identifier injection (SQLi via column/orderBy keys).
// PostgreSQL folds unquoted identifiers to lowercase, which breaks
// camelCase columns (userId, displayName). Quote every identifier.
// MySQL uses backticks, PostgreSQL/SQLite use double quotes.

import type { DatabaseDriver, DriverType } from '../core/types.js'

export type QuoteFn = (identifier: string) => string

function quoteParts(identifier: string, wrap: (part: string) => string): string {
  return identifier.split('.').map(wrap).join('.')
}

export function ansiQuote(identifier: string): string {
  return quoteParts(identifier, (part) => `"${part.replace(/"/g, '""')}"`)
}

export function mysqlQuote(identifier: string): string {
  return quoteParts(identifier, (part) => `\`${part.replace(/`/g, '``')}\``)
}

export function quoterFor(driver: 'postgres' | 'mysql' | 'sqlite'): QuoteFn {
  return driver === 'mysql' ? mysqlQuote : ansiQuote
}

function quoterForDriver(driver: DatabaseDriver | DriverType): QuoteFn {
  const dialect: DriverType =
    typeof driver === 'string' ? driver : driver.getDialect()
  return quoterFor(dialect)
}

/**
 * Quote a COLUMN/key identifier. Lowercases first so quoted references match
 * VA-ORM's unquoted DDL (folded to lowercase on PostgreSQL). Safe on all
 * drivers: MySQL/SQLite resolve columns case-insensitively. A bare `*`
 * (or `table.*` part) is preserved — quoting it would break the wildcard.
 */
export function quoteColumn(driver: DatabaseDriver | DriverType, name: string): string {
  const quote = quoterForDriver(driver)
  return quoteParts(name, (part) => (part === '*' ? '*' : quote(part.toLowerCase())))
}

/**
 * Quote a TABLE identifier, preserving case. Table names are
 * developer-controlled (never raw user input); quoting only neutralizes
 * breakout characters. NOTE: PostgreSQL targets should use lowercase table
 * names (e.g. @@map("customers")) to match folded DDL.
 */
export function quoteTable(driver: DatabaseDriver | DriverType, name: string): string {
  return quoterForDriver(driver)(name)
}
