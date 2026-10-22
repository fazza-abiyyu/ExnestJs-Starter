// VA-ORM HTTP Protocol Profiles
//
// Setiap profile menjelaskan cara "bicara" dengan endpoint SQL-over-HTTP:
// bentuk body request + cara memetakan response JSON menjadi rows.
//
// Protokol bawaan:
// - `generic`   → POST {sql, params}  → {rows|data|results} | array
// - `neon`      → POST {query, params} → array | {rows, rowCount, fields}
// - `accelerate`→ POST {query, params} → {data, error?, meta?}
// - `d1`        → POST {sql, params}  → {result: [{results, success, meta}]}
// - `turso`     → POST /v2/pipeline    → {baton, results: [{type, response}]}
//
// Protocol lain bisa lewat `buildBody` / `mapResponse` custom (lihat HttpClientOptions).

import { VaError } from '../../core/errors.js';
import type {
  HttpClientOptions,
  HttpPlaceholderStyle,
  HttpProtocolName,
  HttpRequestContext,
  HttpResponseMapping,
  HttpSqlDialect,
} from '../../core/types.js';

export interface HttpProtocolProfile {
  name: HttpProtocolName;
  dialect: HttpSqlDialect;
  placeholder: HttpPlaceholderStyle;
  /** Path yang ditambahkan ke base URL (turso: `/v2/pipeline`). */
  path?: string;
  /** Apakah protokol mendukung session/stream interaktif (baton). */
  supportsSession: boolean;
  buildBody(sql: string, params: any[], ctx: HttpRequestContext): unknown;
  mapResponse(body: any): HttpResponseMapping;
}

// ============ VALUE CODEC (turso/libSQL) ============

/** Encode nilai JS → tipe libSQL `{type, value}` (value selalu string). */
export function encodeTursoValue(value: unknown): { type: string; value: string | null } {
  if (value === null || value === undefined) return { type: 'null', value: null };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { type: 'integer', value: String(value) }
      : { type: 'float', value: String(value) };
  }
  if (typeof value === 'boolean') return { type: 'integer', value: value ? '1' : '0' };
  if (typeof value === 'string') return { type: 'text', value };
  if (value instanceof Date) return { type: 'text', value: value.toISOString() };
  if (typeof value === 'object') return { type: 'text', value: JSON.stringify(value) };
  return { type: 'text', value: String(value) };
}

/** Decode nilai libSQL `{type, value}` → nilai JS. */
export function decodeTursoValue(cell: any): any {
  if (cell === null || cell === undefined) return null;
  if (typeof cell !== 'object') return cell;
  const { type, value } = cell;
  switch (type) {
    case 'null':
      return null;
    case 'integer':
      return Number(value);
    case 'float':
      return Number(value);
    case 'text':
      return value;
    case 'blob':
      return value;
    default:
      return value;
  }
}

// ============ HELPERS ============

function rowsOf(body: any): any[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  const candidate = body.rows ?? body.data ?? body.results;
  return Array.isArray(candidate) ? candidate : [];
}

function rowCountOf(body: any, rows: any[]): number {
  if (body && typeof body === 'object' && typeof body.rowCount === 'number') return body.rowCount;
  return rows.length;
}

function remoteError(message: string, code = 'HTTP_REMOTE_ERROR'): VaError {
  return new VaError(message, { code });
}

/**
 * Gabung baris array + daftar kolom jadi objek.
 *
 * Beberapa API (Neon, libSQL) mengirim `rows` sebagai array-of-arrays
 * beserta `fields` terpisah — bukan objek per baris.
 */
export function rowsToObjects(rows: any[], fields: any[]): any[] {
  if (!fields || fields.length === 0) return rows;
  return rows.map((row) => {
    if (!Array.isArray(row)) return row;
    const obj: Record<string, any> = {};
    row.forEach((value, index) => {
      const field = fields[index];
      const name = typeof field === 'string' ? field : (field?.name ?? `col${index}`);
      obj[name] = value;
    });
    return obj;
  });
}

// ============ PROFILES ============

/**
 * Protokol generik — "{sql, params}".
 *
 * Response diterima dalam beberapa bentuk supaya endpoint apa pun yang
 * mengikuti konvensi umum langsung jalan: `{rows}`, `{data}`, `{results}`,
 * atau array polos.
 */
const genericProfile: HttpProtocolProfile = {
  name: 'generic',
  dialect: 'postgres',
  placeholder: 'numbered',
  supportsSession: false,
  buildBody: (sql, params) => ({ sql, params }),
  mapResponse: (body) => {
    const rows = rowsOf(body);
    return { rows, rowCount: rowCountOf(body, rows) };
  },
};

/**
 * Neon serverless over HTTP — "{query, params}".
 *
 * Respons Neon (bentuk mentah)irim `rows` sebagai array-of-arrays plus
 * `fields` terpisah:
 *
 * ```jsonc
 * { "command": "SELECT", "fields": [{ "name": "id" }], "rowCount": 1, "rows": [[1]] }
 * ```
 *
 * Driver ini juga menerima bentuk objek-per-baris (kalau server sudah
 * melakukan serialisasi objek sendiri).
 */
const neonProfile: HttpProtocolProfile = {
  name: 'neon',
  dialect: 'postgres',
  placeholder: 'numbered',
  supportsSession: false,
  buildBody: (sql, params) => ({ query: sql, params }),
  mapResponse: (body) => {
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) {
      throw remoteError(`neon query failed: ${body.error}`);
    }
    const fields = Array.isArray(body?.fields) ? body.fields : [];
    const raw = rowsOf(body);
    const rows = rowsToObjects(raw, fields);
    return { rows, rowCount: rowCountOf(body, rows) };
  },
};

/** Prisma Accelerate — "{query, params}" → "{data, error?, meta?}". */
const accelerateProfile: HttpProtocolProfile = {
  name: 'accelerate',
  dialect: 'postgres',
  placeholder: 'numbered',
  supportsSession: false,
  buildBody: (sql, params) => ({ query: sql, params }),
  mapResponse: (body) => {
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) {
      throw remoteError(`accelerate query failed: ${body.error}`);
    }
    const rows = rowsOf(body);
    return { rows, rowCount: rows.length };
  },
};

/** Cloudflare D1 — "{sql, params}" → "{result: [{results, success, meta}]}". */
const d1Profile: HttpProtocolProfile = {
  name: 'd1',
  dialect: 'sqlite',
  placeholder: 'positional',
  supportsSession: false,
  buildBody: (sql, params) => ({ sql, params }),
  mapResponse: (body) => {
    const entry = body?.result?.[0];
    if (body?.success === false || entry?.success === false) {
      const detail = body?.errors ?? body?.messages ?? [];
      throw remoteError(`d1 query failed: ${JSON.stringify(detail)}`);
    }
    const rows = Array.isArray(entry?.results) ? entry.results : [];
    const changes = entry?.meta?.changes ?? 0;
    // SELECT → jumlah rows; UPDATE/DELETE tanpa RETURNING → meta.changes.
    return { rows, rowCount: rows.length || changes };
  },
};

/**
 * Turso / libSQL — pipeline Hrana v2.
 *
 * `POST /v2/pipeline` dengan body:
 * `{baton, requests: [{type:'execute', stmt:{sql, args}}, {type:'close'}]}`
 */
const tursoProfile: HttpProtocolProfile = {
  name: 'turso',
  dialect: 'sqlite',
  placeholder: 'positional',
  path: '/v2/pipeline',
  supportsSession: true,
  buildBody: (sql, params, ctx) => {
    const requests: any[] = [
      {
        type: 'execute',
        stmt: {
          sql,
          args: (params ?? []).map((p) => encodeTursoValue(p)),
        },
      },
    ];
    if (ctx.close) requests.push({ type: 'close' });
    return { baton: ctx.baton ?? null, requests };
  },
  mapResponse: (body) => {
    const entry = body?.results?.[0];
    if (entry?.type === 'error') {
      throw remoteError(`turso query failed: ${entry?.error?.message ?? 'unknown error'}`);
    }
    const result = entry?.response?.result ?? {};
    const cols: string[] = (result.cols ?? []).map((c: any) => c?.name);
    // Nilai libSQL bertipe {type, value} -> decode dulu, baru jadi objek.
    const decoded = (result.rows ?? []).map((row: any[]) =>
      (row ?? []).map((cell: any) => decodeTursoValue(cell)),
    );
    const rows = rowsToObjects(decoded, cols);
    const affected = result.affected_row_count ?? 0;
    return { rows, rowCount: rows.length || affected, baton: body?.baton ?? null };
  },
};

export const HTTP_PROFILES: Record<HttpProtocolName, HttpProtocolProfile> = {
  generic: genericProfile,
  neon: neonProfile,
  accelerate: accelerateProfile,
  d1: d1Profile,
  turso: tursoProfile,
};

/**
 * Deteksi protocol dari URL endpoint.
 *
 * Dipakai saat `protocol` tidak diberikan — supaya `driver: 'http'` cukup
 * dengan satu DSN tanpa konfigurasi tambahan.
 */
export function detectHttpProtocol(url: string): HttpProtocolName {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return 'generic';
  }
  if (host.includes('turso.io')) return 'turso';
  if (host.includes('api.cloudflare.com')) return 'd1';
  if (host.includes('neon.tech')) return 'neon';
  if (host.includes('prisma-data.net') || host.includes('prisma.io')) return 'accelerate';
  return 'generic';
}

/**
 * Resolve profile final: profile bawaan + override dialect/placeholder/path
 * dari opsi user.
 */
export function resolveHttpProfile(options: HttpClientOptions = {}): HttpProtocolProfile {
  const name = options.protocol ?? 'generic';
  const base = HTTP_PROFILES[name];
  if (!base) {
    throw new VaError(`Unknown http protocol: ${name}`, { code: 'HTTP_PROTOCOL_UNKNOWN' });
  }
  return {
    ...base,
    dialect: options.dialect ?? base.dialect,
    placeholder: options.placeholder ?? base.placeholder,
    path: options.path ?? base.path,
  };
}
