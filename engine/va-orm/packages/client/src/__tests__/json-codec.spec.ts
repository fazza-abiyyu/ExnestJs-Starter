// VA-ORM JSON Codec Spec (transparent Json columns)

import { describe, it, expect } from 'bun:test';
import {
  decodeJsonRow,
  decodeJsonRows,
  encodeJsonFields,
  jsonFieldNames,
} from '../repository/json-codec.js';
import { NestedWriter } from '../repository/nested.writes.js';
import { ModelDelegate } from '../repository/model.delegate.js';
import type { ModelMeta } from '../core/types.js';
import { MockDriver } from '../../../../test-setup.js';
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js';

function meta(): ModelMeta {
  return {
    name: 'Product',
    table: 'products',
    primaryKey: 'id',
    relations: new Map(),
    fields: [
      { name: 'id', type: 'Int', attributes: [{ name: '@id' }] },
      { name: 'name', type: 'String', attributes: [] },
      { name: 'metadata', type: 'Json', attributes: [] },
    ],
  };
}

describe('jsonFieldNames', () => {
  it('collects Json and Json[] fields', () => {
    const names = jsonFieldNames({
      ...meta(),
      fields: [...(meta().fields ?? []), { name: 'tags', type: 'Json[]', attributes: [] }],
    });
    expect([...names].sort()).toEqual(['metadata', 'tags']);
  });

  it('empty without schema info', () => {
    expect(jsonFieldNames(undefined).size).toBe(0);
    expect(
      jsonFieldNames({ name: 'X', table: 'x', primaryKey: 'id', relations: new Map() }).size,
    ).toBe(0);
  });
});

describe('encodeJsonFields', () => {
  it('serializes values to canonical JSON', () => {
    const out = encodeJsonFields(meta(), {
      name: 'A',
      metadata: { city: 'Jakarta', price: 30, active: true, note: null, tags: ['x'] },
    });
    expect(out.metadata).toBe(
      '{"city":"Jakarta","price":30,"active":true,"note":null,"tags":["x"]}',
    );
    expect(out.name).toBe('A');
  });

  it('stringifies scalar strings too (round-trip safe)', () => {
    expect(encodeJsonFields(meta(), { metadata: 'Jakarta' }).metadata).toBe('"Jakarta"');
    expect(encodeJsonFields(meta(), { metadata: '30' }).metadata).toBe('"30"');
    expect(encodeJsonFields(meta(), { metadata: 30 }).metadata).toBe('30');
    expect(encodeJsonFields(meta(), { metadata: true }).metadata).toBe('true');
    expect(encodeJsonFields(meta(), { metadata: null }).metadata).toBe('null');
  });

  it('stores strings as JSON strings (canonical — pass values, not pre-encoded JSON)', () => {
    expect(encodeJsonFields(meta(), { metadata: '{"a":1}' }).metadata).toBe('"{\\"a\\":1}"');
  });

  it('does not mutate input and returns same ref when nothing to encode', () => {
    const data = { name: 'A' };
    expect(encodeJsonFields(meta(), data)).toBe(data);
    const withJson = { name: 'A', metadata: { a: 1 } };
    const out = encodeJsonFields(meta(), withJson);
    expect(out).not.toBe(withJson);
    expect(withJson.metadata).toEqual({ a: 1 });
  });

  it('no-op without schema info', () => {
    const data = { metadata: { a: 1 } };
    expect(encodeJsonFields(undefined, data)).toBe(data);
  });
});

describe('decodeJsonRow(s)', () => {
  it('parses TEXT payloads back with types intact', () => {
    const row = decodeJsonRow(meta(), {
      id: 1,
      name: 'A',
      metadata: '{"city":"Jakarta","price":30,"active":true,"note":null}',
    });
    expect(row.metadata).toEqual({ city: 'Jakarta', price: 30, active: true, note: null });
  });

  it('round-trips scalar strings', () => {
    expect(decodeJsonRow(meta(), { metadata: '"30"' }).metadata).toBe('30');
    expect(decodeJsonRow(meta(), { metadata: '"Jakarta"' }).metadata).toBe('Jakarta');
  });

  it('passes through objects, nulls and invalid JSON', () => {
    expect(decodeJsonRow(meta(), { metadata: { a: 1 } }).metadata).toEqual({ a: 1 });
    expect(decodeJsonRow(meta(), { metadata: null }).metadata).toBeNull();
    expect(decodeJsonRow(meta(), { metadata: 'bare text' }).metadata).toBe('bare text');
  });

  it('falls back to lowercase column key', () => {
    const m: ModelMeta = {
      name: 'T',
      table: 't',
      primaryKey: 'id',
      relations: new Map(),
      fields: [{ name: 'metaData', type: 'Json', attributes: [] }],
    };
    expect(decodeJsonRow(m, { metadata: '{"a":1}' }).metadata).toEqual({ a: 1 });
  });

  it('decodes row arrays', () => {
    const rows = decodeJsonRows(meta(), [{ metadata: '{"a":1}' }, { metadata: null }] as Record<
      string,
      any
    >[]);
    expect(rows[0].metadata).toEqual({ a: 1 });
    expect(rows[1].metadata).toBeNull();
  });
});

describe('writer encode + decode (mock driver)', () => {
  function registry() {
    return new Map([
      ['Product', meta()],
      ['product', meta()],
    ]);
  }

  it('create stringifies Json params and decodes RETURNING row', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'A', metadata: '{"city":"Jakarta"}' }], rowCount: 1 });
    const writer = new NestedWriter(driver, registry());

    const row = await writer.create('Product', { name: 'A', metadata: { city: 'Jakarta' } });

    const [q] = driver.getQueries();
    expect(q.params).toEqual(['A', '{"city":"Jakarta"}']);
    expect(row.metadata).toEqual({ city: 'Jakarta' });
  });

  it('update encodes SET params', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'A', metadata: '{"city":"X"}' }], rowCount: 1 });
    const writer = new NestedWriter(driver, registry());

    await writer.update('Product', { id: 1 }, { metadata: { city: 'Bandung' } });

    const setQuery = driver.getQueries().find((q) => q.sql.startsWith('UPDATE'));
    expect(setQuery?.params).toContain('{"city":"Bandung"}');
  });
});

describe('live sqlite round-trip via ModelDelegate', () => {
  it('create / findMany / update keep object types', async () => {
    const driver = new SqliteDriver(':memory:');
    await driver.execute(
      `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, metadata TEXT)`,
    );
    const delegate = new ModelDelegate(driver, meta(), new Map([['Product', meta()]]));

    const created = await delegate.create({
      data: { name: 'Kopi', metadata: { city: 'Jakarta', price: 85000, tags: ['vip'] } },
    });
    expect(created.metadata).toEqual({ city: 'Jakarta', price: 85000, tags: ['vip'] });

    // raw storage stays TEXT
    const raw = await driver.query<{ metadata: string }>(`SELECT metadata FROM products`);
    expect(typeof raw.rows[0].metadata).toBe('string');

    const found = await delegate.findMany({
      where: { metadata: { path: 'city', equals: 'Jakarta' } },
    });
    expect(found.length).toBe(1);
    expect(found[0].metadata).toEqual({ city: 'Jakarta', price: 85000, tags: ['vip'] });

    await delegate.update({
      where: { id: created.id },
      data: { metadata: { city: 'Bandung', price: 45000, tags: [] } },
    });
    const refetched = await delegate.findMany({});
    expect(refetched[0].metadata).toEqual({ city: 'Bandung', price: 45000, tags: [] });

    await driver.close();
  });
});
