// Mini SQL-over-HTTP — normalisasi request & encoding response.
//
// Server ini sengaja dibuat "server pihak ketiga": tidak mengimpor apa pun
// dari VA-ORM, hanya mengikuti wire format yang umum di industri.
//
// Format yang didukung:
//
// 1. generic / neon / accelerate
//    POST /sql
//    request  { sql | query: string, params: any[] }
//    response { rows: any[], rowCount: number }
//
// 2. turso / libSQL (Hrana v2 pipeline)
//    POST /v2/pipeline
//    request  { baton, requests: [{type:'execute', stmt:{sql, args}}, {type:'close'}] }
//    response { baton, results: [{type:'ok', response:{type:'execute', result:{cols, rows, affected_row_count}}}] }
//
// Nilai argumen turso memakai tipe libSQL `{type, value}`.

export interface NormalizedQuery {
  sql: string;
  params: any[];
}

export interface QueryResult {
  rows: any[];
  rowCount: number;
}

export class MiniPgError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "MiniPgError";
  }
}

/** Ambil statement pertama dari body ber Various bentuk. */
export function normalizeQuery(body: any): NormalizedQuery {
  if (!body || typeof body !== "object") {
    throw new MiniPgError("body must be a JSON object");
  }

  const sql = body.sql ?? body.query ?? body.statement;
  if (typeof sql !== "string" || sql.trim() === "") {
    throw new MiniPgError('missing "sql" (or "query") in request body');
  }

  const rawParams = body.params ?? body.bindings ?? body.values ?? [];
  if (!Array.isArray(rawParams)) {
    throw new MiniPgError('"params" must be an array');
  }

  return { sql, params: rawParams };
}

/** Decode `{type, value}` libSQL → nilai JS. */
export function decodeLibsqlValue(cell: any): any {
  if (cell === null || cell === undefined) return null;
  if (typeof cell !== "object") return cell;
  const { type, value } = cell;
  switch (type) {
    case "null":
      return null;
    case "integer":
      return Number(value);
    case "float":
      return Number(value);
    case "text":
      return value;
    case "blob":
      return value;
    default:
      return value;
  }
}

/** Encode nilai JS → `{type, value}` libSQL. */
export function encodeLibsqlValue(value: unknown): {
  type: string;
  value: string | null;
} {
  if (value === null || value === undefined)
    return { type: "null", value: null };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value: String(value) };
  }
  if (typeof value === "boolean")
    return { type: "integer", value: value ? "1" : "0" };
  if (typeof value === "string") return { type: "text", value };
  if (value instanceof Date)
    return { type: "text", value: value.toISOString() };
  if (typeof value === "object")
    return { type: "text", value: JSON.stringify(value) };
  return { type: "text", value: String(value) };
}

/** Bentuk response generic/neon. */
export function genericResponse(result: QueryResult) {
  return { rows: result.rows, rowCount: result.rowCount };
}

/**
 * Bentuk response turso pipeline.
 *
 * `rows` pada protocol turso berupa array-of-arrays, kolom diambil dari `cols`.
 */
export function pipelineResponse(
  results: QueryResult[],
  baton: string | null = null,
) {
  return {
    baton,
    base_url: null,
    results: results.map((result) => ({
      type: "ok",
      response: {
        type: "execute",
        result: {
          cols:
            result.rows.length > 0
              ? Object.keys(result.rows[0]).map((name) => ({ name }))
              : [],
          rows: result.rows.map((row) =>
            Object.entries(row).map(([, value]) => encodeLibsqlValue(value)),
          ),
          affected_row_count: result.rowCount,
          last_insert_rowid: null,
        },
      },
    })),
  };
}

/** Error turso (dipakai saat statement gagal di dalam pipeline). */
export function pipelineError(message: string) {
  return {
    baton: null,
    base_url: null,
    results: [
      {
        type: "error",
        error: { message, code: "SQLITE_ERROR" },
      },
    ],
  };
}
