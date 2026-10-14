// VA-ORM JSON codec
//
// Prisma-style transparent JSON columns on the schema-aware path
// (VaClient.model / generated delegates):
// - write: plain objects/arrays/scalars in Json fields are JSON-stringified
// - read: TEXT payloads in Json fields are parsed back (drivers that already
//   return objects — e.g. PostgreSQL jsonb — pass through untouched)
//
// Raw `Repository` has no schema metadata, so it never touches values.
// Storage is canonical JSON (strings included: 'Jakarta' -> '"Jakarta"'),
// so every value round-trips with its type intact — the same rule Prisma
// applies. `undefined` values are left alone.

import type { ModelMeta } from '../core/types.js';
import { safeJsonParse } from '../core/security.js';

/** App-level field names typed as Json in the schema (empty when unknown). */
export function jsonFieldNames(meta: ModelMeta | undefined): Set<string> {
  const names = new Set<string>();
  if (!meta?.fields) return names;
  for (const f of meta.fields) {
    if (typeof f.type === 'string' && f.type.replace('[]', '') === 'Json') {
      names.add(f.name);
    }
  }
  return names;
}

/**
 * Shallow-copy `data` with Json-field values serialized for the driver.
 * Returns the original object when nothing needs encoding.
 */
export function encodeJsonFields(
  meta: ModelMeta | undefined,
  data: Record<string, any>,
): Record<string, any> {
  const jsonFields = jsonFieldNames(meta);
  if (jsonFields.size === 0) return data;
  let out: Record<string, any> | undefined;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || !jsonFields.has(key)) continue;
    const encoded = JSON.stringify(value);
    // undefined for functions/symbols/bigint — leave the original so the
    // driver raises its usual binding error instead of silently storing nothing.
    if (encoded === undefined) continue;
    if (!out) out = { ...data };
    out[key] = encoded;
  }
  return out ?? data;
}

/** Parse TEXT payloads of Json fields back to values (mutates and returns `row`). */
export function decodeJsonRow(
  meta: ModelMeta | undefined,
  row: Record<string, any>,
): Record<string, any> {
  const jsonFields = jsonFieldNames(meta);
  if (jsonFields.size === 0 || !row) return row;
  for (const name of jsonFields) {
    // DB column names are lowercase-folded (quoteColumn) while app fields may
    // be camelCase — fall back to the lowercase key on read.
    const key = name in row ? name : name.toLowerCase();
    const value = row[key];
    if (typeof value !== 'string') continue;
    const parsed = safeJsonParse(value);
    if (parsed !== undefined) row[key] = parsed;
  }
  return row;
}

/** Decode every row (mutates and returns `rows`). */
export function decodeJsonRows<T extends Record<string, any>>(
  meta: ModelMeta | undefined,
  rows: T[],
): T[] {
  const jsonFields = jsonFieldNames(meta);
  if (jsonFields.size === 0) return rows;
  for (const row of rows) decodeJsonRow(meta, row);
  return rows;
}
