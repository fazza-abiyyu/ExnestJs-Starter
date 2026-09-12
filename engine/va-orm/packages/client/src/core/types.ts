// VA-ORM Core Types

// ============ DRIVER ============

export type DriverType = 'postgres' | 'mysql' | 'sqlite'

export type ColumnType = 'string' | 'text' | 'integer' | 'bigint' | 'float' | 'decimal' | 'boolean' | 'datetime' | 'uuid' | 'json' | 'bytes'

export type JoinType = 'inner' | 'left' | 'right' | 'cross'

export type SortDirection = 'asc' | 'desc'

// ============ QUERY RESULT ============

export interface QueryResult<T = any> {
  rows: T[]
  rowCount: number
}

// ============ DATABASE DRIVER ============

export interface DatabaseDriver {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>
  execute(sql: string, params?: any[]): Promise<{ rowCount: number }>
  transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T>
  close(): Promise<void>
  getPlaceholder(index: number): string
}

// ============ CONNECTION CONFIG ============

export interface ConnectionConfig {
  connectionString?: string
  host?: string
  port?: number
  database?: string
  user?: string
  password?: string
  filename?: string
  max?: number
  min?: number
  idleTimeoutMs?: number
  connectionTimeoutMs?: number
  maxLifetimeMs?: number
  maxUses?: number
  statementTimeoutMs?: number
  lockTimeoutMs?: number
  healthCheck?: boolean
  healthCheckIntervalMs?: number
  healthCheckQuery?: string
  retryAttempts?: number
  retryDelayMs?: number
  retryBackoff?: 'fixed' | 'exponential'
  ssl?: boolean | { rejectUnauthorized?: boolean; ca?: string; cert?: string; key?: string }
  applicationName?: string
  disablePreparedStatements?: boolean
  driverFactory?: (dsn: string) => DatabaseDriver
  slowQueryThresholdMs?: number
  onSlowQuery?: (info: SlowQueryInfo) => void
}

export interface SlowQueryInfo {
  sql: string
  elapsedMs: number
  params?: any[]
}

// ============ FILTER OPERATORS ============

export type FilterOperator =
  | '=' | '!=' | '>' | '<' | '>=' | '<='
  | 'LIKE' | 'NOT LIKE'
  | 'ILIKE' | 'NOT ILIKE'
  | 'IN' | 'NOT IN'
  | 'IS NULL' | 'IS NOT NULL'
  | 'BETWEEN' | 'NOT BETWEEN'

// ============ WHERE CLAUSE ============

export interface WhereClause {
  column: string
  operator: FilterOperator
  value?: any
  connector?: 'AND' | 'OR' | 'NOT'
  nested?: WhereClause[]
}

// ============ ORDER CLAUSE ============

export interface OrderClause {
  column: string
  direction: SortDirection
  table?: string
}

// ============ SCHEMA DEFINITIONS ============

export interface ColumnDefinition {
  type: ColumnType
  primary?: boolean
  default?: any
  nullable?: boolean
  unique?: boolean
  index?: boolean
  length?: number
  references?: { table: string; column: string; onDelete?: 'cascade' | 'restrict' | 'set null' }
}

export interface TableDefinition {
  name: string
  columns: Record<string, ColumnDefinition>
  softDelete?: {
    column: string
    strategy: 'nullable' | 'flag'
  }
}

export interface RelationDefinition {
  type: 'one-to-one' | 'one-to-many' | 'many-to-many'
  table: string
  foreignKey?: string
  referenceKey?: string
  through?: string
}

// ============ RELATIONS ============

export type RelationKind = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many-implicit'

export interface RelationMeta {
  field: string
  targetModel: string
  isList: boolean
  kind: RelationKind
  fkModel: string
  fkFields: string[]
  pkModel: string
  pkFields: string[]
  onDelete?: string
  relationName?: string
  joinTable?: string
  backField?: string
  isFkHolder: boolean
}

export interface ModelMeta {
  name: string
  table: string
  primaryKey: string
  relations: Map<string, RelationMeta>
  /** Optional schema fields — enables @updatedAt auto-touch when present. */
  fields?: Array<{ name: string; attributes: Array<{ name: string }> }>
}

export type ScalarFilter<T = any> =
  | T
  | {
      equals?: T
      not?: T
      in?: T[]
      notIn?: T[]
      lt?: T
      lte?: T
      gt?: T
      gte?: T
      contains?: string
      startsWith?: string
      endsWith?: string
      mode?: 'default' | 'insensitive'
    }

export interface RelationFilter {
  some?: WhereInput
  every?: WhereInput
  none?: WhereInput
  is?: WhereInput
  isNot?: WhereInput
}

export interface WhereInput {
  AND?: WhereInput[]
  OR?: WhereInput[]
  NOT?: WhereInput | WhereInput[]
  [field: string]: ScalarFilter | RelationFilter | WhereInput[] | WhereInput | undefined
}

export type IncludeArg =
  | boolean
  | {
      where?: WhereInput
      orderBy?: Record<string, SortDirection>
      take?: number
      skip?: number
      select?: SelectArg
      include?: Record<string, IncludeArg>
    }

export type IncludeMap = Record<string, IncludeArg>

export type SelectArg = Record<string, boolean> | string[]

// ============ PAGINATION ============

export interface OffsetOptions {
  page?: number
  limit?: number
  skip?: number
}

export interface OffsetResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
  skip: number
  totalPages: number
  hasNext: boolean
  hasPrevious: boolean
}

export interface CursorOptions {
  cursor?: string
  limit?: number
  direction?: 'forward' | 'backward'
}

export interface CursorResult<T> {
  items: T[]
  nextCursor?: string
  previousCursor?: string
  hasMore: boolean
  hasPrevious: boolean
}

export interface KeysetOptions {
  after?: Record<string, any>
  limit?: number
  direction?: 'forward' | 'backward'
}

export interface KeysetResult<T> {
  items: T[]
  nextAfter?: Record<string, any>
  hasMore: boolean
  hasPrevious: boolean
}

// ============ REPOSITORY ============

export interface RepositoryOptions {
  softDelete?: boolean
  softDeleteColumn?: string
  camelToSnake?: boolean
  /** App-level field name carrying @updatedAt semantics — auto-set to now on write when absent. */
  updatedAtField?: string
}

// ============ AGGREGATE ============

export interface AggregateResult {
  _count: number | Record<string, number>
  _sum: Record<string, number | null>
  _avg: Record<string, number | null>
  _min: Record<string, any>
  _max: Record<string, any>
}

// ============ TRANSACTION ============

export interface TransactionOptions {
  maxWait?: number
  timeout?: number
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable'
}

// ============ POOL STATS ============

export interface PoolStats {
  totalCount: number
  idleCount: number
  activeCount: number
  waitingCount: number
  totalQueries: number
  totalErrors: number
  slowQueries: number
  avgQueryTimeMs: number
  maxQueryTimeMs: number
  uptimeMs: number
}
