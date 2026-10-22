# Sandbox — E2E Terisolasi untuk Konektor HTTP

Dua project terpisah dari `engine/va-orm`, untuk menguji konektor HTTP dengan
cara yang **meniru kondisi nyata** (bukan import dari source):

```
sandbox/
├── mini-pg-http/          # server SQL-over-HTTP (mini port postgres/sql)
├── va-orm-http-e2e/       # konsumen terisolasi: @v-va/orm dari tarball
├── pack-orm.sh            # build -> pack -> pasang ke project e2e
└── run-e2e.sh             # jalankan semua
```

## Kenapa "terisolasi"?

| Aspek | Isolasi |
|-------|---------|
| Sumber ORM | `@v-va/orm` di-install dari **tarball hasil `bun pm pack`** — bukan import dari `engine/va-orm/src` |
| Server | Jalan sebagai **proses terpisah** (`Bun.spawn`), bukan import in-process |
| Dependency | Project e2e punya `node_modules` sendiri; tidak menyentuh `node_modules` repo |
| Versi | Tarball di-rewrite jadi `<versi>-local` supaya tidak ketuker cache npm registry |

> Jebakan yang sudah pernah terjadi: kalau versi tarball sama dengan versi di
> registry, Bun bisa memakai artifact registry (yang lebih lama) → driver `http`
>"errors: Unsupported driver: http" padahal ada di source. Karena itu
> `pack-orm.sh` selalu memakai versi `-local`.

## 1. `mini-pg-http` — mini port PostgreSQL/SQL ke HTTP

Server SQL-over-HTTP yang **tidak mengimpor apa pun dari VA-ORM** (server pihak
ketiga, supaya benar-benar menguji kompatibilitas wire format).

Dua backend:

| Backend | Isi | Kebutuhan |
|---------|-----|------------|
| `memory` | Mini in-memory SQL engine (subset SQL: SELECT/INSERT/UPDATE/DELETE, WHERE, ORDER BY, LIMIT/OFFSET, COUNT, `RETURNING *`) | tanpa dependency |
| `postgres` | Bridge ke PostgreSQL sungguhan via `pg` | PostgreSQL lokal + `DATABASE_URL` |

Endpoint:

```
GET  /health        -> { ok, backend }
POST /sql           -> { sql|query, params }  =>  { rows, rowCount }
POST /v2/pipeline   -> pipeline Hrana/turso   =>  { baton, results }
```

`POST /v2/pipeline` juga mendukung **session**: `BEGIN` membuka satu koneksi
PostgreSQL (baton), statement berikutnya jalan di koneksi yang sama, `COMMIT`/
`ROLLBACK` menutupnya. Ini yang dipakai untuk menguji interactive transaction
lewat HTTP.

## 2. `va-orm-http-e2e` — konsumen terisolasi

```ts
import { VaClient } from '@v-va/orm';        // dari tarball, bukan source

const va = VaClient.create({
  driver: 'http',
  dsn: `${server.url}/sql`,
  http: { protocol: 'generic' },            // generic | neon | accelerate | d1 | turso
  models: { user: { tableName: 'users' } },
});
```

Skenario yang diuji:

- **CRUD lengkap** — `create`, `createMany`, `findUnique`, `findFirst`,
  `findMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`,
  `deleteAll`, `count`, `exists`, `paginate`, `cursorPaginate`, `raw`,
  `rawOne`, `rawExecute`
- **Logic query** — where majemuk (AND/OR), orderBy multi-field, limit/offset,
  aggregate (COUNT/SUM/AVG/MIN/MAX), groupBy
- **ModelDelegate** (jalur schema-aware) — findUnique/findFirst/findMany/
  count/exists/aggregate/groupBy/create/update
- **Relations** — `include` one-to-many, nested write
- error SQL → exception di caller (tanpa retry storm)
- protocol `generic`, `neon`, `turso`
- **interactive transaction** (COMMIT) dan **ROLLBACK** — backend postgres
- **DB remote sungguhan** (SQL gateway + Cloudflare Access) — CRUD penuh,
  aggregate, error handling, cleanup

Jumlah test: **66** (12 memory + 17 CRUD/logic memory + 17 CRUD/logic postgres
+ 10 postgres + 10 remote).

### Test ke DB remote

Butuh `engine/va-orm/va-orm.remote.local.env` (gitignored, isi kredensial).
Kalau file tidak ada → suite **di-skip**. Kalau ada tapi endpoint mati → test
**gagal loudly** (bukan skip diam-diam).

```sh
cd sandbox/va-orm-http-e2e && bun test test/remote-http.test.ts
```

Test ini memakai config produksi apa adanya:

```ts
VaClient.create({
  driver: 'http',
  dsn: process.env.VA_HTTP_URL!,
  http: {
    protocol: 'generic',
    dialect: 'postgres',
    authToken: process.env.VA_HTTP_TOKEN!,
    headers: {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID!,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET!,
    },
    timeoutMs: 8_000,
  },
  models: { job: { tableName: 'scrape_jobs' } },
});
```

Baris yang dibuat test (baris probe) **dihapus kembali** di `afterAll` — jumlah
baris tabel sebelum/sesudah test harus sama.

## Mengukur jumlah HTTP request per operasi

`sandbox/va-orm-http-e2e/measure-hits.ts` — menghitung round-trip HTTP per
panggilan ORM (berguna untuk meng budgeting biaya transport):

```sh
cd sandbox/va-orm-http-e2e && bun run measure-hits.ts
```

```
findUnique                              1 hit
findMany                                1 hit
count / exists                          1 hit
create / update / delete / upsert       1 hit
createMany (2 baris)                    2 hit   (1 INSERT per baris)
paginate                                2 hit   (findMany + count, paralel)
model().findMany + include              2 hit   (bukan N+1)
model().create + nested write           2 hit   (1 per tabel, tanpa atomisitas)
transaction (turso, session)            3 hit   (BEGIN | INSERT | COMMIT)
```

## Menjalankan

```sh
# semua (butuh PostgreSQL lokal)
createdb va_orm_http_e2e
./sandbox/run-e2e.sh

# hanya backend in-memory (tanpa database)
./sandbox/run-e2e.sh memory
```

Manual:

```sh
cd sandbox/va-orm-http-e2e
bun test                       # semua
bun test test/memory-http.test.ts
bun test test/postgres-http.test.ts

# server manual
cd sandbox/mini-pg-http
bun install
MINI_PG_BACKEND=memory PORT=8899 bun run src/server.ts
MINI_PG_BACKEND=postgres DATABASE_URL=postgres://localhost:5432/va_orm_http_e2e bun run src/server.ts
```

## Temuan yang muncul dari test terisolasi

| Temuan | Status |
|--------|--------|
| Registry npm menimpa artifact lokal (versi sama) | ✅ version di-rewrite `-local` |
| `repository()` di dalam `transaction()` memakai driver **lama** → write di luar transaksi, tidak ter-rollback | ✅ diperbaiki di `va.client.ts` |
| Driver tambahan bocor tiap `transaction()` (proses tidak exit) | ✅ ikut diperbaiki |
| Pool meng-retry error HTTP 4xx (7 detik backoff untuk SQL salah) | ✅ error 4xx kini `retryable: false` |
| README contoh `create({ data })` — salah, API-nya `create(data)` | ✅ diperbaiki |
| `model().create/update` selalu bungkus transaction → mati di protocol stateless | ✅ kapabilitas `supportsTransactions` |
| Loader relasi tidak cocok dengan key lowercase (Postgres fold identifier) | ✅ `pickField` + fallback |
| Schema parser hapus `//` di dalam string (`url = "postgres://..."`) | ✅ comment handling sadar string |
