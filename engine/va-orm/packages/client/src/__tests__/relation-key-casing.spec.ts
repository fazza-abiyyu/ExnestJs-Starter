// VA-ORM Relation Key Casing Spec
//
// PostgreSQL/SQLite menyimpan identifier dalam huruf kecil (unquoted identifier
// di-fold ke lowercase), sedangkan nama field di schema bisa camelCase
// (`userId`). Loader relasi harus tetap mencocokkan baris dengan induknya.

import { describe, it, expect, afterEach } from 'bun:test';
import { MockDriver } from '../../../../test-setup.js';
import { ConnectionPool } from '../core/connection.pool.js';
import { SchemaParser } from '../../../schema/src/schema.parser.js';
import { VaClient } from '../core/va.client.js';

const SCHEMA = `
generator client {
  provider = "va-client-js"
}

datasource db {
  provider = "postgresql"
  url      = "postgres://localhost:5432/test"
}

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]

  @@map("users")
}

model Post {
  id     Int    @id @default(autoincrement())
  title  String
  userId Int
  author User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("posts")
}
`;

const sharedMock = new MockDriver();
ConnectionPool.registerFactory('postgres', () => sharedMock);

afterEach(() => {
  sharedMock.clearQueries();
  sharedMock.clearResults();
});

function createClient() {
  const ast = new SchemaParser().parse(SCHEMA);
  return VaClient.create({
    driver: 'postgres',
    dsn: 'postgres://localhost:5432/test',
    schema: ast,
  });
}

describe('relation key casing (lowercase-folded columns)', () => {
  it('include mencocokkan FK camelCase dengan key row lowercase', async () => {
    // Row dari DB: key-nya lowercase (userid), schema bilang userId.
    sharedMock.setResult({ rows: [{ id: 1, email: 'a@x.dev' }], rowCount: 1 });
    sharedMock.setResult({ rows: [{ id: 10, title: 'Hello', userid: 1 }], rowCount: 1 });

    const client = createClient();
    const users = await client.model('User').findMany({ include: { posts: true } });

    expect(users[0].posts).toEqual([{ id: 10, title: 'Hello', userid: 1 }]);
  });

  it('include one-to-one (fk di sisi child) juga toleran casing', async () => {
    sharedMock.setResult({ rows: [{ id: 10, title: 'Hello', userid: 1 }], rowCount: 1 });
    sharedMock.setResult({ rows: [{ id: 1, email: 'a@x.dev' }], rowCount: 1 });

    const client = createClient();
    const posts = await client.model('Post').findMany({ include: { author: true } });

    expect(posts[0].author).toEqual({ id: 1, email: 'a@x.dev' });
  });

  it('include many-to-many memakai key lowercase dengan benar', async () => {
    const ast = new SchemaParser().parse(`
      datasource db { provider = "postgresql" url = "x" }
      model User { id Int @id @default(autoincrement()) tags Tag[] @@map("users") }
      model Tag { id Int @id @default(autoincrement()) name String users User[] @@map("tags") }
    `);
    const client = VaClient.create({
      driver: 'postgres',
      dsn: 'postgres://localhost:5432/test',
      schema: ast,
    });

    sharedMock.setResult({ rows: [{ id: 1 }], rowCount: 1 });
    sharedMock.setResult({
      rows: [{ id: 5, name: 'x', __parent_key: 1 }],
      rowCount: 1,
    });

    const users = await client.model('User').findMany({ include: { tags: true } });
    expect(users[0].tags).toEqual([{ id: 5, name: 'x' }]);
  });
});
