// Demo JSON search va-orm — SQLite lokal (local.db)
// Jalankan: bun src/demo.ts  (dari folder demo-json-search)

import { SqliteDriver } from '../../engine/va-orm/packages/client/src/drivers/sqlite/sqlite.driver.js';
import { QueryBuilder } from '../../engine/va-orm/packages/client/src/core/query-builder.js';
import { ModelDelegate } from '../../engine/va-orm/packages/client/src/repository/model.delegate.js';
import type { ModelMeta } from '../../engine/va-orm/packages/client/src/core/types.js';

const driver = new SqliteDriver('./local.db');

const meta: ModelMeta = {
  name: 'Product',
  table: 'products',
  primaryKey: 'id',
  relations: new Map(),
};
const products = new ModelDelegate(driver, meta, new Map());

async function main() {
  await driver.execute(`DROP TABLE IF EXISTS products`);
  await driver.execute(
    `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, metadata TEXT)`,
  );

  const seed = [
    {
      name: 'Kopi Arabika',
      metadata: {
        city: 'Jakarta',
        price: 85000,
        tags: ['vip', 'new'],
        address: { city: 'Jakarta Selatan' },
        specs: { color: 'hitam', weight: 1 },
        discount: null,
      },
    },
    {
      name: 'Teh Hijau',
      metadata: {
        city: 'Bandung',
        price: 45000,
        tags: ['new'],
        address: { city: 'Bandung' },
        specs: { color: 'hijau', weight: 0.5 },
      },
    },
    {
      name: 'Kopi Robusta',
      metadata: {
        city: 'Jakarta',
        price: 65000,
        tags: ['vip'],
        address: { city: 'Jakarta Timur' },
        specs: { color: 'hitam', weight: 2 },
        discount: 10,
      },
    },
    {
      name: 'Cokelat Batang',
      metadata: {
        city: 'Surabaya',
        price: 120000,
        tags: [],
        address: { city: 'Surabaya' },
        specs: { color: 'cokelat', weight: 1 },
      },
    },
  ];
  for (const row of seed) {
    await driver.execute(`INSERT INTO products (name, metadata) VALUES (?, ?)`, [
      row.name,
      JSON.stringify(row.metadata),
    ]);
  }
  console.log('Seed: 4 produk di local.db\n');

  const show = (label: string, rows: any[]) =>
    console.log(`${label}\n  -> ${rows.map((r) => r.name).join(', ') || '(kosong)'}\n`);

  // 1. equality di key JSON
  let qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonEq('metadata', 'city', 'Jakarta'));
  show('1. Gudang Jakarta (jsonEq city)', await qb.execute());

  // 2. nested path
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonEq('metadata', '$.address.city', 'Bandung'));
  show('2. Alamat Bandung (nested path)', await qb.execute());

  // 3. angka: range harga
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonGt('metadata', 'price', 50000).and().jsonLte('metadata', 'price', 90000));
  show('3. Harga 50rb–90rb (jsonGt + jsonLte)', await qb.execute());

  // 4. LIKE di dalam JSON
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonLike('metadata', 'address.city', 'Jakarta%'));
  show('4. Alamat berawalan Jakarta (jsonLike)', await qb.execute());

  // 5. array membership
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonArrayContains('metadata', 'tags', 'vip'));
  show('5. Tag vip (jsonArrayContains)', await qb.execute());

  // 6. document contains
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonContains('metadata', { color: 'hitam' }, 'specs'));
  show('6. Specs warna hitam (jsonContains)', await qb.execute());

  // 7. exists / not exists
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonExists('metadata', 'discount'));
  show('7a. Ada key discount (jsonExists)', await qb.execute());

  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => eb.jsonNotExists('metadata', 'discount'));
  show('7b. Tanpa key discount (jsonNotExists)', await qb.execute());

  // 8. Prisma-style where via ModelDelegate
  show(
    '8. Prisma-style { path, equals }',
    await products.findMany({ where: { metadata: { path: 'city', equals: 'Surabaya' } } }),
  );

  // 9. kombinasi AND + OR group
  qb = new QueryBuilder(driver, 'products');
  qb.where((eb) => {
    eb.jsonEq('metadata', 'city', 'Jakarta')
      .and()
      .group((g) => {
        g.jsonArrayContains('metadata', 'tags', 'new').or().jsonGt('metadata', 'price', 70000);
      });
  });
  show('9. Jakarta DAN (tag new ATAU harga > 70rb)', await qb.execute());

  await driver.close();
}

await main();
