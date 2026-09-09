// VA-ORM Identifier Quoting
//
// PostgreSQL folds unquoted identifiers to lowercase, which breaks
// camelCase columns (userId, displayName). Quote every identifier.
// MySQL uses backticks, PostgreSQL/SQLite use double quotes.

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
