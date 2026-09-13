// VA-ORM Nested Writes Spec

import { describe, it, expect } from 'bun:test';
import { MockDriver } from '../../../../test-setup.js';
import type { ModelMeta } from '../core/types.js';
import { ModelDelegate } from '../repository/model.delegate.js';
import { NestedWriter } from '../repository/nested.writes.js';
import { SqliteDriver } from '../drivers/sqlite/sqlite.driver.js';

function userModel(): ModelMeta {
  return {
    name: 'User',
    table: 'users',
    primaryKey: 'id',
    relations: new Map([
      [
        'posts',
        {
          field: 'posts',
          targetModel: 'Post',
          isList: true,
          kind: 'one-to-many',
          fkModel: 'Post',
          fkFields: ['userId'],
          pkModel: 'User',
          pkFields: ['id'],
          backField: 'author',
          isFkHolder: false,
        },
      ],
    ]),
  };
}

function postModel(): ModelMeta {
  return {
    name: 'Post',
    table: 'posts',
    primaryKey: 'id',
    relations: new Map([
      [
        'author',
        {
          field: 'author',
          targetModel: 'User',
          isList: false,
          kind: 'many-to-one',
          fkModel: 'Post',
          fkFields: ['userId'],
          pkModel: 'User',
          pkFields: ['id'],
          backField: 'posts',
          isFkHolder: true,
        },
      ],
      [
        'tags',
        {
          field: 'tags',
          targetModel: 'Tag',
          isList: true,
          kind: 'many-to-many-implicit',
          fkModel: 'Post',
          fkFields: [],
          pkModel: 'Post',
          pkFields: ['id'],
          backField: 'posts',
          isFkHolder: false,
          joinTable: '_PostToTag',
        },
      ],
    ]),
  };
}

function tagModel(): ModelMeta {
  return {
    name: 'Tag',
    table: 'tags',
    primaryKey: 'id',
    relations: new Map([
      [
        'posts',
        {
          field: 'posts',
          targetModel: 'Post',
          isList: true,
          kind: 'many-to-many-implicit',
          fkModel: 'Tag',
          fkFields: [],
          pkModel: 'Tag',
          pkFields: ['id'],
          backField: 'tags',
          isFkHolder: false,
          joinTable: '_PostToTag',
        },
      ],
    ]),
  };
}

function registry(): Map<string, ModelMeta> {
  return new Map([
    ['User', userModel()],
    ['Post', postModel()],
    ['Tag', tagModel()],
  ]);
}

describe('ModelDelegate nested create', () => {
  it('should create parent with nested children', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'A' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 11, userId: 1, title: 'B' }], rowCount: 1 });

    const users = new ModelDelegate(driver, userModel(), registry());
    const user = await users.create({
      data: { name: 'John', posts: { create: [{ title: 'A' }, { title: 'B' }] } },
    });

    expect(user).toEqual({ id: 1, name: 'John' });
    const queries = driver.getQueries();
    expect(queries[0].sql).toContain('INSERT INTO "users"');
    expect(queries[1].sql).toContain('INSERT INTO "posts"');
    expect(queries[1].params).toContain(1);
    expect(queries).toHaveLength(3);
  });

  it('should connect existing children', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 });
    driver.setResult({ rowCount: 1 });

    const users = new ModelDelegate(driver, userModel(), registry());
    await users.create({
      data: { name: 'John', posts: { connect: [{ id: 10 }] } },
    });

    const queries = driver.getQueries();
    expect(queries[1].sql).toContain('SELECT * FROM "posts"');
    expect(queries[2].sql).toContain('UPDATE "posts" SET "userid"');
    expect(queries[2].params).toEqual([1, 10]);
  });

  it('should throw when connecting missing record', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rows: [], rowCount: 0 });

    const users = new ModelDelegate(driver, userModel(), registry());
    await expect(
      users.create({ data: { name: 'John', posts: { connect: [{ id: 999 }] } } }),
    ).rejects.toThrow('connect: no Post found');
  });

  it('should connectOrCreate existing record', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rowCount: 0 }); // acquireAdvisoryLock
    driver.setResult({ rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 });
    driver.setResult({ rowCount: 1 });
    driver.setResult({ rowCount: 0 }); // releaseAdvisoryLock

    const users = new ModelDelegate(driver, userModel(), registry());
    await users.create({
      data: {
        name: 'John',
        posts: { connectOrCreate: { where: { id: 10 }, create: { title: 'A' } } },
      },
    });

    const queries = driver.getQueries();
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO "posts"'))).toBe(false);
    expect(queries[queries.length - 2].sql).toContain('UPDATE "posts" SET "userid"');
  });

  it('should connectOrCreate new record', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rowCount: 0 }); // acquireAdvisoryLock
    driver.setResult({ rows: [], rowCount: 0 });
    driver.setResult({ rows: [{ id: 12, userId: 1, title: 'New' }], rowCount: 1 });
    driver.setResult({ rowCount: 0 }); // releaseAdvisoryLock

    const users = new ModelDelegate(driver, userModel(), registry());
    await users.create({
      data: {
        name: 'John',
        posts: { connectOrCreate: { where: { id: 12 }, create: { title: 'New' } } },
      },
    });

    const queries = driver.getQueries();
    expect(queries.some((q) => q.sql.startsWith('INSERT INTO "posts"'))).toBe(true);
  });

  it('should create M:N child with join row', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 10, title: 'A' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 100, name: 'tech' }], rowCount: 1 });
    driver.setResult({ rowCount: 1 });

    const posts = new ModelDelegate(driver, postModel(), registry());
    await posts.create({
      data: { title: 'A', tags: { create: [{ name: 'tech' }] } },
    });

    const queries = driver.getQueries();
    expect(queries[1].sql).toContain('INSERT INTO "tags"');
    expect(queries[2].sql).toContain('INSERT INTO "_PostToTag"');
    expect(queries[2].params).toEqual([10, 100]);
  });
});

describe('ModelDelegate nested update', () => {
  it('should disconnect children', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 10, userId: 1 }], rowCount: 1 });
    driver.setResult({ rowCount: 1 });

    const users = new ModelDelegate(driver, userModel(), registry());
    await users.update({
      where: { id: 1 },
      data: { posts: { disconnect: [{ id: 10 }] } },
    });

    const queries = driver.getQueries();
    expect(queries[0].sql).toContain('SELECT * FROM "users"');
    expect(queries[queries.length - 1].sql).toContain('UPDATE "posts" SET "userid"');
    expect(queries[queries.length - 1].params).toEqual([null, 10]);
  });

  it('should replace all children with set', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rowCount: 2 });
    driver.setResult({ rows: [{ id: 11, userId: null }], rowCount: 1 });
    driver.setResult({ rowCount: 1 });

    const users = new ModelDelegate(driver, userModel(), registry());
    await users.update({
      where: { id: 1 },
      data: { posts: { set: [{ id: 11 }] } },
    });

    const queries = driver.getQueries();
    expect(queries[1].sql).toContain('UPDATE "posts" SET "userid"');
    expect(queries[1].params).toEqual([null, 1]);
    expect(queries[queries.length - 1].params).toEqual([1, 11]);
  });

  it('should update nested children', async () => {
    const driver = new MockDriver();
    driver.setResult({ rows: [{ id: 1, name: 'John' }], rowCount: 1 });
    driver.setResult({ rows: [{ id: 10, userId: 1, title: 'Old' }], rowCount: 1 });
    driver.setResult({ rowCount: 1 });

    const users = new ModelDelegate(driver, userModel(), registry());
    await users.update({
      where: { id: 1 },
      data: { posts: { update: { where: { id: 10 }, data: { title: 'New' } } } },
    });

    const queries = driver.getQueries();
    expect(queries[queries.length - 1].sql).toContain('UPDATE "posts" SET "title"');
  });
});

describe('connectOrCreate race hardening', () => {
  it('concurrent connectOrCreate on same key creates exactly one row (live sqlite)', async () => {
    const driver = new SqliteDriver(':memory:');
    await driver.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');
    await driver.execute('CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, userId INTEGER)');
    await driver.execute(`INSERT INTO users (id, name) VALUES (1, 'John')`);

    const writer = new NestedWriter(driver, registry());
    const op = { posts: { connectOrCreate: { where: { title: 'A' }, create: { title: 'A' } } } };

    // Two concurrent callers, same key — in-process mutex must serialize them.
    await Promise.all([writer.update('User', { id: 1 }, op), writer.update('User', { id: 1 }, op)]);

    const rows = await driver.query<{ n: number }>('SELECT COUNT(*) AS n FROM posts');
    expect(rows.rows[0].n).toBe(1);
  });

  it('unique violation on create falls back to connect', async () => {
    // MockDriver can't throw on demand — use a scripted stub.
    // Query steps: 1) findByWhere(User) hit → 2) findByUnique(Post) miss
    // → 3) INSERT throws unique violation → 4) re-find(Post) hit.
    // (acquire/release lock + connect UPDATE go through execute, not query.)
    const throwingDriver = {
      queries: [] as Array<{ sql: string; params?: any[] }>,
      step: 0,
      async query<T>(sql: string, params?: any[]) {
        this.queries.push({ sql, params });
        this.step++;
        if (this.step === 1) return { rows: [{ id: 1, name: 'John' }], rowCount: 1 }; // findByWhere(User)
        if (this.step === 2) return { rows: [], rowCount: 0 }; // findByUnique(Post): miss
        if (this.step === 3) {
          throw new Error('UNIQUE constraint failed: posts.title'); // create loses race
        }
        return { rows: [{ id: 10, title: 'A', userId: 1 }], rowCount: 1 }; // re-find(Post): hit
      },
      async execute(sql: string, params?: any[]) {
        this.queries.push({ sql, params });
        return { rowCount: 1 };
      },
      async transaction<T>(fn: (d: any) => Promise<T>) {
        return fn(this);
      },
      async close() {},
      getPlaceholder: (i: number) => `$${i}`,
      getDialect: () => 'postgres' as const,
    };

    const writer = new NestedWriter(throwingDriver as any, registry());
    await writer.update(
      'User',
      { id: 1 },
      {
        posts: { connectOrCreate: { where: { title: 'A' }, create: { title: 'A' } } },
      },
    );

    // After the unique-violation fallback, the row must be connected, not re-created.
    const sqls = throwingDriver.queries.map((q) => q.sql);
    expect(sqls.some((s) => s.startsWith('INSERT INTO "posts"'))).toBe(true);
    expect(sqls.some((s) => s.includes('UPDATE "posts" SET "userid"'))).toBe(true);
  });

  it('mysql dialect uses GET_LOCK / RELEASE_LOCK', async () => {
    // Standalone stub — MockDriver is typed to dialect 'postgres' only.
    const mysqlDriver = {
      queries: [] as Array<{ sql: string; params?: any[] }>,
      results: [
        { rows: [{ id: 1, name: 'John' }], rowCount: 1 }, // findByWhere(User)
        { rowCount: 0 }, // GET_LOCK
        { rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 }, // findByUnique (connectOrCreate): hit
        { rows: [{ id: 10, userId: null, title: 'A' }], rowCount: 1 }, // findByUnique (connect): hit
        { rowCount: 1 }, // connect UPDATE
        { rowCount: 0 }, // RELEASE_LOCK
      ] as any[],
      async query<T>(sql: string, params?: any[]) {
        this.queries.push({ sql, params });
        return this.results.shift() ?? { rows: [], rowCount: 0 };
      },
      async execute(sql: string, params?: any[]) {
        this.queries.push({ sql, params });
        return this.results.shift() ?? { rowCount: 0 };
      },
      async transaction<T>(fn: (d: any) => Promise<T>) {
        return fn(this);
      },
      async close() {},
      getPlaceholder: (_i: number) => '?',
      getDialect: () => 'mysql' as const,
    };

    const writer = new NestedWriter(mysqlDriver as any, registry());
    await writer.update(
      'User',
      { id: 1 },
      {
        posts: { connectOrCreate: { where: { title: 'A' }, create: { title: 'A' } } },
      },
    );

    const sqls = mysqlDriver.queries.map((q) => q.sql);
    expect(sqls.some((s) => s.includes('GET_LOCK'))).toBe(true);
    expect(sqls.some((s) => s.includes('RELEASE_LOCK'))).toBe(true);
  });
});
