# Security Plan & Audit

Rencana remediation keamanan VA-ORM berdasarkan audit otomatis (`scripts/security-audit.ts`).

**Status baseline:** CRITICAL=2 · HIGH (confirmed) · MEDIUM · LOW  
**Status Phase 0–3:** selesai — `CRITICAL=0`, `HIGH=0` (dynamic); CI gate aktif  
**Scanner:** `bun scripts/security-audit.ts`  
**Tanggal audit:** 2026-09-13

---

## Ringkasan eksekutif

VA-ORM sudah punya mitigasi inti yang solid untuk **identifier injection** (quoting + allowlist operator). Namun ada beberapa jalur yang masih mengizinkan **SQL injection eksplisit**, **path traversal**, dan **integrity bug** di connection pool.

| Severity | Count | Arti |
|----------|-------|------|
| CRITICAL | 2 | Exploit PoC terbukti di codebase |
| HIGH | ~10 issue unik | Serius; perbaiki sebelum production go-live |
| MEDIUM | ~10 issue | Hardening; jangan tunda terlalu lama |
| LOW | 2 | Defense-in-depth / hygiene |

**Target DoD security:** `bun scripts/security-audit.ts` → CRITICAL=0, HIGH=0.

---

## Threat model (ringkas)

| Asal ancaman | Contoh input | Jalur ke DB |
|--------------|--------------|-------------|
| HTTP query/body | `orderBy`, `where`, `$filter`, `$skiptoken` | Repository / adapters |
| App code salah pakai | `raw()`, `search({ where })`, `select()` | RawQuery / QueryBuilder |
| CLI / CI | `migrate create --name`, migration file | Migrator / fs |
| Network blip | retry pool | ConnectionPool |

ORM **tidak** menggantikan authn/authz aplikasi. Asumsi: identifier developer-controlled, value user-controlled → harus parameterized.

---

## Mitigasi yang SUDAH bekerja

Jangan dihapus / di-regress:

| Kontrol | Lokasi | Cegah |
|---------|--------|-------|
| `quoteColumn` / `quoteTable` | `relation/quote.ts` | Identifier breakout (`"`, `` ` ``) |
| Operator allowlist | `core/expression.ts` `assertSafeOperator` | Operator SQL liar |
| ORDER BY direction allowlist | `assertSafeDirection` | `direction=asc; DROP…` |
| LIMIT/OFFSET integer guard | `assertSafeInteger` | Numeric SQLi |
| Value parameterized (mayoritas) | Repository / ExpressionBuilder | Classic `' OR 1=1` di value |
| Live SQLite containment tests | `__tests__/sql-injection.spec.ts` | Regression breakout |

---

## CRITICAL

### C1 — SQL injection: `tsHeadline` startSel / stopSel

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/raw/raw-query.ts` |
| **Baris** | ~84–95 (`tsHeadline`, juga pola sama di `search()` headlineOptions) |
| **CWE** | CWE-89 |
| **PoC** | `startSel: "x') , (SELECT 1), StartSel=('"` |

**Bukti (dari scanner):**

```text
ts_headline(..., 'StartSel='x') , (SELECT 1), StartSel=('', StopSel='y'')
```

**Root cause:** `startSel` / `stopSel` di-interpolasi ke string literal SQL tanpa `escapeLiteral()`.

**Remediation:**

```ts
if (options.startSel) parts.push(`StartSel='${escapeLiteral(options.startSel)}'`)
if (options.stopSel) parts.push(`StopSel='${escapeLiteral(options.stopSel)}'`)
```

Atau bind sebagai parameter PG (lebih disukai bila driver mendukung).

**Test:** unit — payload quote-breakout harus tetap di dalam literal / throw; query final tidak berisi subquery mentah.

**Estimasi:** 1–2 jam.

---

### C2 — SQL injection: `quoteSelect` bypass via `(`

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/core/query-builder.ts` |
| **Baris** | ~160 (`quoteSelect`) |
| **CWE** | CWE-89 |
| **PoC** | `select('COUNT(*) FROM users; DROP TABLE users; --')` |

**Bukti:**

```sql
SELECT COUNT(*) FROM users; DROP TABLE users; --, "name" FROM "users"
```

**Root cause:**

```ts
if (trimmed === '*' || trimmed.includes('(')) return trimmed
```

Kolom apa pun yang mengandung `(` lolos tanpa quoting.

**Remediation:**

1. Hapus bypass “apa pun dengan `(`”.
2. Allowlist pola fungsi agregat saja, contoh:
   - `COUNT(*)`, `COUNT(expr)`
   - `SUM|AVG|MIN|MAX(...)`
3. Sisanya: `quoteColumn` atau throw.

**Test:** payload dengan `;` / `DROP` harus reject atau jadi identifier inert.

**Estimasi:** 2–3 jam.

---

## HIGH

### H1 — Path traversal di migrator

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/migration/migrator.ts` |
| **Baris** | ~109–127 (`createMigration`), ~175–192 (`loadMigration`) |
| **CWE** | CWE-22 |

**Root cause:** `path.join(migrationsDir, `${name}.sql`)` tanpa verifikasi hasil tetap di base dir. `name=../../tmp/evil` → tulis/baca di luar folder migrations.

**Remediation:**

```ts
const base = path.resolve(this.migrationsDir)
const safe = path.resolve(base, `${name}.sql`)
if (!safe.startsWith(base + path.sep)) throw new Error('Invalid migration name')
if (!/^[\w-]+$/.test(name)) throw new Error('Migration name must match /^[\\w-]+$/')
```

**Estimasi:** 2 jam.

---

### H2 — `search()` where fragment mentah

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/raw/raw-query.ts` |
| **Baris** | ~141–143 |

```ts
sql += ` AND ${options.where}`
```

**Risk:** Jika app meneruskan filter HTTP ke `where`, ini SQLi penuh.

**Remediation:**

- Long-term: ganti `where?: string` → `where?: (eb: ExpressionBuilder) => void`
- Short-term: JSDoc `@remarks trusted developer SQL only` + audit call-site + ESLint ban di app

**Estimasi:** 2 jam (API) + migration consumer.

---

### H3 — `ExpressionBuilder.raw()` tanpa guard

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/core/expression.ts` |
| **Baris** | ~172 |

Escape hatch intentional, tetapi mudah salah pakai.

**Remediation:**

- Rename → `rawUnsafe()` (breaking) **atau** pertahankan `raw` + `@remarks trusted-only`
- Mode dev: reject `;`, `UNION`, `--` jika diaktifkan
- Docs: contoh aman vs berbahaya

**Estimasi:** 1 jam.

---

### H4 — Connection pool: retry non-idempotent

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/core/connection.pool.ts` |
| **Baris** | `query` / `execute` retry loop (~226+) |

**Risk:** INSERT/UPDATE yang sudah commit di server lalu koneksi putus → retry = **double write**.

**Remediation:**

- Default: retry **hanya** untuk read (`SELECT` / `WITH … SELECT`)
- Write: no auto-retry, atau retry hanya error klasik *sebelum* server terima statement (policy eksplisit)
- Config: `retryMode: 'reads' | 'none' | 'all'` (default `reads`)

**Estimasi:** 3 jam.

---

### H5 — Connection pool: acquire race → koneksi meledak

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/core/connection.pool.ts` |
| **Baris** | `acquire()` ~139–180 |

**Root cause:** `acquire` `splice` koneksi dari `connections[]`; selama in-use, `connections.length` turun sehingga `length < max` mengizinkan `createConnection` baru → concurrent load bisa membuat >> max koneksi (resource exhaustion).

**Remediation:**

- Track `idle[]` + `inUseCount` (atau Set in-use)
- Cap: `idle + inUse <= max`
- Release: kembalikan ke idle **atau** handoff ke waiter; jangan pernah melebihi max

**Estimasi:** 3 jam.

---

### H6 — Migrator hardcode placeholder `$1`

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/migration/migrator.ts` |

`DELETE … WHERE name = $1` / `INSERT … VALUES ($1)` — hanya valid di PostgreSQL.

**Remediation:** `this.driver.getPlaceholder(1)`.

**Estimasi:** 1 jam.

---

### H7 — Migration `split(';')` naive

| Field | Value |
|-------|--------|
| **File** | `packages/client/src/migration/migrator.ts` `applyMigration` / `rollbackMigration` |

Pemisahan statement per `;` merusak string literal, dollar-quoted body, comment, trigger.

**Remediation:**

- Prefer: eksekusi file utuh via API multi-statement driver
- Atau: SQL statement splitter yang benar (state machine)

**Estimasi:** 3–4 jam.

---

## MEDIUM

| ID | Issue | File | Remediation |
|----|--------|------|-------------|
| M1 | Prototype pollution OData `parseFilter` | `odata.adapter.ts` | Block `__proto__`/`constructor`/`prototype`; `Object.create(null)` |
| M2 | `JSON.parse($skiptoken)` / GraphQL cursor | `odata`/`graphql`/`rest` adapters | Reviver drop key berbahaya; validasi shape |
| M3 | `escapeLiteral` incomplete untuk MySQL | `raw-query.ts` | Escape `\\` juga / bind language / `NO_BACKSLASH_ESCAPES` |
| M4 | Advisory lock fail-open | `nested.writes.ts` | MySQL `GET_LOCK`; SQLite `BEGIN IMMEDIATE`; jangan silent-skip |
| M5 | `createMany` kolom dari item pertama | `repository.ts` | Validasi key set identik / multi-VALUES aman |
| M6 | Nested TX tanpa SAVEPOINT | drivers | SAVEPOINT / ROLLBACK TO SAVEPOINT |
| M7 | LIKE `%` `_` unescaped | `relation/filters.ts` | `escapeLike()` |
| M8 | Empty WHERE tanpa guard explicit | `repository.ts` | Throw jika `Object.keys(where).length === 0` |
| M9 | Driver error leak ke caller | drivers | Typed `VaError`; redact SQL/params di production |
| M10 | JOIN `ON` raw string | `query-builder.ts` | Typed join helper; larang ON dari HTTP |

---

## LOW

| ID | Issue | Remediation |
|----|--------|-------------|
| L1 | LIKE wildcard DoS ringan | Bagian dari M7 |
| L2 | Error message sangat verbose | Bagian dari M9 |

---

## Policy API (wajib didokumentasikan untuk consumer)

### Trusted-only (developer)

API berikut **tidak** menerima user input mentah:

- `RawQuery.query(sql)` / `execute(sql)` / tagged `sql\`\``
- `ExpressionBuilder.raw()` (nanti `rawUnsafe()`)
- `QueryBuilder` `join(..., on)` — string ON
- `RawQuery.search({ where })` — string where (sampai diganti callback)

### Selalu aman untuk user input

- Value di `where` / `eq` / `in` / `create` / `update` (parameterized)
- Column **hanya** jika melewati `quoteColumn` / ExpressionBuilder (bukan string SQL bebas)

### Contoh aman

```ts
// OK — value parameterized
await client.repository('user').findMany({
  where: (eb) => eb.eq('email', req.query.email),
})

// OK — raw dengan bind
await client.raw.sql`SELECT * FROM users WHERE id = ${userId}`

// BERBAHAYA — jangan lakukan
await client.raw.query(`SELECT * FROM users WHERE email = '${req.query.email}'`)
```

---

## Rencana remediation bertahap

### Phase 0 — Guardrail

- [x] CI job: `bun scripts/security-audit.ts` (fail on CRITICAL)
- [x] Script npm: `security:audit` / `security:audit:strict`
- [x] Workflow: `.github/workflows/va-orm-security.yml` (monorepo) + local `engine/va-orm/.github/workflows/security.yml`
- [ ] (Opsional) `bun audit` / dependency scan di CI

**Exit:** regresi CRITICAL terdeteksi otomatis.

### Phase 1 — CRITICAL

- [x] C1 fix `tsHeadline` + test
- [x] C2 fix `quoteSelect` + test
- [x] Re-run audit → CRITICAL=0

**Exit:** dua PoC scanner jadi INFO “mitigasi bekerja”.

### Phase 2 — HIGH integrity & abuse

- [x] H1 path traversal guard (`assertSafeMigrationName` / `resolveWithinBase`)
- [x] H4 pool retry policy (`retryMode: 'reads'` default)
- [x] H5 pool max accounting (`inUseCount` + `totalTracked`)
- [ ] H2 search where API
- [x] H3 rawUnsafe hardening (alias + docs + null byte guard)
- [x] H6 placeholder via driver
- [ ] H7 migration splitter / multi-statement

**Exit:** regression test per item; audit HIGH=0.

### Phase 3 — MEDIUM hardening

- [x] M1/M2 proto pollution — `safeJsonParse` + block-list key (OData/GraphQL/REST)
- [x] M3 `escapeLiteral` MySQL backslash
- [x] M4 advisory lock: dialect gate + placeholder (PG-only path)
- [x] M5 `createMany` kolom set identik
- [x] M7 LIKE `escapeLike`
- [x] M8 empty WHERE guard (update/updateMany/delete)
- [x] M6 nested TX SAVEPOINT (sqlite/pg/mysql)
- [x] M9 typed `VaError` + DSN/secret redaction on driver wrap
- [x] M10 typed `joinOn` / `leftJoinOn` / `rightJoinOn`

### Phase 4 — Policy & observability

- [ ] README security section (link doc ini)
- [ ] Redact DSN helper
- [ ] Contoh secure coding di docs raw/relation

---

## Definition of Done

| Checklist | Target |
|-----------|--------|
| `bun scripts/security-audit.ts` | CRITICAL=0, HIGH=0 |
| `bun test` | Hijau |
| PoC CRITICAL lama | Throw / inert / INFO |
| Breaking changes | Tercatat (CHANGELOG) |
| Known risk | Raw SQL = trusted-only, dideklarasikan |

---

## Cara menjalankan audit

```bash
cd engine/va-orm
bun scripts/security-audit.ts
```

Output berisi:

1. Static pattern scan (seluruh `packages/*/src`)
2. Dynamic PoC (query builder, raw, OData, migrator logic)
3. Live SQLite containment
4. Prioritas perbaikan terurut severity

Tambahkan ke CI setelah Phase 0:

```yaml
- name: Security audit
  run: bun scripts/security-audit.ts
```

---

## Di luar scope plan ini

- Fuzzing driver native penuh
- Multi-tenant row-level security (app concern)
- Supply-chain signing npm publish
- Penetration test eksternal

---

## Referensi internal

| Dokumen / file | Isi |
|----------------|-----|
| `scripts/security-audit.ts` | Scanner + PoC |
| `packages/client/src/__tests__/sql-injection.spec.ts` | Test containment existing |
| `docs/06-raw.md` | API raw SQL |
| `docs/07-pagination.md` | Adapter OData/GraphQL/REST |
| `docs/08-migration.md` | Sistem migrasi |
