# HTTP Connector (SQL over HTTP)

Konektor http menjalankan SQL lewat endpoint `http://` / `https://` alih-alih
koneksi TCP. Berguna untuk:

- **Serverless / edge** — Cloudflare Workers, Vercel Edge, Lambda, Bun Deploy
- **Postgres HTTP** — Neon serverless, Prisma Accelerate
- **SQLite HTTP** — Cloudflare D1, Turso/libSQL
- **Gateway sendiri** — proxy SQL-over-HTTP di depan database internal

Kontrak `DatabaseDriver` tetap sama (`sql` + `params`), jadi **Repository,
QueryBuilder, relation, pagination, dan CLI tidak berubah** — yang berubah
hanya cara statement dikirim ke server.

> **Zero dependency.** Memakai global `fetch` (Node 18+, Bun, Workers).

---

## Quick Start

```typescript
import { VaClient } from '@v-va/orm';

const va = VaClient.create({
  driver: 'http',
  dsn: 'https://ep-cool-name-a1b2c3d4.us-east-2.aws.neon.tech/sql',
  http: { authToken: process.env.DATABASE_TOKEN },
  models: { user: { tableName: 'users' } },
});

const users = await va.repository('user').findMany({ limit: 10 });
```

Protocol **deteksi otomatis dari host URL**:

| Host mengandung | Protocol | Dialect | Placeholder |
|------------------|----------|---------|-------------|
| `*.turso.io` | `turso` | sqlite | `?` |
| `api.cloudflare.com` | `d1` | sqlite | `?` |
| `*.neon.tech` | `neon` | postgres | `$1` |
| `*.prisma-data.net` | `accelerate` | postgres | `$1` |
| lainnya | `generic` | postgres | `$1` |

Override manual:

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: 'https://sql.internal.company/query',
  http: {
    protocol: 'generic',
    dialect: 'postgres',
    authToken: process.env.DATABASE_TOKEN,
  },
  models: { user: { tableName: 'users' } },
});
```

---

## Memilih Provider

| Provider | Engine | Transaction | Catatan |
|----------|--------|-------------|---------|
| Neon | Postgres | ✗ (batch saja) | Butuh header `Neon-Connection-String` |
| Prisma Accelerate | Postgres | ✗ | URL membawa `?api_key=` |
| Cloudflare D1 | SQLite | ✗ | Token Cloudflare sebagai Bearer |
| Turso / libSQL | SQLite | ✓ (stream) | Interactive transaction didukung |
| Gateway sendiri | Tergantung | Tergantung | Pakai `generic` + `buildBody`/`mapResponse` |

---

## Setup per Provider

### Neon (Postgres)

Neon menerima SQL lewat HTTP dan **butuh connection string lengkap di header**.

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: 'https://<endpoint-host>/sql',
  http: {
    protocol: 'neon',
    // Wajib: header ini membawa host + kredensial + nama database.
    headers: { 'Neon-Connection-String': process.env.DATABASE_URL! },
  },
  models: { user: { tableName: 'users' } },
});
```

> **Catatan URL.** Driver resmi `@neondatabase/serverless` menulis ulang label
> pertama host menjadi `api.` (atau `apiauth.` untuk JWT), jadi endpoint-nya
> bisa berbentuk `https://api.<region>.aws.neon.tech/sql`. Kalau `https://<host>/sql`
> memberi 404, coba bentuk `api.`. Header `Neon-Connection-String` tetap wajib
> di kedua bentuk.

Body request: `{ query, params }`. Response Neon berisi `rows` sebagai
**array-of-arrays** + `fields` terpisah — driver VA-ORM otomatis menggabungkan
keduanya jadi objek per baris.

### Prisma Accelerate (Postgres)

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: 'https://<project>.prisma-data.net/?api_key=<KEY>',
  http: { protocol: 'accelerate' },
  models: { user: { tableName: 'users' } },
});
```

Body: `{ query, params }` → response `{ data, error?, meta? }`.

### Cloudflare D1 (SQLite)

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: 'https://api.cloudflare.com/client/v4/accounts/<account>/d1/database/<db-id>/query',
  http: {
    protocol: 'd1',
    authToken: process.env.CLOUDFLARE_API_TOKEN,
  },
  models: { user: { tableName: 'users' } },
});
```

Body: `{ sql, params }` → response `{ result: [{ results, success, meta }] }`.
`rowCount` memakai `results.length`, dan kalau kosong memakai `meta.changes`
(kasus UPDATE/DELETE tanpa `RETURNING`).

### Turso / libSQL (SQLite)

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: 'https://<db>-<org>.turso.io',
  http: {
    protocol: 'turso',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
  models: { user: { tableName: 'users' } },
});
```

Path `/v2/pipeline` otomatis ditambahkan. Body:

```jsonc
{
  "baton": null,
  "requests": [
    { "type": "execute", "stmt": { "sql": "SELECT * FROM users WHERE id = ?", "args": [{ "type": "integer", "value": "1" }] } },
    { "type": "close" }
  ]
}
```

Nilai libSQL bertipe (`{type, value}`) dikodekan/didekode otomatis, dan baris
dikembalikan sebagai objek (bukan array).

### Gateway Sendiri (Generic)

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: 'https://sql.internal.company/query',
  http: {
    protocol: 'generic',
    dialect: 'postgres',
    buildBody: (sql, params) => ({ statement: sql, bindings: params }),
    mapResponse: (body) => ({
      rows: body.payload ?? [],
      rowCount: body.payload?.length ?? 0,
    }),
  },
  models: { user: { tableName: 'users' } },
});
```

### SQL Gateway + Cloudflare Access (Kasus Production)

Gateway SQL sendiri yang dilindungi Cloudflare Access (service token).
Header auth + header aplikasi digabung di `http.headers`:

```typescript
import { VaClient } from '@v-va/orm';

export const va = VaClient.create({
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
  models: {
    job: { tableName: 'scrape_jobs' },
  },
});
```

`.env`:

```bash
VA_HTTP_URL=https://sqlgw-xxxx.v-va.cc/sql
VA_HTTP_PROTOCOL=generic
VA_HTTP_DIALECT=postgres
VA_HTTP_TOKEN=...
CF_ACCESS_CLIENT_ID=...
CF_ACCESS_CLIENT_SECRET=...
```

Catatan untuk gateway seperti ini:

- **Satu statement per request.** Multi-statement (`SELECT 1; SELECT 2`) umumnya
  ditolak.
- **DDL sering diblokir** (`CREATE TABLE` → 422). Jalur `va db push` butuh
  endpoint yang mengizinkan DDL.
- Error datang sebagai `{"error":{"code":"..."}}` dengan status 4xx/5xx → ORM
  melempar `VaError` kode `HTTP_STATUS`.
- Batasan CHECK di server tetap berlaku — `INSERT` yang melanggar constraint
  akan gagal apa adanya.

```

---

## Konsep Penting

### 1. Dialect remote, bukan transport

`driver: 'http'` berarti **transport**-nya HTTP. Tapi SQL yang dikirim harus
mengikuti dialect engine di server:

- `postgres` → placeholder `$1`, quoting `"identifier"`
- `sqlite` → placeholder `?`, quoting `"identifier"`

`getDialect()` pada driver selalu mengembalikan dialect engine
(`postgres`/`sqlite`), bukan `'http'`. Konsekuensinya JSON search, quoting
identifier, dan generator DDL ikut benar.

### 2. Protocol ≠ Dialect

Keduanya terpisah dan bisa dicampur:

| Option | Arti |
|--------|------|
| `protocol` | **bentuk wire** request/response |
| `dialect` | **SQL** yang dikirim (placeholder, quoting, JSON) |
| `placeholder` | gaya placeholder (default ikut dialect/protocol) |

Contoh: pipeline Hrana (`protocol: 'turso'`) yang membawa SQL Postgres:

```typescript
http: { protocol: 'turso', dialect: 'postgres', placeholder: 'numbered' }
```

### 3. Transport HTTP bersifat stateless

Interactive transaction (`BEGIN` … `COMMIT` spanning banyak request) hanya
mungkin kalau protocol mendukung **session/stream**:

| Protocol | Session | `transaction()` |
|----------|---------|-----------------|
| `generic` | ✗ | error `HTTP_TRANSACTION_UNSUPPORTED` |
| `neon` | ✗ | error |
| `accelerate` | ✗ | error |
| `d1` | ✗ | error |
| `turso` | ✓ (baton/stream) | berjalan — `BEGIN`/`COMMIT` di stream yang sama |

Driver **tidak** diam-diam menjalankan transaksi tanpa rollback. Kalau protocol
tidak mendukung session, `transaction()` melempar error eksplisit.

Untuk protocol stateless, pakai batch API yang disediakan server (mis.
`neon` transaction array, D1 `batch`, Turso pipeline) — bukan `va.transaction()`.

> **Jalur schema-aware tetap jalan.** `va.model('user').create(...)` dan
> `update(...)` biasanya dibungkus transaction. Pada driver tanpa session,
> ORM membaca kapabilitas `supportsTransactions` dan **menjalankan operasi
> langsung** (tanpa transaction) alih-alih melempar error — jadi delegate
> Prisma-style tetap bisa dipakai di protocol stateless. Untuk operasi
> multi-tabel (nested write) yang butuh atomisitas, pakai protocol ber-session
> (`turso`) atau batch API server.

### 4. Pooling tidak berarti koneksi

`ConnectionPool` untuk transport http = batas konkurensi request HTTP, bukan
koneksi database. Default yang dipakai:

| Setting | Default untuk http | Alasan |
|---------|--------------------|--------|
| `min` | `1` | satu http client cukup |
| `healthCheck` | `false` | health check = 1 query per interval ke API berbayar |
| `max` | `20` | batas request http paralel |

Health check bisa dinyalakan ulang: `connection: { healthCheck: true }`.

### 5. `RETURNING *`

Repository memakai `RETURNING *` untuk create/update/delete. Semua target
bawaan mendukungnya (Postgres, D1, Turso/libSQL ≥ 3.35). Kalau backend custom
tidak mendukung, pakai `raw()` atau `updateMany()` (tanpa `RETURNING`).

### 6. Berapa request per operasi?

Karena transportnya HTTP, jumlah round-trip = jumlah statement. Angka ini
diukur langsung (`sandbox/va-orm-http-e2e/measure-hits.ts`):

| Operasi | HTTP request |
|---------|--------------|
| `findUnique`, `findFirst`, `findMany` | 1 |
| `count`, `exists` | 1 |
| `create`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, `deleteAll` | 1 |
| `raw`, `rawOne`, `rawExecute` | 1 |
| `createMany(n baris)` | **n** (satu INSERT per baris) |
| `paginate` | 2 (`findMany` + `count`, dijalankan paralel) |
| `model().findMany({ include })` | 1 + 1 per level relasi (**bukan N+1**) |
| `model().count`, `aggregate`, `groupBy` | 1 |
| `model().create` (delegate) | 1 |
| `model().create` + nested write | 1 per tabel, **tanpa atomisitas** di protocol stateless |
| `transaction()` (protocol session) | 3 (`BEGIN` + statement + `COMMIT`) |

> **`createMany` di transport HTTP** = 1 request per baris. Kalau insert
> banyak jadi bottleneck, pakai batch API server (`{ batch: [...] }` untuk D1,
> `requests[]` untuk turso) lewat `raw()`.

---

## Opsi

```typescript
interface HttpClientOptions {
  protocol?: 'generic' | 'neon' | 'accelerate' | 'd1' | 'turso';
  dialect?: 'postgres' | 'sqlite';
  placeholder?: 'numbered' | 'positional';
  headers?: Record<string, string>;
  authToken?: string;
  timeoutMs?: number;      // default 30000
  path?: string;           // mis. '/v2/pipeline'
  fetch?: typeof fetch;    // custom transport / testing
  buildBody?: (sql, params, ctx) => unknown;
  mapResponse?: (body) => { rows, rowCount, baton? };
}
```

`ctx` pada `buildBody` berisi `baton` (session handle) dan `close` (tutup stream
setelah statement ini).

---

## Protocol Bawaan

| Protocol | Request | Response | Dialect | Placeholder |
|----------|---------|----------|---------|-------------|
| `generic` | `{sql, params}` | `{rows}` / `{data}` / `{results}` / array | postgres | `$1` |
| `neon` | `{query, params}` | `{fields, rows, rowCount}` (rows = array-of-arrays) | postgres | `$1` |
| `accelerate` | `{query, params}` | `{data, error?, meta?}` | postgres | `$1` |
| `d1` | `{sql, params}` | `{result: [{results, success, meta}]}` | sqlite | `?` |
| `turso` | `/v2/pipeline` | `{baton, results: [{type, response}]}` | sqlite | `?` |

---

## Integrasi Framework

Opsi `VaClientOptions` diteruskan apa adanya, jadi `driver: 'http'` langsung
dipakai di NestJS maupun Elysia.

### NestJS

```typescript
import { VaModule } from '@v-va/orm/nest';

VaModule.forRoot({
  driver: 'http',
  dsn: process.env.DATABASE_URL!,
  http: { protocol: 'neon', headers: { 'Neon-Connection-String': process.env.DATABASE_URL! } },
});
```

### Elysia / Bun

```typescript
import { createVaSingleton } from '@v-va/orm/elysia';

const va = createVaSingleton({
  driver: 'http',
  dsn: process.env.DATABASE_URL!,
  http: { protocol: 'neon' },
});
```

---

## Konfigurasi Env

```bash
# Neon
DATABASE_URL=postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/mydb
VA_HTTP_URL=https://ep-xxx.us-east-2.aws.neon.tech/sql
VA_HTTP_TOKEN=...
```

```typescript
const va = VaClient.create({
  driver: 'http',
  dsn: process.env.VA_HTTP_URL!,
  http: {
    protocol: (process.env.VA_HTTP_PROTOCOL as any) ?? undefined, // auto-detect
    authToken: process.env.VA_HTTP_TOKEN,
  },
  models: { user: { tableName: 'users' } },
});
```

---

## CLI

Deteksi transport dari `DATABASE_URL`:

```sh
DATABASE_URL=https://ep-x.neon.tech/sql bunx va db push
```

> **Pemisahan role DDL/DML.** Kalau aplikasi jalan via HTTP (role R/W) tapi
> `db push` butuh role DDL, pakai `MIGRATOR_DATABASE_URL` — CLI memakainya
> untuk `db push`/`migrate`/`db pull`:
>
> ```sh
> MIGRATOR_DATABASE_URL=postgresql://research_migrator:...@host/db \
>   bunx va db push --schema ./va.schema
> ```
>
> Detailnya di [10-cli.md](./10-cli.md).

Provider di `va.schema` menentukan driver + DDL:

```prisma
datasource db {
  provider = "http"          // transport http, DDL postgres
  url      = env("DATABASE_URL")
}
```

```prisma
datasource db {
  provider = "http+sqlite"   // transport http, DDL sqlite (D1/Turso)
  url      = env("DATABASE_URL")
}
```

Generated client otomatis memakai `driver: 'http'` + `http: { dialect }` yang
sesuai. Protocol tetap dideteksi dari host URL; override via env:

```sh
VA_HTTP_PROTOCOL=generic bunx va db push
```

---

## Error Handling

Semua error dibungkus `VaError` dengan kode yang jelas:

| Kode | Arti | Retry? |
|------|------|--------|
| `HTTP_STATUS` | server membalas non-2xx (body dipotong 500 char) | 4xx: **tidak** · 5xx: ya |
| `HTTP_INVALID_JSON` | response bukan JSON valid | ya |
| `HTTP_INVALID_URL` | URL bukan `http://` / `https://` | — |
| `HTTP_REMOTE_ERROR` | server balas error di dalam payload | ya |
| `HTTP_TRANSACTION_UNSUPPORTED` | protocol stateless, interactive tx tidak mungkin | — |
| `HTTP_ERROR` | network error / timeout | ya |

> **Kenapa 4xx tidak di-retry.** `ConnectionPool` default `retryMode: 'reads'`
> mengulang SELECT yang gagal. Untuk HTTP itu berbahaya: SQL yang salah (400)
> akan diulang 3x dengan backoff eksponensial — lambat dan membakar kuota API.
> Driver HTTP menandai error 4xx (kecuali 408/429) dengan `retryable: false`,
> dan pool menghormati penanda itu.

Secret tidak bocor: `Authorization` tidak pernah masuk pesan error, dan body
error di-redact lewat `VaError.redactSecrets`.

### Troubleshooting

| Gejala | Penyebab | Solusi |
|--------|----------|--------|
| `Unsupported driver: http` | artifact lama ter-install (versi sama dengan registry) | install ulang dari tarball dengan versi unik, atau `bun install --force` |
| `401 Unauthorized` | token/header auth tidak dikirim | cek `authToken` / `headers` |
| `404` di Neon | bentuk host endpoint | coba `https://api.<region>.aws.neon.tech/sql` |
| Rows kosong padahal ada data | respons server memakai bentuk lain | set `mapResponse` custom |
| `HTTP_TRANSACTION_UNSUPPORTED` | protocol stateless | pakai batch API server, atau `protocol: 'turso'` |
| Query lambat / timeout | `timeoutMs` default 30 detik | naikkan `http.timeoutMs`, atau cek latensi endpoint |
| `HTTP_STATUS 429` | rate limit | turunkan `connection.max` (limit request paralel) |

---

## Migrasi dari Postgres (TCP) ke HTTP

1. Ganti DSN:

```diff
- dsn: process.env.DATABASE_URL          // postgres://...
+ dsn: process.env.VA_HTTP_URL            // https://...
```

2. Ganti driver + tambah opsi http:

```diff
- driver: 'postgres',
+ driver: 'http',
+ http: { protocol: 'neon' },
```

3. Kalau pakai Neon, tambahkan header connection string:

```typescript
http: {
  protocol: 'neon',
  headers: { 'Neon-Connection-String': process.env.DATABASE_URL! },
}
```

4. Di `va.schema`, provider jadi `http` (atau `http+sqlite`):

```diff
- provider = "postgresql"
+ provider = "http"
```

5. Jalankan ulang `va generate` — kode repository **tidak berubah**.

---

## Testing

### Unit test (mock fetch)

```typescript
import { HttpDriver } from '@v-va/orm';

const calls: any[] = [];
const fetchMock = (async (url: any, init: any) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return new Response(JSON.stringify({ rows: [] }), { status: 200 });
}) as unknown as typeof fetch;

const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fetchMock });
await driver.query('SELECT 1');
expect(calls[0].body).toEqual({ query: 'SELECT 1', params: [] });
```

### E2E terisolasi

Repo ini punya sandbox e2e yang menguji konektor ini **tanpa menyentuh source**:

```
sandbox/
├── mini-pg-http/       # server SQL-over-HTTP (bridge PostgreSQL + mini engine)
└── va-orm-http-e2e/    # install @v-va/orm dari tarball -> test ke server
```

```sh
cd sandbox/va-orm-http-e2e && bun test
```

Yang diuji: CRUD lengkap, `count`/`exists`/`paginate`, `orderBy`+`limit`+`offset`,
`raw()`, propagasi error, protocol `generic`/`neon`/`turso`, dan **interactive
transaction** (COMMIT + ROLLBACK) terhadap PostgreSQL asli.

Detail lengkap: [sandbox/README.md](../../../sandbox/README.md).

---

## Manual

```ts
import { HttpDriver } from '@v-va/orm/drivers/http';

const driver = new HttpDriver('https://x.dev/query', {
  protocol: 'neon',
  authToken: process.env.DATABASE_TOKEN,
});
```
