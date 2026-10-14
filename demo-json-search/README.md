# Demo JSON Search (va-orm + SQLite lokal)

Projek demo kecil untuk coba fitur JSON search va-orm tanpa server database.

## Cara cepat (tanpa schema)

```sh
bun install   # sekali saja
bun run demo  # src/demo.ts — seed + 9 contoh query JSON search
```

Demo memakai file SQLite lokal `local.db` dan import va-orm langsung dari source:

```
../engine/va-orm/packages/client/src/...
```

## Schema-first (`va.schema`)

```sh
bun run schema:validate   # cek va.schema
bun run schema:push       # bikin tabel di local.db (Json -> TEXT di SQLite)
bun run schema:generate   # generated/{types,client}.ts + schema.sql
bun run demo:schema       # src/schema-demo.ts — typed client + JSON where
```

Alurnya: `va.schema` → `db push` (DDL) → `generate` (typed `VaClientGenerated`
+ `ProductWhereInput` yang sudah kenal `path`/`arrayContains`/`exists`) →
`client.product.findMany({ where: { metadata: { path: 'city', equals: '...' } } })`.

Kolom `Json` auto-serialize kayak Prisma: tulis object/array/skalar langsung,
baca balik jadi tipe semula. Berlaku di path schema-aware (`client.<model>` /
`VaClient.model`); `Repository` mentah tanpa schema tidak menyentuh value.

## Yang didemokan (`src/demo.ts`)

1. `jsonEq` — equality di key JSON
2. Nested path (`$.address.city`)
3. Range angka (`jsonGt` + `jsonLte`)
4. `jsonLike` di dalam JSON
5. `jsonArrayContains` — membership array
6. `jsonContains` — document contains di sub-path
7. `jsonExists` / `jsonNotExists`
8. Prisma-style `where: { metadata: { path, equals } }` via `ModelDelegate`
9. Kombinasi `AND` + `OR group`
