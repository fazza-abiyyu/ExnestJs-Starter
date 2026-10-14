// VA-ORM JSON Search Spec

import { describe, it, expect } from 'bun:test';
import { ExpressionBuilder } from '../core/expression.js';
import { parseJsonPath } from '../core/json-path.js';
import { buildWhere } from '../relation/filters.js';
import type { ModelMeta } from '../core/types.js';
import { QueryBuilder } from '../core/query-builder.js';
import { ModelDelegate } from '../repository/model.delegate.js';
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js';

function pg() {
  return new ExpressionBuilder();
}

function mysql() {
  return ExpressionBuilder.create(() => '?', undefined, 'mysql');
}

function sqlite() {
  return ExpressionBuilder.create(() => '?', undefined, 'sqlite');
}

function meta(): ModelMeta {
  return { name: 'Product', table: 'products', primaryKey: 'id', relations: new Map() };
}

describe('parseJsonPath', () => {
  it('parses bare and dot notation', () => {
    expect(parseJsonPath('city')).toEqual(['city']);
    expect(parseJsonPath('address.city')).toEqual(['address', 'city']);
  });

  it('parses JSONPath-ish with $ and indices', () => {
    expect(parseJsonPath('$.address.city')).toEqual(['address', 'city']);
    expect(parseJsonPath('$.tags[0]')).toEqual(['tags', 0]);
    expect(parseJsonPath('tags[1].name')).toEqual(['tags', 1, 'name']);
  });

  it('keeps quoted dots literal', () => {
    expect(parseJsonPath('a."b.c".d')).toEqual(['a', 'b.c', 'd']);
  });

  it('accepts segment arrays', () => {
    expect(parseJsonPath(['address', 'city'])).toEqual(['address', 'city']);
    expect(parseJsonPath(['tags', 0])).toEqual(['tags', 0]);
  });

  it('rejects invalid paths', () => {
    expect(() => parseJsonPath('a[')).toThrow();
    expect(() => parseJsonPath('a\0b')).toThrow();
  });
});

describe('jsonEq / scalar compare (postgres)', () => {
  it('string uses ->> for single key', () => {
    const { sql, params } = pg().jsonEq('metadata', 'city', 'Jakarta').build();
    expect(sql).toBe(`("metadata" ->> 'city') = $1`);
    expect(params).toEqual(['Jakarta']);
  });

  it('nested path uses #>>', () => {
    const { sql, params } = pg().jsonEq('metadata', '$.address.city', 'Bandung').build();
    expect(sql).toBe(`("metadata" #>> '{address,city}') = $1`);
    expect(params).toEqual(['Bandung']);
  });

  it('segment array path', () => {
    const { sql } = pg().jsonEq('metadata', ['address', 'city'], 'x').build();
    expect(sql).toBe(`("metadata" #>> '{address,city}') = $1`);
  });

  it('array index path', () => {
    const { sql } = pg().jsonEq('metadata', 'tags[0]', 'vip').build();
    expect(sql).toBe(`("metadata" #>> '{tags,0}') = $1`);
  });

  it('number casts to numeric', () => {
    const { sql, params } = pg().jsonGt('metadata', 'age', 18).build();
    expect(sql).toBe(`(("metadata" ->> 'age')::numeric) > $1`);
    expect(params).toEqual([18]);
  });

  it('boolean casts to boolean', () => {
    const { sql, params } = pg().jsonEq('metadata', 'active', true).build();
    expect(sql).toBe(`(("metadata" ->> 'active')::boolean) = $1`);
    expect(params).toEqual([true]);
  });

  it('object compares as jsonb', () => {
    const { sql, params } = pg().jsonEq('metadata', 'addr', { city: 'B' }).build();
    expect(sql).toBe(`("metadata" -> 'addr') = $1::jsonb`);
    expect(params).toEqual(['{"city":"B"}']);
  });

  it('null matches missing or JSON null', () => {
    const { sql, params } = pg().jsonEq('metadata', 'city', null).build();
    expect(sql).toBe(`(("metadata" -> 'city') IS NULL OR ("metadata" -> 'city') = $1::jsonb)`);
    expect(params).toEqual(['null']);
  });

  it('notEq null negates', () => {
    const { sql, params } = pg().jsonNotEq('metadata', 'city', null).build();
    expect(sql).toBe(
      `(NOT (("metadata" -> 'city') IS NULL OR ("metadata" -> 'city') = $1::jsonb))`,
    );
    expect(params).toEqual(['null']);
  });

  it('escapes quotes in keys', () => {
    const { sql, params } = pg().jsonEq('metadata', "o'brien", 'x').build();
    expect(sql).toBe(`("metadata" ->> 'o''brien') = $1`);
    expect(params).toEqual(['x']);
  });
});

describe('json compare (mysql)', () => {
  it('string uses UNQUOTE text compare', () => {
    const { sql, params } = mysql().jsonEq('metadata', 'city', 'Jakarta').build();
    expect(sql).toBe(`JSON_UNQUOTE(JSON_EXTRACT("metadata", '$.city')) = ?`);
    expect(params).toEqual(['Jakarta']);
  });

  it('number equality uses JSON compare', () => {
    const { sql, params } = mysql().jsonEq('metadata', 'age', 30).build();
    expect(sql).toBe(`JSON_EXTRACT("metadata", '$.age') = CAST(? AS JSON)`);
    expect(params).toEqual(['30']);
  });

  it('number ordering casts to DOUBLE', () => {
    const { sql, params } = mysql().jsonGt('metadata', 'age', 18).build();
    expect(sql).toBe(`(CAST(JSON_EXTRACT("metadata", '$.age') AS DOUBLE)) > ?`);
    expect(params).toEqual([18]);
  });

  it('boolean equality uses JSON compare', () => {
    const { sql, params } = mysql().jsonEq('metadata', 'active', true).build();
    expect(sql).toBe(`JSON_EXTRACT("metadata", '$.active') = CAST(? AS JSON)`);
    expect(params).toEqual(['true']);
  });
});

describe('json compare (sqlite)', () => {
  it('string equality', () => {
    const { sql, params } = sqlite().jsonEq('metadata', 'city', 'Jakarta').build();
    expect(sql).toBe(`json_extract("metadata", '$.city') = ?`);
    expect(params).toEqual(['Jakarta']);
  });

  it('number and boolean stay typed', () => {
    expect(sqlite().jsonGt('metadata', 'age', 18).build().params).toEqual([18]);
    expect(sqlite().jsonEq('metadata', 'active', true).build().params).toEqual([1]);
  });

  it('object compares stringified', () => {
    const { sql, params } = sqlite().jsonEq('metadata', 'addr', { city: 'B' }).build();
    expect(sql).toBe(`json_extract("metadata", '$.addr') = ?`);
    expect(params).toEqual(['{"city":"B"}']);
  });
});

describe('json pattern ops', () => {
  it('like on extracted text', () => {
    const { sql, params } = pg().jsonLike('metadata', 'city', 'Jak%').build();
    expect(sql).toBe(`("metadata" ->> 'city') LIKE $1 ESCAPE '\\'`);
    expect(params).toEqual(['Jak%']);
  });

  it('ilike on postgres', () => {
    const { sql } = pg().jsonILike('metadata', 'city', '%jak%').build();
    expect(sql).toBe(`("metadata" ->> 'city') ILIKE $1 ESCAPE '\\'`);
  });

  it('ilike falls back to LOWER() LIKE on mysql/sqlite', () => {
    const { sql } = mysql().jsonILike('metadata', 'city', '%jak%').build();
    expect(sql).toBe(
      `LOWER(JSON_UNQUOTE(JSON_EXTRACT("metadata", '$.city'))) LIKE LOWER(?) ESCAPE '\\'`,
    );
    const lite = sqlite().jsonILike('metadata', 'city', '%jak%').build();
    expect(lite.sql).toContain('LOWER(');
  });
});

describe('json in', () => {
  it('string list', () => {
    const { sql, params } = pg().jsonIn('metadata', 'city', ['A', 'B']).build();
    expect(sql).toBe(`("metadata" ->> 'city') IN ($1, $2)`);
    expect(params).toEqual(['A', 'B']);
  });

  it('empty list is always-false / always-true', () => {
    expect(pg().jsonIn('metadata', 'city', []).build().sql).toBe('(1 = 0)');
    expect(pg().jsonNotIn('metadata', 'city', []).build().sql).toBe('(1 = 1)');
  });
});

describe('json exists', () => {
  it('postgres uses jsonb existence', () => {
    expect(pg().jsonExists('metadata', 'city').build().sql).toBe(
      `(("metadata" -> 'city') IS NOT NULL)`,
    );
    expect(pg().jsonNotExists('metadata', 'city').build().sql).toBe(
      `(("metadata" -> 'city') IS NULL)`,
    );
  });

  it('mysql uses JSON_CONTAINS_PATH', () => {
    expect(mysql().jsonExists('metadata', 'city').build().sql).toBe(
      `(JSON_CONTAINS_PATH("metadata", 'one', '$.city') = 1)`,
    );
  });

  it('sqlite uses IS NOT NULL', () => {
    expect(sqlite().jsonExists('metadata', 'city').build().sql).toBe(
      `(json_extract("metadata", '$.city') IS NOT NULL)`,
    );
  });
});

describe('json contains', () => {
  it('postgres root @>', () => {
    const { sql, params } = pg().jsonContains('metadata', { role: 'admin' }).build();
    expect(sql).toBe(`("metadata" @> $1::jsonb)`);
    expect(params).toEqual(['{"role":"admin"}']);
  });

  it('postgres at path', () => {
    const { sql, params } = pg().jsonContains('metadata', { a: 1 }, '$.nested').build();
    expect(sql).toBe(`(("metadata" #> '{nested}') @> $1::jsonb)`);
    expect(params).toEqual(['{"a":1}']);
  });

  it('mysql JSON_CONTAINS', () => {
    const { sql, params } = mysql().jsonContains('metadata', { role: 'admin' }).build();
    expect(sql).toBe(`JSON_CONTAINS("metadata", ?, '$')`);
    expect(params).toEqual(['{"role":"admin"}']);
  });

  it('mysql array membership stringifies scalar', () => {
    const { sql, params } = mysql().jsonArrayContains('metadata', 'tags', 'vip').build();
    expect(sql).toBe(`JSON_CONTAINS("metadata", ?, '$.tags')`);
    expect(params).toEqual(['"vip"']);
  });

  it('postgres scalar membership stringifies for ::jsonb', () => {
    const { sql, params } = pg().jsonArrayContains('metadata', 'tags', 'vip').build();
    expect(sql).toBe(`(("metadata" #> '{tags}') @> $1::jsonb)`);
    expect(params).toEqual(['"vip"']);
  });

  it('sqlite object becomes per-key equality', () => {
    const { sql, params } = sqlite().jsonContains('metadata', { role: 'admin' }).build();
    expect(sql).toBe(`(json_extract("metadata", '$.role') = ?)`);
    expect(params).toEqual(['admin']);
  });

  it('sqlite array membership uses json_each', () => {
    const { sql, params } = sqlite().jsonArrayContains('metadata', 'tags', 'vip').build();
    expect(sql).toBe(`(EXISTS (SELECT 1 FROM json_each("metadata", '$.tags') WHERE value = ?))`);
    expect(params).toEqual(['vip']);
  });
});

describe('dialect propagation', () => {
  it('setDialect switches rendering', () => {
    const eb = new ExpressionBuilder().setDialect('mysql');
    expect(eb.jsonExists('metadata', 'city').build().sql).toContain('JSON_CONTAINS_PATH');
  });

  it('group inherits dialect', () => {
    const eb = mysql();
    eb.jsonEq('metadata', 'city', 'A').group((g) => {
      g.jsonEq('metadata', 'city', 'B');
    });
    expect(eb.build().sql).toContain('JSON_UNQUOTE');
  });
});

describe('WhereInput JSON filter', () => {
  const registry = new Map();

  it('maps equals/contains/exists (postgres)', () => {
    const { sql, params } = buildWhere(
      { metadata: { path: 'city', equals: 'Jakarta' } },
      meta(),
      registry,
    );
    expect(sql).toBe(`("metadata" ->> 'city') = $1`);
    expect(params).toEqual(['Jakarta']);
  });

  it('maps contains with escaping', () => {
    const { sql, params } = buildWhere(
      { metadata: { path: 'city', contains: '100%' } },
      meta(),
      registry,
    );
    expect(sql).toContain('LIKE');
    expect(params).toEqual(['%100\\%%']);
  });

  it('maps insensitive contains to ILIKE', () => {
    const { sql } = buildWhere(
      { metadata: { path: 'city', contains: 'jak', mode: 'insensitive' } },
      meta(),
      registry,
    );
    expect(sql).toContain('ILIKE');
  });

  it('maps gt + arrayContains + exists', () => {
    const gt = buildWhere({ metadata: { path: 'age', gt: 18 } }, meta(), registry);
    expect(gt.sql).toContain('::numeric');

    const arr = buildWhere({ metadata: { path: 'tags', arrayContains: 'vip' } }, meta(), registry);
    expect(arr.sql).toContain('@>');

    const ex = buildWhere({ metadata: { path: 'city', exists: false } }, meta(), registry);
    expect(ex.sql).toContain('IS NULL');
  });

  it('respects mysql dialect', () => {
    const { sql, params } = buildWhere(
      { metadata: { path: 'city', equals: 'Jakarta' } },
      meta(),
      registry,
      () => '?',
      undefined,
      'mysql',
    );
    expect(sql).toBe(`JSON_UNQUOTE(JSON_EXTRACT("metadata", '$.city')) = ?`);
    expect(params).toEqual(['Jakarta']);
  });

  it('scalar filters still work alongside json', () => {
    const { sql } = buildWhere(
      { status: 'active', metadata: { path: 'city', equals: 'Jakarta' } },
      meta(),
      registry,
    );
    expect(sql).toContain('"status" = $1');
    expect(sql).toContain(`->>`);
  });
});

describe('live sqlite', () => {
  const driver = new SqliteDriver(':memory:');

  it('filters rows by JSON path end to end', async () => {
    await driver.execute(`CREATE TABLE products (id INTEGER PRIMARY KEY, metadata TEXT)`);
    const seed = [
      { city: 'Jakarta', age: 30, tags: ['vip', 'new'] },
      { city: 'Bandung', age: 17, tags: ['new'] },
      { city: 'Jakarta', age: 22, tags: [] },
    ];
    for (const m of seed) {
      await driver.execute(`INSERT INTO products (metadata) VALUES (?)`, [JSON.stringify(m)]);
    }

    // eq
    let qb = new QueryBuilder(driver, 'products');
    qb.where((eb) => eb.jsonEq('metadata', 'city', 'Jakarta'));
    expect((await qb.execute()).length).toBe(2);

    // number gt
    qb = new QueryBuilder(driver, 'products');
    qb.where((eb) => eb.jsonGt('metadata', 'age', 18));
    expect((await qb.execute()).length).toBe(2);

    // nested + combined
    qb = new QueryBuilder(driver, 'products');
    qb.where((eb) => {
      eb.jsonEq('metadata', 'city', 'Jakarta').and().jsonGte('metadata', 'age', 25);
    });
    expect((await qb.execute()).length).toBe(1);

    // array membership
    qb = new QueryBuilder(driver, 'products');
    qb.where((eb) => eb.jsonArrayContains('metadata', 'tags', 'vip'));
    expect((await qb.execute()).length).toBe(1);

    // exists / not exists
    qb = new QueryBuilder(driver, 'products');
    qb.where((eb) => eb.jsonExists('metadata', 'missing'));
    expect((await qb.execute()).length).toBe(0);

    // like
    qb = new QueryBuilder(driver, 'products');
    qb.where((eb) => eb.jsonLike('metadata', 'city', 'Jak%'));
    expect((await qb.execute()).length).toBe(2);

    // via ModelDelegate (WhereInput + dialect wiring)
    const delegate = new ModelDelegate(driver, meta(), new Map());
    const rows = await delegate.findMany({
      where: { metadata: { path: 'city', equals: 'Bandung' } },
    });
    expect(rows.length).toBe(1);

    await driver.close();
  });
});
