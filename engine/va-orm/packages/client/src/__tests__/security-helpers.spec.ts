// VA-ORM Security Helpers Spec

import { describe, it, expect } from 'bun:test';
import { escapeLike, isDangerousKey, safeJsonParse, splitSqlStatements } from '../core/security.js';
import { Migrator } from '../migration/migrator.js';
import { MockDriver } from '../../../../test-setup.js';
import { ODataAdapter } from '../pagination/adapters/odata.adapter.js';
import { Repository } from '../repository/repository.js';
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js';

describe('security helpers', () => {
  it('blocks dangerous keys', () => {
    expect(isDangerousKey('__proto__')).toBe(true);
    expect(isDangerousKey('constructor')).toBe(true);
    expect(isDangerousKey('name')).toBe(false);
  });

  it('safeJsonParse drops __proto__', () => {
    const parsed = safeJsonParse<Record<string, any>>('{"__proto__":{"admin":true},"id":1}');
    expect(parsed).toBeDefined();
    expect(parsed!.id).toBe(1);
    const plain: Record<string, unknown> = {};
    expect(plain.admin).toBeUndefined();
  });

  it('escapeLike escapes wildcards', () => {
    expect(escapeLike('50%_x')).toBe('50\\%\\_x');
  });

  it('splitSqlStatements keeps semicolons in strings', () => {
    const stmts = splitSqlStatements(
      'CREATE TABLE t (a text); INSERT INTO t VALUES (\x27a;b\x27); -- c;d\nSELECT 1',
    );
    expect(stmts.length).toBe(3);
    expect(stmts[1]).toContain('\x27a;b\x27');
  });

  it('splitSqlStatements handles dollar quotes', () => {
    const stmts = splitSqlStatements(
      'CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql;',
    );
    expect(stmts.length).toBe(1);
  });
});

describe('odata proto safety', () => {
  it('parseFilter skips __proto__', () => {
    const conditions = ODataAdapter.parseFilter('__proto__ eq \x27x\x27 name eq \x27ok\x27');
    expect(conditions.name).toBe('ok');
  });
});

describe('repository guards', () => {
  it('refuses update/delete without WHERE', async () => {
    const driver = new SqliteDriver(':memory:');
    await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    const repo = new Repository<any>(driver, 'users', {});
    await expect(repo.update({}, { name: 'x' })).rejects.toThrow(/without WHERE/);
    await expect(repo.updateMany({}, { name: 'x' })).rejects.toThrow(/without WHERE/);
    await expect(repo.delete({})).rejects.toThrow(/without WHERE/);
  });

  it('createMany rejects mismatched columns', async () => {
    const driver = new SqliteDriver(':memory:');
    await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    const repo = new Repository<any>(driver, 'users', {});
    await expect(repo.createMany([{ id: 1, name: 'a' }, { id: 2 }])).rejects.toThrow(
      /same column set/,
    );
  });
});

describe('migrator statement split', () => {
  it('creates migration with semicolon in string body', async () => {
    const driver = new MockDriver();
    const migrator = new Migrator(driver, './test-migrations-split');
    const fs = await import('fs/promises');
    await fs.mkdir('./test-migrations-split', { recursive: true });
    const file = await migrator.createMigration(
      'keep-semi',
      'INSERT INTO t VALUES (\x27a;b\x27)',
      'SELECT 1',
    );
    expect(file).toContain('keep-semi');
    await fs.rm('./test-migrations-split', { recursive: true });
  });
});
