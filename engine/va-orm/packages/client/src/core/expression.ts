// VA-ORM Expression Builder

import type { WhereClause, FilterOperator } from './types.js';
import { ansiQuote } from '../relation/quote.js';
import type { JsonDialect, JsonKey, JsonPathInput } from './json-path.js';
import {
  jsonBindParam,
  jsonExistsExtract,
  jsonTextExtract,
  jsonTypedExtract,
  kindOfJsonValue,
  mysqlJsonPathLiteral,
  parseJsonPath,
  pgPathLiteral,
  sqlStringLiteral,
} from './json-path.js';

export type { JsonDialect, JsonPathInput };

/** Operators the builder accepts. Anything else (e.g. from a hand-built
 *  WhereClause) is rejected — operators must never carry user input. */
const VALID_OPERATORS: ReadonlySet<string> = new Set([
  '=',
  '!=',
  '>',
  '<',
  '>=',
  '<=',
  'LIKE',
  'NOT LIKE',
  'ILIKE',
  'NOT ILIKE',
  'IN',
  'NOT IN',
  'IS NULL',
  'IS NOT NULL',
  'BETWEEN',
  'NOT BETWEEN',
  '@>',
  '&&',
]);

/** SQLite has no default LIKE escape char; PG/MySQL default to `\`. Always pin it. */
const LIKE_OPERATORS: ReadonlySet<string> = new Set(['LIKE', 'NOT LIKE', 'ILIKE', 'NOT ILIKE']);

function likeSuffix(operator: string): string {
  return LIKE_OPERATORS.has(operator) ? ` ESCAPE '\\'` : '';
}

export function assertSafeOperator(operator: string): void {
  if (!VALID_OPERATORS.has(operator)) {
    throw new Error(`Unsafe SQL operator rejected: ${JSON.stringify(operator)}`);
  }
}

/** ORDER BY direction allowlist — never interpolate raw direction strings. */
export function assertSafeDirection(direction: string): 'ASC' | 'DESC' {
  const upper = String(direction).toUpperCase();
  if (upper !== 'ASC' && upper !== 'DESC') {
    throw new Error(`Unsafe ORDER BY direction rejected: ${JSON.stringify(direction)}`);
  }
  return upper;
}

/** LIMIT/OFFSET must be non-negative integers — never interpolate raw values. */
export function assertSafeInteger(value: number | undefined, clause: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Unsafe ${clause} rejected: ${JSON.stringify(value)}`);
  }
}

/**
 * Trusted raw SQL fragment. Only library-constructed instances are treated as
 * SQL. Detection is `instanceof`, never `'raw' in value` — a plain object from
 * a JSON body (`{"raw":"1=1"}`) can never be an instance, closing the
 * duck-typing SQLi vector (CWE-89).
 */
export class RawSql {
  constructor(
    readonly raw: string,
    readonly values: any[] = [],
  ) {}
}

export function isRawSql(value: unknown): value is RawSql {
  return value instanceof RawSql;
}

export class ExpressionBuilder {
  private clauses: WhereClause[] = [];
  private params: any[] = [];
  private placeholderFn: (index: number) => string;
  private quote: (name: string) => string;
  private dialect: JsonDialect;
  private pendingConnector?: 'AND' | 'OR' | 'NOT';

  constructor(
    placeholderFn: (index: number) => string = (i) => `$${i}`,
    quote: (name: string) => string = (n) => ansiQuote(n.toLowerCase()),
    dialect: JsonDialect = 'postgres',
  ) {
    this.placeholderFn = placeholderFn;
    this.quote = quote;
    this.dialect = dialect;
  }

  /**
   * Override the SQL dialect used by JSON helpers. QueryBuilder and
   * ModelDelegate set this from `driver.getDialect()` automatically —
   * call it manually only when constructing the builder yourself.
   */
  setDialect(dialect: JsonDialect): this {
    this.dialect = dialect;
    return this;
  }

  getDialect(): JsonDialect {
    return this.dialect;
  }

  private addClause(clause: WhereClause): this {
    if (this.pendingConnector) {
      clause.connector = this.pendingConnector;
      this.pendingConnector = undefined;
    } else if (this.clauses.length > 0 && !clause.connector) {
      clause.connector = 'AND';
    }
    this.clauses.push(clause);
    return this;
  }

  // ============ COMPARISON ============

  eq(column: string, value: any): this {
    return this.addClause({ column, operator: '=', value });
  }

  neq(column: string, value: any): this {
    return this.addClause({ column, operator: '!=', value });
  }

  gt(column: string, value: any): this {
    return this.addClause({ column, operator: '>', value });
  }

  gte(column: string, value: any): this {
    return this.addClause({ column, operator: '>=', value });
  }

  lt(column: string, value: any): this {
    return this.addClause({ column, operator: '<', value });
  }

  lte(column: string, value: any): this {
    return this.addClause({ column, operator: '<=', value });
  }

  // ============ PATTERN ============

  like(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'LIKE', value: pattern });
  }

  notLike(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'NOT LIKE', value: pattern });
  }

  ilike(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'ILIKE', value: pattern });
  }

  notIlike(column: string, pattern: string): this {
    return this.addClause({ column, operator: 'NOT ILIKE', value: pattern });
  }

  // ============ NULL ============

  isNull(column: string): this {
    return this.addClause({ column, operator: 'IS NULL' });
  }

  isNotNull(column: string): this {
    return this.addClause({ column, operator: 'IS NOT NULL' });
  }

  // ============ IN ============

  in(column: string, values: any[]): this {
    return this.addClause({ column, operator: 'IN', value: values });
  }

  notIn(column: string, values: any[]): this {
    return this.addClause({ column, operator: 'NOT IN', value: values });
  }

  // ============ BETWEEN ============

  between(column: string, min: any, max: any): this {
    return this.addClause({ column, operator: 'BETWEEN', value: [min, max] });
  }

  notBetween(column: string, min: any, max: any): this {
    return this.addClause({ column, operator: 'NOT BETWEEN', value: [min, max] });
  }

  // ============ LOGICAL ============

  and(): this {
    this.pendingConnector = 'AND';
    return this;
  }

  or(): this {
    this.pendingConnector = 'OR';
    return this;
  }

  not(): this {
    this.pendingConnector = 'NOT';
    return this;
  }

  // ============ NESTED ============

  group(fn: (builder: ExpressionBuilder) => void): this {
    const nested = new ExpressionBuilder(this.placeholderFn, this.quote, this.dialect);
    fn(nested);
    this.addClause({
      column: '',
      operator: '=',
      nested: nested.clauses,
    });
    return this;
  }

  // ============ RAW ============

  /**
   * Inject a raw SQL condition fragment.
   *
   * @remarks
   * **Trusted developer SQL only.** Never pass HTTP/user input here —
   * values must be bind parameters (`?` / `$n` placeholders), not inlined.
   * Prefer `eq`/`in`/`group` for anything user-influenced.
   * Alias of {@link rawUnsafe}.
   */
  raw(condition: string, ...values: any[]): this {
    return this.rawUnsafe(condition, ...values);
  }

  /**
   * Same as {@link raw} but named to signal danger.
   * Use only for static, developer-authored SQL fragments.
   */
  rawUnsafe(condition: string, ...values: any[]): this {
    if (condition.includes('\0')) {
      throw new Error('Unsafe raw SQL rejected: null byte in fragment');
    }
    return this.addClause({
      column: '',
      operator: '=',
      value: new RawSql(condition, values),
    });
  }

  // ============ ARRAY OPERATIONS (PostgreSQL) ============

  has(column: string, value: any): this {
    return this.addClause({ column, operator: '@>', value: [value] });
  }

  hasSome(column: string, values: any[]): this {
    return this.addClause({ column, operator: '&&', value: values });
  }

  hasEvery(column: string, values: any[]): this {
    return this.addClause({ column, operator: '@>', value: values });
  }

  isEmpty(column: string): this {
    return this.addClause({ column, operator: '=', value: new RawSql('ARRAY[]::[]') });
  }

  isNotEmpty(column: string): this {
    return this.addClause({ column, operator: '!=', value: new RawSql('ARRAY[]::[]') });
  }

  // ============ JSON SEARCH ============
  //
  // Cross-dialect search inside JSON columns. `path` accepts dot notation
  // ('address.city'), JSONPath-ish ('$.address.city', 'tags[0]') or segments
  // (['address', 'city']). Values stay bind parameters on every dialect.
  //
  //   eb.jsonEq('metadata', 'city', 'Jakarta')
  //   eb.jsonEq('metadata', '$.address.city', 'Jakarta')
  //   eb.jsonContains('metadata', { role: 'admin' })
  //   eb.jsonArrayContains('metadata', 'tags', 'vip')

  jsonEq(column: string, path: JsonPathInput, value: any): this {
    return this.jsonCompare(column, path, '=', value);
  }

  jsonNotEq(column: string, path: JsonPathInput, value: any): this {
    return this.jsonCompare(column, path, '!=', value);
  }

  jsonGt(column: string, path: JsonPathInput, value: any): this {
    return this.jsonCompare(column, path, '>', value);
  }

  jsonGte(column: string, path: JsonPathInput, value: any): this {
    return this.jsonCompare(column, path, '>=', value);
  }

  jsonLt(column: string, path: JsonPathInput, value: any): this {
    return this.jsonCompare(column, path, '<', value);
  }

  jsonLte(column: string, path: JsonPathInput, value: any): this {
    return this.jsonCompare(column, path, '<=', value);
  }

  /** Pattern must already include `%` wildcards (mirrors {@link like}). */
  jsonLike(column: string, path: JsonPathInput, pattern: string): this {
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    const expr = jsonTextExtract(this.dialect, col, keys);
    return this.raw(`${expr} LIKE ? ESCAPE '\\'`, pattern);
  }

  jsonNotLike(column: string, path: JsonPathInput, pattern: string): this {
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    const expr = jsonTextExtract(this.dialect, col, keys);
    return this.raw(`${expr} NOT LIKE ? ESCAPE '\\'`, pattern);
  }

  /**
   * Case-insensitive match. PostgreSQL uses `ILIKE`; MySQL/SQLite fall back
   * to `LOWER(...) LIKE LOWER(?)` (pass an already-lowercased pattern
   * there — or any pattern, matching is case-insensitive either way).
   */
  jsonILike(column: string, path: JsonPathInput, pattern: string): this {
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    if (this.dialect === 'postgres') {
      const expr = jsonTextExtract(this.dialect, col, keys);
      return this.raw(`${expr} ILIKE ? ESCAPE '\\'`, pattern);
    }
    const expr = jsonTextExtract(this.dialect, col, keys);
    return this.raw(`LOWER(${expr}) LIKE LOWER(?) ESCAPE '\\'`, pattern);
  }

  jsonIn(column: string, path: JsonPathInput, values: any[]): this {
    return this.jsonInList(column, path, values, false);
  }

  jsonNotIn(column: string, path: JsonPathInput, values: any[]): this {
    return this.jsonInList(column, path, values, true);
  }

  /** True when the path exists (explicit JSON null counts as existing). */
  jsonExists(column: string, path: JsonPathInput): this {
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    if (this.dialect === 'mysql') {
      if (keys.length === 0) return this.raw(`(${col} IS NOT NULL)`);
      return this.raw(`(JSON_CONTAINS_PATH(${col}, 'one', ${mysqlJsonPathLiteral(keys)}) = 1)`);
    }
    const expr = jsonExistsExtract(this.dialect, col, keys);
    return this.raw(`(${expr} IS NOT NULL)`);
  }

  jsonNotExists(column: string, path: JsonPathInput): this {
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    if (this.dialect === 'mysql') {
      if (keys.length === 0) return this.raw(`(${col} IS NULL)`);
      return this.raw(`(JSON_CONTAINS_PATH(${col}, 'one', ${mysqlJsonPathLiteral(keys)}) = 0)`);
    }
    const expr = jsonExistsExtract(this.dialect, col, keys);
    return this.raw(`(${expr} IS NULL)`);
  }

  /**
   * Containment: object at `path` contains `value`.
   * - object `value` → document contains (Postgres `@>`, MySQL
   *   `JSON_CONTAINS`, SQLite per-key equality)
   * - scalar `value` → array membership, same as {@link jsonArrayContains}
   */
  jsonContains(column: string, value: any, path: JsonPathInput = '$'): this {
    if (value === undefined) throw new Error('jsonContains requires a value');
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    if (this.dialect === 'postgres') {
      // Scalars and documents alike travel as JSON text for ::jsonb.
      const doc = JSON.stringify(value);
      if (keys.length === 0) return this.raw(`(${col} @> ?::jsonb)`, doc);
      return this.raw(`((${col} #> ${pgPathLiteral(keys)}) @> ?::jsonb)`, doc);
    }
    if (this.dialect === 'mysql') {
      const doc = JSON.stringify(value);
      const at = keys.length === 0 ? `'$'` : mysqlJsonPathLiteral(keys);
      return this.raw(`JSON_CONTAINS(${col}, ?, ${at})`, doc);
    }
    return this.jsonContainsSqlite(col, keys, value);
  }

  /**
   * Scalar must be a member of the JSON array at `path`.
   * (`jsonContains` with a scalar value does the same — this is the
   * explicit, self-documenting alias.)
   */
  jsonArrayContains(column: string, path: JsonPathInput, value: any): this {
    return this.jsonContains(column, value, path);
  }

  private jsonContainsSqlite(col: string, keys: JsonKey[], value: any): this {
    const kind = kindOfJsonValue(value);
    if (kind === 'json' && value !== null && !Array.isArray(value) && typeof value === 'object') {
      const entries = Object.entries(value);
      if (entries.length === 0) return this.raw('(1 = 1)');
      const parts: string[] = [];
      const params: any[] = [];
      for (const [k, v] of entries) {
        const sub = [...keys, k];
        const lit = mysqlJsonPathLiteral(sub);
        const vk = kindOfJsonValue(v);
        if (vk === 'json') {
          parts.push(`json_extract(${col}, ${lit}) = ?`);
          params.push(JSON.stringify(v));
        } else if (vk === 'boolean') {
          parts.push(`json_extract(${col}, ${lit}) = ?`);
          params.push(v ? 1 : 0);
        } else {
          parts.push(`json_extract(${col}, ${lit}) = ?`);
          params.push(v);
        }
      }
      return this.raw(`(${parts.join(' AND ')})`, ...params);
    }
    // Scalar (or array) membership in the array at path.
    const lit = mysqlJsonPathLiteral(keys);
    const from = keys.length === 0 ? `json_each(${col})` : `json_each(${col}, ${lit})`;
    const param =
      kind === 'boolean' ? (value ? 1 : 0) : kind === 'json' ? JSON.stringify(value) : value;
    return this.raw(`(EXISTS (SELECT 1 FROM ${from} WHERE value = ?))`, param);
  }

  private jsonCompare(
    column: string,
    path: JsonPathInput,
    op: '=' | '!=' | '>' | '>=' | '<' | '<=',
    value: any,
  ): this {
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    const kind = kindOfJsonValue(value);
    const d = this.dialect;

    if (kind === 'null') return this.jsonNullCompare(col, keys, op);

    if (kind === 'string') {
      // SQLite compares the natively-typed extract (no CAST — keeps the
      // SQL identical to the LIKE-free equality form); other dialects use
      // their unquoting text extraction.
      if (d === 'sqlite' && keys.length > 0) {
        return this.raw(`json_extract(${col}, ${mysqlJsonPathLiteral(keys)}) ${op} ?`, value);
      }
      const expr = jsonTypedExtract(d, col, keys, 'string');
      return this.raw(`${expr} ${op} ?`, value);
    }

    if (d === 'postgres') {
      if (kind === 'number' || kind === 'boolean') {
        const expr = jsonTypedExtract(d, col, keys, kind);
        return this.raw(`${expr} ${op} ?`, value);
      }
      const expr = jsonTypedExtract(d, col, keys, 'json');
      return this.raw(`${expr} ${op} ?::jsonb`, jsonBindParam(d, value));
    }

    if (d === 'mysql') {
      const lit = mysqlJsonPathLiteral(keys);
      if (keys.length === 0) {
        return this.raw(`(CAST(${col} AS JSON)) ${op} CAST(? AS JSON)`, JSON.stringify(value));
      }
      if (kind === 'number' && (op === '>' || op === '>=' || op === '<' || op === '<=')) {
        return this.raw(`(CAST(JSON_EXTRACT(${col}, ${lit}) AS DOUBLE)) ${op} ?`, value);
      }
      return this.raw(`JSON_EXTRACT(${col}, ${lit}) ${op} CAST(? AS JSON)`, JSON.stringify(value));
    }

    // sqlite — json_extract is natively typed for scalars
    const lit = mysqlJsonPathLiteral(keys);
    if (keys.length === 0) {
      if (kind === 'json') return this.raw(`(json(${col})) ${op} json(?)`, JSON.stringify(value));
      return this.raw(`${col} ${op} ?`, jsonBindParam(d, value));
    }
    if (kind === 'json') {
      return this.raw(`json_extract(${col}, ${lit}) ${op} ?`, JSON.stringify(value));
    }
    return this.raw(`json_extract(${col}, ${lit}) ${op} ?`, jsonBindParam(d, value));
  }

  private jsonNullCompare(
    col: string,
    keys: JsonKey[],
    op: '=' | '!=' | '>' | '>=' | '<' | '<=',
  ): this {
    const negate = op === '!=';
    if (this.dialect === 'sqlite') {
      const lit = mysqlJsonPathLiteral(keys);
      const test = keys.length === 0 ? `${col}` : `json_extract(${col}, ${lit})`;
      return negate ? this.raw(`(${test} IS NOT NULL)`) : this.raw(`(${test} IS NULL)`);
    }
    if (this.dialect === 'mysql') {
      const lit = mysqlJsonPathLiteral(keys);
      const raw = keys.length === 0 ? `(CAST(${col} AS JSON))` : `JSON_EXTRACT(${col}, ${lit})`;
      const frag = `(${raw} IS NULL OR ${raw} = CAST(? AS JSON))`;
      return negate ? this.raw(`(NOT ${frag})`, 'null') : this.raw(frag, 'null');
    }
    // postgres — #> returns jsonb (explicit null stays NOT NULL), so both
    // missing and JSON-null are covered.
    const expr =
      keys.length === 0
        ? `(${col}::jsonb)`
        : keys.length === 1 && typeof keys[0] === 'string'
          ? `(${col} -> ${sqlStringLiteral(keys[0])})`
          : `(${col} #> ${pgPathLiteral(keys)})`;
    const frag = `(${expr} IS NULL OR ${expr} = ?::jsonb)`;
    return negate ? this.raw(`(NOT ${frag})`, 'null') : this.raw(frag, 'null');
  }

  private jsonInList(column: string, path: JsonPathInput, values: any[], negate: boolean): this {
    const keyword = negate ? 'NOT IN' : 'IN';
    if (values.length === 0) return this.raw(negate ? '(1 = 1)' : '(1 = 0)');
    const col = this.quote(column);
    const keys = parseJsonPath(path);
    const d = this.dialect;
    const kinds = new Set(values.map(kindOfJsonValue));
    const uniform = kinds.size === 1 ? [...kinds][0] : 'mixed';

    if (uniform === 'string' || uniform === 'mixed') {
      let expr: string;
      if (d === 'sqlite' && uniform === 'string' && keys.length > 0) {
        expr = `json_extract(${col}, ${mysqlJsonPathLiteral(keys)})`;
      } else {
        expr =
          uniform === 'string'
            ? jsonTypedExtract(d, col, keys, 'string')
            : jsonTextExtract(d, col, keys);
      }
      const params =
        uniform === 'string'
          ? values
          : values.map((v) => (kindOfJsonValue(v) === 'json' ? JSON.stringify(v) : String(v)));
      return this.raw(`${expr} ${keyword} (${params.map(() => '?').join(', ')})`, ...params);
    }

    if (d === 'postgres') {
      if (uniform === 'number' || uniform === 'boolean') {
        const expr = jsonTypedExtract(d, col, keys, uniform);
        return this.raw(`${expr} ${keyword} (${values.map(() => '?').join(', ')})`, ...values);
      }
      const expr = jsonTypedExtract(d, col, keys, 'json');
      return this.raw(
        `${expr} ${keyword} (${values.map(() => '?::jsonb').join(', ')})`,
        ...values.map((v) => JSON.stringify(v)),
      );
    }

    if (d === 'mysql') {
      const lit = mysqlJsonPathLiteral(keys);
      const raw = keys.length === 0 ? `(CAST(${col} AS JSON))` : `JSON_EXTRACT(${col}, ${lit})`;
      return this.raw(
        `${raw} ${keyword} (${values.map(() => 'CAST(? AS JSON)').join(', ')})`,
        ...values.map((v) => JSON.stringify(v)),
      );
    }

    // sqlite
    const lit = mysqlJsonPathLiteral(keys);
    if (keys.length === 0 && uniform === 'json') {
      return this.raw(
        `(json(${col})) ${keyword} (${values.map(() => 'json(?)').join(', ')})`,
        ...values.map((v) => JSON.stringify(v)),
      );
    }
    const target = keys.length === 0 ? col : `json_extract(${col}, ${lit})`;
    return this.raw(
      `${target} ${keyword} (${values.map(() => '?').join(', ')})`,
      ...values.map((v) => jsonBindParam(d, v)),
    );
  }

  // ============ BUILD ============

  build(): { sql: string; params: any[] } {
    if (this.clauses.length === 0) {
      return { sql: '', params: [] };
    }

    const params: any[] = [];
    const parts: string[] = [];
    let paramIndex = 1;

    for (let i = 0; i < this.clauses.length; i++) {
      const clause = this.clauses[i];
      const prefix = i === 0 ? '' : `${clause.connector || 'AND'} `;
      assertSafeOperator(clause.operator);

      if (clause.nested) {
        const nested = this.buildNested(clause.nested, paramIndex);
        parts.push(`${prefix}(${nested.sql})`);
        params.push(...nested.params);
        paramIndex += nested.params.length;
        continue;
      }

      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator}`);
        continue;
      }

      if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as any[];
        const placeholders = values.map(() => this.placeholderFn(paramIndex++));
        parts.push(
          `${prefix}${this.quote(clause.column)} ${clause.operator} (${placeholders.join(', ')})`,
        );
        params.push(...values);
        continue;
      }

      if (clause.operator === 'BETWEEN' || clause.operator === 'NOT BETWEEN') {
        const [min, max] = clause.value as [any, any];
        parts.push(
          `${prefix}${this.quote(clause.column)} ${clause.operator} ${this.placeholderFn(paramIndex++)} AND ${this.placeholderFn(paramIndex++)}`,
        );
        params.push(min, max);
        continue;
      }

      if (isRawSql(clause.value)) {
        const rawValues = clause.value.values;
        const processed = clause.value.raw.replace(/\?/g, () => this.placeholderFn(paramIndex++));
        parts.push(`${prefix}${processed}`);
        params.push(...rawValues);
        continue;
      }

      // Array operators: @> (contains), && (overlaps)
      if (clause.operator === '@>' || clause.operator === '&&') {
        const values = clause.value as any[];
        if (Array.isArray(values)) {
          const placeholders = values.map(() => this.placeholderFn(paramIndex++));
          parts.push(
            `${prefix}${this.quote(clause.column)} ${clause.operator} ARRAY[${placeholders.join(', ')}]::text[]`,
          );
          params.push(...values);
        }
        continue;
      }

      parts.push(
        `${prefix}${this.quote(clause.column)} ${clause.operator} ${this.placeholderFn(paramIndex++)}${likeSuffix(clause.operator)}`,
      );
      params.push(clause.value);
    }

    return {
      sql: parts.join(' ').trim(),
      params,
    };
  }

  private buildNested(clauses: WhereClause[], startIndex: number): { sql: string; params: any[] } {
    const params: any[] = [];
    const parts: string[] = [];
    let paramIndex = startIndex;

    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      const prefix = i === 0 ? '' : `${clause.connector || 'AND'} `;
      assertSafeOperator(clause.operator);

      if (clause.nested) {
        const nested = this.buildNested(clause.nested, paramIndex);
        parts.push(`${prefix}(${nested.sql})`);
        params.push(...nested.params);
        paramIndex += nested.params.length;
        continue;
      }

      if (clause.operator === 'IS NULL' || clause.operator === 'IS NOT NULL') {
        parts.push(`${prefix}${this.quote(clause.column)} ${clause.operator}`);
        continue;
      }

      if (clause.operator === 'IN' || clause.operator === 'NOT IN') {
        const values = clause.value as any[];
        const placeholders = values.map(() => this.placeholderFn(paramIndex++));
        parts.push(
          `${prefix}${this.quote(clause.column)} ${clause.operator} (${placeholders.join(', ')})`,
        );
        params.push(...values);
        continue;
      }

      if (isRawSql(clause.value)) {
        const rawValues = clause.value.values;
        let valueIndex = 0;
        const processed = clause.value.raw.replace(/\?/g, () => this.placeholderFn(paramIndex++));
        parts.push(`${prefix}${processed}`);
        params.push(...rawValues);
        continue;
      }

      parts.push(
        `${prefix}${this.quote(clause.column)} ${clause.operator} ${this.placeholderFn(paramIndex++)}${likeSuffix(clause.operator)}`,
      );
      params.push(clause.value);
    }

    return {
      sql: parts.join(' ').trim(),
      params,
    };
  }

  // ============ STATIC ============

  static create(
    placeholderFn?: (index: number) => string,
    quote?: (name: string) => string,
    dialect?: JsonDialect,
  ): ExpressionBuilder {
    return new ExpressionBuilder(placeholderFn, quote, dialect ?? 'postgres');
  }

  static from(
    clauses: WhereClause[],
    placeholderFn?: (index: number) => string,
    quote?: (name: string) => string,
    dialect?: JsonDialect,
  ): ExpressionBuilder {
    const builder = new ExpressionBuilder(placeholderFn, quote, dialect ?? 'postgres');
    builder.clauses = [...clauses];
    return builder;
  }
}
