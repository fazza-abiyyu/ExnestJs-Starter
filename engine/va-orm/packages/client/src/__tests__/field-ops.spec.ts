// VA-ORM Field Operations Spec

import { describe, it, expect } from 'bun:test';
import { MockDriver } from '../../../../test-setup.js';
import { Repository } from '../repository/repository.js';
import {
  buildSetClause,
  isFieldOperation,
  isFieldOp,
  isTrustedFieldOperationShape,
  fieldOps,
  FieldOp,
} from '../repository/field.ops.js';

describe('isFieldOperation', () => {
  it('detects branded FieldOp instances only', () => {
    expect(isFieldOperation(fieldOps.increment(1))).toBe(true);
    expect(isFieldOperation(fieldOps.decrement(1))).toBe(true);
    expect(isFieldOperation(fieldOps.set('x'))).toBe(true);
    expect(isFieldOperation(new FieldOp(1))).toBe(true);

    expect(isFieldOperation('plain')).toBe(false);
    expect(isFieldOperation(5)).toBe(false);
    expect(isFieldOperation(null)).toBe(false);
    expect(isFieldOperation([1])).toBe(false);
  });

  it('rejects lookalike JSON / mass-assignment shapes', () => {
    // Plain objects from HTTP body — even perfect-looking ops — are NOT FieldOp
    expect(isFieldOperation({ increment: 1 })).toBe(false);
    expect(isFieldOperation({ decrement: 1 })).toBe(false);
    expect(isFieldOperation({ set: 'admin' })).toBe(false);
    expect(isFieldOperation({ role: { set: 'admin' } })).toBe(false);
    expect(isFieldOperation({ set: 'x', role: 'admin' })).toBe(false);
    expect(isFieldOperation({ set: 'x', name: 'y' })).toBe(false);
    expect(isFieldOperation({ increment: '1' })).toBe(false);
    expect(isFieldOperation({ increment: Number.NaN })).toBe(false);
    expect(isFieldOperation({ increment: Infinity })).toBe(false);
    expect(isFieldOperation({})).toBe(false);
  });

  it('trusted shape helper still validates developer-built objects', () => {
    expect(isTrustedFieldOperationShape({ increment: 1 })).toBe(true);
    expect(isTrustedFieldOperationShape({ set: 'x', role: 'admin' })).toBe(false);
    expect(isTrustedFieldOperationShape({ increment: '1' })).toBe(false);
  });

  it('fieldOps helpers produce branded ops', () => {
    expect(isFieldOp(fieldOps.increment(2))).toBe(true);
    expect(isFieldOp(fieldOps.decrement(2))).toBe(true);
    expect(isFieldOp(fieldOps.set('v'))).toBe(true);
  });
});

describe('buildSetClause', () => {
  const ph = (i: number) => `$${i}`;

  it('should build plain assignments', () => {
    const { setParts, params, nextIndex } = buildSetClause({ name: 'John', age: 30 }, ph);
    expect(setParts).toEqual(['"name" = $1', '"age" = $2']);
    expect(params).toEqual(['John', 30]);
    expect(nextIndex).toBe(3);
  });

  it('should build increment', () => {
    const { setParts, params } = buildSetClause({ age: fieldOps.increment(1) }, ph);
    expect(setParts).toEqual(['"age" = "age" + $1']);
    expect(params).toEqual([1]);
  });

  it('should build decrement', () => {
    const { setParts, params } = buildSetClause({ balance: fieldOps.decrement(100) }, ph);
    expect(setParts).toEqual(['"balance" = "balance" - $1']);
    expect(params).toEqual([100]);
  });

  it('should build set operation', () => {
    const { setParts, params } = buildSetClause({ name: fieldOps.set('Jane') }, ph);
    expect(setParts).toEqual(['"name" = $1']);
    expect(params).toEqual(['Jane']);
  });

  it('treats lookalike JSON as plain value (no mass-assignment)', () => {
    const { setParts, params } = buildSetClause({ role: { set: 'admin' } }, ph);
    expect(setParts).toEqual(['"role" = $1']);
    expect(params).toEqual([{ set: 'admin' }]);
  });

  it('should lowercase camelCase columns to match folded DDL', () => {
    const { setParts, params } = buildSetClause({ updatedAt: new Date(0) }, ph);
    expect(setParts).toEqual(['"updatedat" = $1']);
    expect(params).toEqual([new Date(0)]);
  });

  it('should mix plain and operations', () => {
    const { setParts, params, nextIndex } = buildSetClause(
      { name: 'John', age: fieldOps.increment(1) },
      ph,
    );
    expect(setParts).toEqual(['"name" = $1', '"age" = "age" + $2']);
    expect(params).toEqual(['John', 1]);
    expect(nextIndex).toBe(3);
  });
});

describe('Repository field operations', () => {
  it('should update with increment', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, age: 31 }], rowCount: 1 });
    const repo = new Repository(driver, 'users');

    await repo.update({ id: 1 }, { age: fieldOps.increment(1) } as any);

    const query = driver.getQueries()[0];
    expect(query.sql).toBe('UPDATE "users" SET "age" = "age" + $1 WHERE "id" = $2 RETURNING *');
    expect(query.params).toEqual([1, 1]);
  });

  it('should updateMany with decrement and set', async () => {
    const driver = new MockDriver();
    driver.setResult({ rowCount: 3 });
    const repo = new Repository(driver, 'users');

    await repo.updateMany({ status: 'active' }, {
      balance: fieldOps.decrement(50),
      name: fieldOps.set('X'),
    } as any);

    const query = driver.getQueries()[0];
    expect(query.sql).toBe(
      'UPDATE "users" SET "balance" = "balance" - $1, "name" = $2 WHERE "status" = $3',
    );
    expect(query.params).toEqual([50, 'X', 'active']);
  });
});
