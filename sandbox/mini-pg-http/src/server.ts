// Mini SQL-over-HTTP server.
//
// Menjalankan statement SQL lewat HTTP dan mengembalikan JSON. Dua backend:
//
//   MINI_PG_BACKEND=postgres  -> bridge ke PostgreSQL asli (butuh DATABASE_URL)
//   MINI_PG_BACKEND=memory    -> mini in-memory SQL engine (tanpa dependency)
//
// Endpoint:
//
//   GET  /health        -> { ok, backend }
//   POST /sql           -> { sql|query, params }  => { rows, rowCount }
//   POST /v2/pipeline   -> pipeline turso/libSQL  => { baton, results }
//
// Env:
//
//   PORT           (default 0 = random)
//   HOST           (default 127.0.0.1)
//   MINI_PG_BACKEND (postgres | memory)
//   DATABASE_URL   (postgres DSN, wajib untuk backend postgres)
//   MINI_PG_TOKEN  (kalau diisi, wajib kirim Authorization: Bearer <token>)

import { MemoryDatabase } from "./memory.js";
import { PostgresBridge } from "./pg-bridge.js";
import {
  MiniPgError,
  decodeLibsqlValue,
  genericResponse,
  normalizeQuery,
  pipelineError,
  pipelineResponse,
  type QueryResult,
} from "./protocol.js";

const PORT = Number(process.env.PORT ?? 0);
const HOST = process.env.HOST ?? "127.0.0.1";
const BACKEND = (
  process.env.MINI_PG_BACKEND ??
  (process.env.DATABASE_URL ? "postgres" : "memory")
).toLowerCase();
const TOKEN = process.env.MINI_PG_TOKEN ?? "";

const memory = new MemoryDatabase();
let bridge: PostgresBridge | null = null;

if (BACKEND === "postgres") {
  const dsn = process.env.DATABASE_URL;
  if (!dsn) {
    console.error("MINI_PG_BACKEND=postgres requires DATABASE_URL");
    process.exit(1);
  }
  bridge = new PostgresBridge(dsn);
}

// ============ BACKEND ============

async function run(
  sql: string,
  params: any[],
  baton: string | null,
): Promise<QueryResult> {
  if (process.env.MINI_PG_LOG) {
    console.error(`[mini-pg] ${sql} -- ${JSON.stringify(params)}`);
  }
  if (bridge) {
    return baton
      ? bridge.queryInSession(baton, sql, params)
      : bridge.query(sql, params);
  }
  return memory.execute(sql, params);
}

// ============ HTTP ============

function authorized(request: Request): boolean {
  if (!TOKEN) return true;
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${TOKEN}`;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleSql(request: Request): Promise<Response> {
  let query: { sql: string; params: any[] };
  try {
    query = normalizeQuery(await request.json());
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }

  try {
    const result = await run(query.sql, query.params, null);
    return json(genericResponse(result));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
}

async function handlePipeline(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch (error) {
    return json(
      pipelineError(error instanceof Error ? error.message : String(error)),
      400,
    );
  }

  const requests: any[] = Array.isArray(body?.requests) ? body.requests : [];
  let baton: string | null = body?.baton ?? null;
  const results: QueryResult[] = [];

  try {
    for (const requestItem of requests) {
      const type = requestItem?.type;
      if (type === "close") {
        if (baton && bridge) await bridge.release(baton);
        baton = null;
        break;
      }
      if (type !== "execute") continue;

      const sql: string = requestItem?.stmt?.sql ?? "";
      const args: any[] = (requestItem?.stmt?.args ?? []).map((arg: any) =>
        arg && typeof arg === "object" && "type" in arg
          ? decodeLibsqlValue(arg)
          : arg,
      );

      const statement = sql.trim().toUpperCase();
      if (statement === "BEGIN" || statement === "START TRANSACTION") {
        if (bridge) {
          baton = await bridge.begin();
        }
        results.push({ rows: [], rowCount: 0 });
        continue;
      }
      if (statement === "COMMIT") {
        if (bridge && baton) await bridge.commit(baton);
        baton = null;
        results.push({ rows: [], rowCount: 0 });
        continue;
      }
      if (statement === "ROLLBACK") {
        if (bridge && baton) await bridge.rollback(baton);
        baton = null;
        results.push({ rows: [], rowCount: 0 });
        continue;
      }

      const result = await run(sql, args, baton);
      results.push(result);
    }
  } catch (error) {
    // Session turso/Hrana: error reported di dalam `results`, bukan HTTP error.
    return json(
      pipelineError(error instanceof Error ? error.message : String(error)),
    );
  }

  return json(pipelineResponse(results, baton));
}

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(request) {
    const url = new URL(request.url);

    if (!authorized(request)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (url.pathname === "/health") {
      return json({ ok: true, backend: BACKEND });
    }
    if (url.pathname === "/sql" && request.method === "POST") {
      return handleSql(request);
    }
    if (url.pathname === "/v2/pipeline" && request.method === "POST") {
      return handlePipeline(request);
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(
  `MINI_PG_READY ${server.url.href.replace(/\/$/, "")} backend=${BACKEND}`,
);

const shutdown = async () => {
  await server.stop(true);
  if (bridge) await bridge.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export { server, memory, MiniPgError };
