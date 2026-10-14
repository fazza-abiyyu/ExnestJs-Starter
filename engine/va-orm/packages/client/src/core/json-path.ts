// VA-ORM JSON path helpers
//
// Cross-dialect JSON search fragments for PostgreSQL (JSONB),
// MySQL (JSON) and SQLite (JSON1). All values stay bind parameters —
// path keys are escaped into string literals, never interpolated raw.

import type { DriverType } from './types.js';

export type JsonDialect = 'postgres' | 'mysql' | 'sqlite';

export type JsonPathInput = string | Array<string | number>;

export type JsonKey = string | number;

export function dialectOf(driver: { getDialect?: () => DriverType } | undefined): JsonDialect {
  try {
    const d = driver?.getDialect?.();
    if (d === 'mysql' || d === 'sqlite' || d === 'postgres') return d;
  } catch {
    // ignore — fall through to default
  }
  return 'postgres';
}

/** Escape a value interpolated into a single-quoted SQL string literal. */
export function sqlStringLiteral(value: string): string {
  if (value.includes('\0')) throw new Error('Unsafe JSON path rejected: null byte');
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Parse a JSON path into segments. Accepts:
 * - `'city'` / `'address.city'` (dot notation)
 * - `'$.address.city'` / `'$.tags[0]'` (JSONPath-ish)
 * - `['address', 'city']` / `['tags', 0]` (segments, Prisma-style)
 *
 * Numbers (or `[n]`) address array indices. Quoted segments
 * (`$"my.key"`, `'a."b.c"'`) keep literal dots.
 */
export function parseJsonPath(path: JsonPathInput): JsonKey[] {
  if (Array.isArray(path)) {
    const keys = path.map((seg) => {
      if (typeof seg === 'number') {
        assertJsonKeyIndex(seg);
        return seg;
      }
      return String(seg);
    });
    assertNoNullBytes(keys);
    return keys;
  }

  let s = String(path).trim();
  if (s === '' || s === '$') return [];
  if (s.startsWith('$')) s = s.slice(1);
  if (s.startsWith('.')) s = s.slice(1);
  if (s === '') return [];

  const keys: JsonKey[] = [];
  let i = 0;
  const n = s.length;

  while (i < n) {
    const ch = s[i];
    if (ch === '.') {
      i++;
      continue;
    }
    if (ch === '[') {
      const end = s.indexOf(']', i);
      if (end === -1) throw new Error(`Invalid JSON path rejected: ${JSON.stringify(path)}`);
      const inner = s.slice(i + 1, end).trim();
      // ["key"] / ['key'] quoted member
      if (
        (inner.startsWith('"') && inner.endsWith('"')) ||
        (inner.startsWith("'") && inner.endsWith("'"))
      ) {
        keys.push(inner.slice(1, -1));
      } else if (/^\d+$/.test(inner)) {
        keys.push(Number(inner));
      } else if (inner === '') {
        throw new Error(`Invalid JSON path rejected: ${JSON.stringify(path)}`);
      } else {
        keys.push(inner);
      }
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      // Quoted member: ."my.key"
      let j = i + 1;
      let out = '';
      while (j < n) {
        if (s[j] === '\\' && j + 1 < n) {
          out += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === '"') break;
        out += s[j];
        j++;
      }
      if (j >= n) throw new Error(`Invalid JSON path rejected: ${JSON.stringify(path)}`);
      keys.push(out);
      i = j + 1;
      continue;
    }
    // Bare member until next '.' or '['
    let j = i;
    while (j < n && s[j] !== '.' && s[j] !== '[') j++;
    const member = s.slice(i, j).trim();
    if (member) keys.push(member);
    i = j;
  }

  assertNoNullBytes(keys);
  if (keys.length === 0) throw new Error(`Invalid JSON path rejected: ${JSON.stringify(path)}`);
  return keys;
}

function assertJsonKeyIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid JSON path index rejected: ${JSON.stringify(index)}`);
  }
}

function assertNoNullBytes(keys: JsonKey[]): void {
  for (const k of keys) {
    if (typeof k === 'string' && k.includes('\0')) {
      throw new Error('Unsafe JSON path rejected: null byte');
    }
  }
}

/** PostgreSQL text[] literal: `'{address,city}'` / `'{tags,0}'`. */
export function pgPathLiteral(keys: JsonKey[]): string {
  const parts = keys.map((k) => {
    if (typeof k === 'number') return String(k);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return k;
    return `"${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  });
  return sqlStringLiteral(`{${parts.join(',')}}`);
}

/** MySQL / SQLite JSON path: `'$.address."city name"[0]'`. */
export function mysqlJsonPathLiteral(keys: JsonKey[]): string {
  let out = '$';
  for (const k of keys) {
    if (typeof k === 'number') {
      out += `[${k}]`;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
      out += `.${k}`;
    } else {
      out += `."${k.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
  }
  return sqlStringLiteral(out);
}

/** Text-extraction expression (unquoted scalar text) for LIKE / string compare. */
export function jsonTextExtract(
  dialect: JsonDialect,
  quotedColumn: string,
  keys: JsonKey[],
): string {
  if (keys.length === 0) {
    // Whole column as text
    if (dialect === 'postgres') return `(${quotedColumn} #>> '{}')`;
    if (dialect === 'mysql') return `JSON_UNQUOTE(CAST(${quotedColumn} AS JSON))`;
    return `CAST(json(${quotedColumn}) AS TEXT)`;
  }
  if (dialect === 'postgres') {
    if (keys.length === 1 && typeof keys[0] === 'string') {
      return `(${quotedColumn} ->> ${sqlStringLiteral(keys[0])})`;
    }
    return `(${quotedColumn} #>> ${pgPathLiteral(keys)})`;
  }
  const lit = mysqlJsonPathLiteral(keys);
  if (dialect === 'mysql') return `JSON_UNQUOTE(JSON_EXTRACT(${quotedColumn}, ${lit}))`;
  return `CAST(json_extract(${quotedColumn}, ${lit}) AS TEXT)`;
}

/** Typed-extraction expression for exact compare, by JS value kind. */
export function jsonTypedExtract(
  dialect: JsonDialect,
  quotedColumn: string,
  keys: JsonKey[],
  kind: 'string' | 'number' | 'boolean' | 'json',
): string {
  if (keys.length === 0) return wholeColumnJson(dialect, quotedColumn);
  const text = jsonTextExtract(dialect, quotedColumn, keys);
  if (kind === 'string') return text;
  if (dialect === 'postgres') {
    if (kind === 'number') return `(${text}::numeric)`;
    if (kind === 'boolean') return `(${text}::boolean)`;
    // json: raw jsonb at path
    if (keys.length === 1 && typeof keys[0] === 'string') {
      return `(${quotedColumn} -> ${sqlStringLiteral(keys[0])})`;
    }
    return `(${quotedColumn} #> ${pgPathLiteral(keys)})`;
  }
  if (dialect === 'mysql') {
    if (kind === 'number')
      return `(CAST(JSON_EXTRACT(${quotedColumn}, ${mysqlJsonPathLiteral(keys)}) AS DOUBLE))`;
    // boolean + json compare as JSON for exact type semantics
    return `JSON_EXTRACT(${quotedColumn}, ${mysqlJsonPathLiteral(keys)})`;
  }
  // sqlite: json_extract already returns typed scalars; objects/arrays as JSON text
  return `json_extract(${quotedColumn}, ${mysqlJsonPathLiteral(keys)})`;
}

function wholeColumnJson(dialect: JsonDialect, quotedColumn: string): string {
  if (dialect === 'postgres') return `(${quotedColumn}::jsonb)`;
  if (dialect === 'mysql') return `(CAST(${quotedColumn} AS JSON))`;
  return `(json(${quotedColumn}))`;
}

/** Existence-test expression: true when the path is present (even JSON null). */
export function jsonExistsExtract(
  dialect: JsonDialect,
  quotedColumn: string,
  keys: JsonKey[],
): string {
  if (keys.length === 0) return quotedColumn;
  if (dialect === 'postgres') {
    if (keys.length === 1 && typeof keys[0] === 'string') {
      return `(${quotedColumn} -> ${sqlStringLiteral(keys[0])})`;
    }
    return `(${quotedColumn} #> ${pgPathLiteral(keys)})`;
  }
  if (dialect === 'mysql') {
    return `JSON_CONTAINS_PATH(${quotedColumn}, 'one', ${mysqlJsonPathLiteral(keys)})`;
  }
  return `json_extract(${quotedColumn}, ${mysqlJsonPathLiteral(keys)})`;
}

export type JsonValueKind = 'null' | 'string' | 'number' | 'boolean' | 'json';

export function kindOfJsonValue(value: unknown): JsonValueKind {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'json';
}

/**
 * Bind parameter for a JSON compare. Objects/arrays always travel as
 * canonical JSON text; Postgres casts to jsonb at comparison time,
 * MySQL via CAST(? AS JSON), SQLite compares json() canonical form.
 */
export function jsonBindParam(dialect: JsonDialect, value: unknown): unknown {
  const kind = kindOfJsonValue(value);
  if (kind === 'json') return JSON.stringify(value);
  if (kind === 'boolean' && dialect === 'sqlite') return value ? 1 : 0;
  return value;
}
