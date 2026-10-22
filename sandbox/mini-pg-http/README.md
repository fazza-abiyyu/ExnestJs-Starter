# mini-pg-http

Mini **SQL-over-HTTP server** — "mini port" PostgreSQL/SQL ke HTTP.

Server ini sengaja dibuat seperti **server pihak ketiga**:

- tidak mengimpor apa pun dari `@v-va/orm`
- hanya mengikuti wire format yang umum (generic/neon/accelerate/d1/turso)
- dipakai untuk menguji konektor HTTP VA-ORM di environment terisolasi

## Backend

| `MINI_PG_BACKEND` | Fungsi |
|-------------------|--------|
| `memory` (default tanpa `DATABASE_URL`) | Mini in-memory SQL engine — subset SQL, tanpa dependency |
| `postgres` | Bridge ke PostgreSQL sungguhan via `pg` |

## Env

| Variabel | Default | Keterangan |
|----------|---------|------------|
| `PORT` | `0` (random) | Port HTTP |
| `HOST` | `127.0.0.1` | Host bind |
| `MINI_PG_BACKEND` | `postgres` bila `DATABASE_URL` ada, else `memory` | Backend |
| `DATABASE_URL` | — | DSN PostgreSQL (wajib untuk backend `postgres`) |
| `MINI_PG_TOKEN` | — | Kalau diisi, wajib kirim `Authorization: Bearer <token>` |

## Endpoint

```http
GET  /health
POST /sql
POST /v2/pipeline
```

### `POST /sql` (generic / neon / accelerate)

```jsonc
// request
{ "sql": "SELECT * FROM users WHERE id = $1", "params": [1] }
// atau
{ "query": "SELECT * FROM users WHERE id = $1", "params": [1] }

// response
{ "rows": [{ "id": 1 }], "rowCount": 1 }
```

Error → HTTP 400 dengan `{ "error": "..." }`.

### `POST /v2/pipeline` (turso / libSQL Hrana v2)

```jsonc
// request
{
  "baton": null,
  "requests": [
    { "type": "execute", "stmt": { "sql": "SELECT 1" } },
    { "type": "close" }
  ]
}

// response
{
  "baton": null,
  "base_url": null,
  "results": [
    { "type": "ok", "response": { "type": "execute", "result": { "cols": [], "rows": [], "affected_row_count": 0 } } }
  ]
}
```

Error statement reported di dalam `results` (`type: "error"`), HTTP tetap 200 —
sesuai spec Hrana.

Session: `BEGIN` membuka satu koneksi PostgreSQL dan mengembalikan `baton`;
statement berikutnya (dengan `baton` yang sama) jalan di koneksi itu;
`COMMIT` / `ROLLBACK` menutupnya. `close` melepas sesi.

## Contoh

```sh
bun install
MINI_PG_BACKEND=memory PORT=8899 bun run src/server.ts

curl -X POST http://127.0.0.1:8899/sql \
  -H 'content-type: application/json' \
  -d '{"sql":"INSERT INTO \"users\" (\"email\") VALUES ($1) RETURNING *","params":["a@x.dev"]}'
```

## Batasan mini engine (backend `memory`)

SQL yang didukung:

- `SELECT 1`
- `SELECT * | <cols> | COUNT(*) [AS alias] FROM "t" [WHERE ...] [ORDER BY ...] [LIMIT n] [OFFSET n]`
- `INSERT INTO "t" ("a","b") VALUES ($1,$2) [RETURNING *]`
- `UPDATE "t" SET "a" = $1 [WHERE ...] [RETURNING *]`
- `DELETE FROM "t" [WHERE ...] [RETURNING *]`
- `CREATE TABLE` / `TRUNCATE` / `DROP TABLE`

WHERE: `= != > >= < <=`, `IS [NOT] NULL`, `LIKE`, `IN (...)`, digabung `AND`/`OR`
(precedence AND > OR). Placeholder `?` (posisional) otomatis dinormalisasi ke
`$n`.

Yang **tidak** didukung: JOIN, GROUP BY, subquery, agregat selain `COUNT(*)`,
index, constraint. Untuk itu pakai backend `postgres`.
