// VA-ORM Client - Main Entry Point

export * from './core/types.js';
export * from './core/json-path.js';
export * from './core/va.client.js';
export * from './core/connection.pool.js';
export * from './core/query-builder.js';
export * from './core/expression.js';

export * from './repository/repository.js';
export * from './repository/batch.js';
export * from './repository/aggregation.js';
export * from './repository/model.delegate.js';
export * from './repository/json-codec.js';
export * from './repository/nested.writes.js';
export * from './repository/field.ops.js';

export * from './relation/index.js';
export { ansiQuote, mysqlQuote, quoterFor } from './relation/quote.js';
export type { QuoteFn } from './relation/quote.js';

export * from './raw/raw-query.js';
export * from './raw/cte.js';
export * from './raw/subquery.js';

export * from './pagination/offset.js';
export * from './pagination/cursor.js';
export * from './pagination/keyset.js';
export * from './pagination/adapters/odata.adapter.js';
export * from './pagination/adapters/rest.adapter.js';
export * from './pagination/adapters/graphql.adapter.js';

export { VaClient } from './core/va.client.js';
export type { VaClientOptions } from './core/va.client.js';

export { PostgresDriver } from './drivers/postgres/postgres.driver.js';
export { MysqlDriver } from './drivers/mysql/mysql.driver.js';
export { SqliteDriver } from './drivers/sqlite/sqlite.driver.js';
export { HttpDriver } from './drivers/http/http.driver.js';
export {
  HTTP_PROFILES,
  detectHttpProtocol,
  resolveHttpProfile,
  encodeTursoValue,
  decodeTursoValue,
} from './drivers/http/http.protocols.js';
export type { HttpProtocolProfile } from './drivers/http/http.protocols.js';
export type { SchemaAST } from '../../schema/src/schema.types.js';
export { VaError } from './core/errors.js';
