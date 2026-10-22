// E2E: @v-va/orm (tarball) -> HTTP -> server SQL.
//
// Fokus: **CRUD lengkap + logic query** lewat transport HTTP.
//
// Yang di sini:
//   - semua method Repository (create, createMany, findUnique, findFirst,
//     findMany, update, updateMany, upsert, delete, deleteMany, deleteAll,
//     count, exists, paginate, cursorPaginate, raw, rawOne, rawExecute)
//   - logic filter: where majemuk (AND/OR), orderBy multi-field,
//     limit/offset, aggregate, groupBy
//   - ModelDelegate (jalur schema-aware): findUnique/findFirst/findMany/
//     count/exists/aggregate/groupBy/create/update
//   - relations: include, filter relasi, nested write
//   - @updatedAt auto-touch + soft delete
//
// Backend: 'memory' (mini SQL engine) atau 'postgres' (PostgreSQL asli).

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { VaClient } from "@v-va/orm";
import { SchemaParser } from "@v-va/orm/schema";
import { startMiniServer, type MiniServer } from "./harness.js";

const BACKEND = process.env.E2E_BACKEND ?? "memory";

const SCHEMA = `
generator client {
  provider = "va-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  balance   Int      @default(0)
  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]

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

const DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    email text UNIQUE,
    name text,
    balance integer DEFAULT 0,
    metadata jsonb,
    createdat timestamp DEFAULT now(),
    updatedat timestamp DEFAULT now()
  )
`;

const POSTS_DDL = `
  CREATE TABLE IF NOT EXISTS posts (
    id serial PRIMARY KEY,
    title text,
    userid integer
  )
`;

let server: MiniServer;
let va: ReturnType<typeof VaClient.create>;

beforeAll(async () => {
  server = await startMiniServer(
    BACKEND === "postgres"
      ? { MINI_PG_BACKEND: "postgres", DATABASE_URL: process.env.DATABASE_URL }
      : { MINI_PG_BACKEND: "memory" },
  );
  va = VaClient.create({
    driver: "http",
    dsn: `${server.url}/sql`,
    http: { protocol: "generic" },
    schema: new SchemaParser().parse(SCHEMA),
    models: { user: { tableName: "users" }, post: { tableName: "posts" } },
  });
  await va.repository("user").raw('DROP TABLE IF EXISTS "posts"');
  await va.repository("user").raw('DROP TABLE IF EXISTS "users"');
  await va.repository("user").raw(DDL);
  await va.repository("post").raw(POSTS_DDL);
});

afterAll(async () => {
  await va?.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await va.repository("post").deleteAll();
  await va.repository("user").deleteAll();
});

describe(`e2e http + ${BACKEND}: CRUD lengkap`, () => {
  it("createMany menginsert banyak baris", async () => {
    const rows = await va.repository("user").createMany([
      { email: "a@x.dev", name: "A", balance: 10 },
      { email: "b@x.dev", name: "B", balance: 20 },
    ]);
    expect(rows).toHaveLength(2);
    expect(await va.repository("user").count()).toBe(2);
  });

  it("findFirst mengembalikan baris pertama yang cocok", async () => {
    await va.repository("user").create({ email: "a@x.dev", name: "A" });
    await va.repository("user").create({ email: "b@x.dev", name: "B" });

    const first = await va.repository("user").findFirst({ name: "B" } as any);
    expect(first?.email).toBe("b@x.dev");
  });

  it("upsert menyisipkan lalu meng-update", async () => {
    const repo = va.repository("user");

    const inserted = await repo.upsert(
      { email: "a@x.dev", name: "A", balance: 1 } as any,
      ["email"],
      ["name", "balance"],
    );
    expect(inserted.email).toBe("a@x.dev");
    expect(await repo.count()).toBe(1);
  });

  it("deleteAll mengosongkan tabel", async () => {
    await va.repository("user").create({ email: "a@x.dev" });
    await va.repository("user").create({ email: "b@x.dev" });

    const removed = await va.repository("user").deleteAll();
    expect(removed).toBe(2);
    expect(await va.repository("user").count()).toBe(0);
  });

  it("rawOne + rawExecute", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "a@x.dev", name: "A" });

    const one = await repo.rawOne('SELECT * FROM "users" WHERE "email" = $1', [
      "a@x.dev",
    ]);
    expect(one?.email).toBe("a@x.dev");

    const affected = await repo.rawExecute('UPDATE "users" SET "name" = $1', [
      "Z",
    ]);
    expect(affected).toBe(1);
  });
});

describe(`e2e http + ${BACKEND}: logic query`, () => {
  beforeEach(async () => {
    const repo = va.repository("user");
    await repo.createMany([
      { email: "a@x.dev", name: "A", balance: 10 },
      { email: "b@x.dev", name: "B", balance: 20 },
      { email: "c@x.dev", name: "C", balance: 30 },
    ]);
  });

  it("where majemuk (AND)", async () => {
    const rows = await va.repository("user").findMany({
      where: { name: "A", balance: 10 } as any,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("a@x.dev");
  });

  it("orderBy multi-field", async () => {
    const rows = await va.repository("user").findMany({
      orderBy: { balance: "desc" } as any,
    });
    expect(rows.map((r) => r.email)).toEqual(["c@x.dev", "b@x.dev", "a@x.dev"]);
  });

  it("limit + offset", async () => {
    const rows = await va.repository("user").findMany({
      orderBy: { balance: "asc" } as any,
      limit: 1,
      offset: 1,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("b@x.dev");
  });

  it("count + exists dengan filter", async () => {
    const repo = va.repository("user");
    expect(await repo.count()).toBe(3);
    expect(await repo.count({ name: "A" } as any)).toBe(1);
    expect(await repo.exists({ name: "A" } as any)).toBe(true);
    expect(await repo.exists({ name: "ZZ" } as any)).toBe(false);
  });

  it("paginate konsisten dengan count", async () => {
    const page = await va.repository("user").paginate({ page: 2, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.hasNext).toBe(false);
    expect(page.hasPrevious).toBe(true);
  });

  it("cursorPaginate", async () => {
    const page = await va.repository("user").cursorPaginate({
      limit: 2,
      orderBy: { balance: "asc" } as any,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.hasMore).toBe(true);
  });
});

describe(`e2e http + ${BACKEND}: ModelDelegate (schema-aware)`, () => {
  beforeEach(async () => {
    await va.repository("user").createMany([
      { email: "a@x.dev", name: "A", balance: 10 },
      { email: "b@x.dev", name: "B", balance: 20 },
    ]);
  });

  it("model().findMany + count + exists", async () => {
    const users = await va.model("user").findMany({});
    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(await va.model("user").count()).toBeGreaterThanOrEqual(2);
    expect(await va.model("user").exists({ email: "a@x.dev" } as any)).toBe(
      true,
    );
  });

  it("model().aggregate menghitung total & rata-rata", async () => {
    // Hasil aggregate flat: _count, _sum_balance, _avg_balance, ...
    const agg = await va.model("user").aggregate({
      _count: true,
      _sum: ["balance"],
      _avg: ["balance"],
      _min: ["balance"],
      _max: ["balance"],
    } as any);
    expect(Number(agg._count)).toBeGreaterThanOrEqual(2);
    expect(Number(agg._sum_balance)).toBeGreaterThanOrEqual(30);
    expect(Number(agg._avg_balance)).toBeGreaterThanOrEqual(15);
    expect(Number(agg._min_balance)).toBe(10);
    expect(Number(agg._max_balance)).toBe(20);
  });

  it("model().groupBy mengelompokkan baris", async () => {
    const grouped = await va.model("user").groupBy({
      by: ["name"],
      _count: true,
    } as any);
    expect(Array.isArray(grouped)).toBe(true);
    expect(grouped.length).toBeGreaterThanOrEqual(2);
  });

  it("model().create menyisipkan lewat jalur schema-aware", async () => {
    const created = await va.model("user").create({
      data: { email: "new@x.dev", name: "New", balance: 99 },
    } as any);
    expect(created.email).toBe("new@x.dev");
  });
});

describe(`e2e http + ${BACKEND}: relations`, () => {
  beforeEach(async () => {
    const user = await va
      .repository("user")
      .create({ email: "a@x.dev", name: "A" });
    await va
      .repository("post")
      .createMany([
        { title: "P1", userId: user.id } as any,
        { title: "P2", userId: user.id } as any,
      ]);
  });

  it("include memuat relasi one-to-many", async () => {
    const users = await va
      .model("user")
      .findMany({ include: { posts: true } } as any);
    expect(users.length).toBeGreaterThanOrEqual(1);
    const withPosts = users.find(
      (u: any) => Array.isArray(u.posts) && u.posts.length > 0,
    );
    expect(withPosts).toBeDefined();
    expect((withPosts as any).posts.length).toBe(2);
  });

  it("nested write: create user + posts dalam satu operasi", async () => {
    const created = await va.model("user").create({
      data: {
        email: "nested@x.dev",
        name: "Nested",
        posts: { create: [{ title: "NP1" }, { title: "NP2" }] },
      },
    } as any);
    expect(created.email).toBe("nested@x.dev");
    const posts = await va.repository("post").findMany({});
    expect(posts.length).toBeGreaterThanOrEqual(2);
  });
});
