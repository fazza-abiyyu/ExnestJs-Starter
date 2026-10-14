// Demo schema-first va-orm — typed client dari va.schema + JSON search.
// Tabel dibuat via `db push` (lihat README). Jalankan: bun src/schema-demo.ts

import { VaClientGenerated } from '../generated/client.js';

const client = new VaClientGenerated({ connectionString: './local.db' });
await client.connect();
await client.execute('DELETE FROM products'); // idempoten: rerun hasil stabil

// Kolom Json auto-serialize: object/array/skalar langsung, tanpa stringify.
await client.product.create({
  data: {
    name: 'Kopi Arabika',
    metadata: { city: 'Jakarta', price: 85000, tags: ['vip', 'new'] },
  },
});
await client.product.create({
  data: {
    name: 'Teh Hijau',
    metadata: { city: 'Bandung', price: 45000, tags: ['new'] },
  },
});
await client.product.create({
  data: {
    name: 'Kopi Robusta',
    metadata: { city: 'Jakarta', price: 65000, tags: ['vip'] },
  },
});

const show = (label: string, rows: { name: string }[]) =>
  console.log(`${label}\n  -> ${rows.map((r) => r.name).join(', ') || '(kosong)'}\n`);

// Typed WhereInput — path/arrayContains/exists ikut ke-generate dari va.schema
show(
  '1. Gudang Jakarta (typed where)',
  await client.product.findMany({ where: { metadata: { path: 'city', equals: 'Jakarta' } } }),
);

show(
  '2. Harga >= 60rb',
  await client.product.findMany({ where: { metadata: { path: 'price', gte: 60000 } } }),
);

show(
  '3. Tag vip (arrayContains)',
  await client.product.findMany({ where: { metadata: { path: 'tags', arrayContains: 'vip' } } }),
);

show(
  '4. Kota mengandung "ung" (contains, insensitive)',
  await client.product.findMany({
    where: { metadata: { path: 'city', contains: 'ung', mode: 'insensitive' } },
  }),
);

console.log(`5. Count Jakarta: ${await client.product.count({ metadata: { path: 'city', equals: 'Jakarta' } })}`);

await client.disconnect();
