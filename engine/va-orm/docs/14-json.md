# JSON Columns

Tipe `Json` di `va.schema` untuk dokumen semi-terstruktur, plus search
dan auto-serialize ala Prisma — bekerja di PostgreSQL, MySQL, dan SQLite.

## 1. Tipe data

```prisma
model Product {
  id       Int    @id @default(autoincrement())
  name     String
  metadata Json

  @@map("products")
}
```

| Schema | TypeScript | PostgreSQL | MySQL  | SQLite |
| ------ | ---------- | ---------- | ------ | ------ |
| `Json` | `any`      | `JSONB`    | `JSON` | `TEXT` |

## 2. Auto-serialize (transparent columns)

Di path schema-aware (`VaClient.model` / generated delegates) kolom `Json`
tidak perlu `JSON.stringify` manual:

```typescript
await va.model('product').create({
  data: { name: 'Kopi', metadata: { city: 'Jakarta', price: 85000 } },
});

const rows = await va.model('product').findMany();
rows[0].metadata.city; // object lagi — bukan TEXT
```

Aturannya:

- Tulis: object/array/number/boolean/null/string di field `Json` disimpan
  sebagai canonical JSON (`'Jakarta'` → `'"Jakarta"'`), jadi round-trip
  selalu utuh tipenya. Terapkan saat `create` (termasuk nested create) dan
  `update`. Value `undefined` dilewati.
- Baca: payload `TEXT` di field `Json` di-parse balik. Driver yang sudah
  mengembalikan object (mis. PostgreSQL `jsonb`) dilewati apa adanya; string
  yang bukan JSON valid (data lama) dibiarkan apa adanya.
- Berlaku di `findMany`/`findFirst`/`findUnique`/`count`/`create`/`update`
  dan `include` (termasuk many-to-many).
- `Repository` mentah (tanpa schema, tanpa metadata tipe) **tidak** menyentuh
  value — di sana tetap kirim string serialized manual.
- `where` di `update` untuk field `Json` tidak di-encode; untuk kondisi JSON
  pakai `findMany` + filter JSON, atau kirim string serialized.

## 3. Path syntax

Semua API search menerima `path` dalam tiga bentuk (boleh campur):

```typescript
'city'; // single key
'address.city'; // dot notation
'$.address.city'; // JSONPath-ish
'tags[0]' // array index
[('address', 'city')]; // segmen (Prisma-style, index pakai number)
```

Path kosong / `'$'` = root dokumen (mis. kolomnya sendiri array).
Key yang mengandung karakter spesial (`'o\'brien'`, `'my.key'`) di-escape
otomatis ke string literal — tidak pernah diinterpolasi mentah.

## 4. Expression builder

```typescript
qb.where((eb) => eb.jsonEq('metadata', 'city', 'Jakarta'));
qb.where((eb) => eb.jsonEq('metadata', '$.address.city', 'Bandung'));

// Perbandingan mengikuti tipe value JS (string / number / boolean / dokumen)
eb.jsonEq('metadata', 'age', 30);
eb.jsonGt('metadata', 'age', 18);
eb.jsonEq('metadata', 'addr', { city: 'Bandung' }); // equality dokumen
eb.jsonEq('metadata', 'deletedAt', null); // JSON null ATAU missing

eb.jsonNotEq('metadata', 'city', 'Jakarta');
eb.jsonGte / eb.jsonLte / eb.jsonLt / eb.jsonGt;
eb.jsonIn('metadata', 'city', ['Jakarta', 'Bandung']);
eb.jsonNotIn('metadata', 'city', ['Jakarta']);

// Pattern: sertakan `%` sendiri (mirip like())
eb.jsonLike('metadata', 'city', 'Jak%');
eb.jsonNotLike('metadata', 'city', '%test%');
eb.jsonILike('metadata', 'city', '%jak%'); // ILIKE di PG, LOWER() LIKE di MySQL/SQLite

eb.jsonExists('metadata', 'city'); // path ada (JSON null dihitung ada*)
eb.jsonNotExists('metadata', 'deletedAt');

eb.jsonContains('metadata', { role: 'admin' }); // dokumen mengandung
eb.jsonContains('metadata', 'admin', '$.roles'); // skalar di array pada path
eb.jsonArrayContains('metadata', 'tags', 'vip'); // alias eksplisit membership
```

`*` Kecuali SQLite: `json_extract` di sana membaca JSON `null` eksplisit
sebagai missing.

Semua value jadi bind parameter di ketiga dialect.

## 5. Prisma-style `where`

`findMany`, `findFirst`, `findUnique`, `count`, `aggregate`, dan
`include.where` menerima filter JSON:

```typescript
await va.model('product').findMany({
  where: { metadata: { path: 'city', equals: 'Jakarta' } },
});

await va.model('product').findMany({
  where: {
    AND: [
      { metadata: { path: 'age', gte: 18 } },
      { metadata: { path: 'tags', arrayContains: 'vip' } },
    ],
  },
});
```

| Key                                    | Arti                                                        |
| -------------------------------------- | ----------------------------------------------------------- |
| `path`                                 | Lokasi di dokumen (opsional, default root)                  |
| `equals` / `not`                       | Sama dengan / tidak sama dengan                             |
| `in` / `notIn`                         | Daftar value (`[]` → false / true)                          |
| `lt` / `lte` / `gt` / `gte`            | Perbandingan (angka numerik, bukan leksikografis)           |
| `contains` / `startsWith` / `endsWith` | Substring di teks hasil ekstrak (`%` di-escape otomatis)    |
| `mode: 'insensitive'`                  | Case-insensitive (`ILIKE` di PG, `LOWER() LIKE` di lainnya) |
| `arrayContains`                        | Skalar anggota array di `path`                              |
| `exists: true/false`                   | Path ada / tidak ada                                        |

Generated `WhereInput` (dari `va generate`) sudah memuat key-key ini untuk
field `Json`, jadi typed di TypeScript.

Bedanya dari Prisma (disengaja): nama string-nya pendek (`contains`, bukan
`string_contains`), ada tambahan `in`/`notIn`/`exists`, tidak ada
`array_starts_with`, dan null tidak dibedakan (`DbNull`/`JsonNull`):
`equals: null` match path yang missing maupun JSON `null`.

## 6. Referensi SQL per dialect

| Operasi     | PostgreSQL                      | MySQL                                            | SQLite                                   |
| ----------- | ------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| string `=`  | `("c" ->> 'k') = $1`            | `JSON_UNQUOTE(JSON_EXTRACT("c", '$.k')) = ?`     | `json_extract("c", '$.k') = ?`           |
| number `>`  | `(("c" ->> 'k')::numeric) > $1` | `(CAST(JSON_EXTRACT("c", '$.k') AS DOUBLE)) > ?` | `json_extract("c", '$.k') > ?`           |
| boolean `=` | `(("c" ->> 'k')::boolean) = $1` | `JSON_EXTRACT("c", '$.k') = CAST(? AS JSON)`     | `json_extract("c", '$.k') = ?` (`1`/`0`) |
| dokumen `=` | `("c" -> 'k') = $1::jsonb`      | `JSON_EXTRACT("c", '$.k') = CAST(? AS JSON)`     | `json_extract("c", '$.k') = ?`           |
| `LIKE`      | `... LIKE $1 ESCAPE '\'`        | sama (`JSON_UNQUOTE`)                            | `CAST(json_extract(...) AS TEXT) LIKE ?` |
| exists      | `("c" -> 'k') IS NOT NULL`      | `JSON_CONTAINS_PATH("c", 'one', '$.k') = 1`      | `json_extract("c", '$.k') IS NOT NULL`   |
| contains    | `("c" @> $1::jsonb)`            | `JSON_CONTAINS("c", ?, '$')`                     | per-key `=` / `json_each` + `EXISTS`     |

## 7. Batasan

- `update` via `where` JSON: encode hanya untuk `data`, bukan kondisi `where`.
- `IN` heterogen (campur string/number/object) dibandingkan sebagai teks.
- `ILIKE`/`mode: 'insensitive'` di MySQL/SQLite = `LOWER() LIKE` (semantik
  Unicode bisa beda tipis dari PG).
- JSON `null` eksplisit vs missing tidak bisa dibedakan di SQLite.
