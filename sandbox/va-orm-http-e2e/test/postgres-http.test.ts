// E2E: @v-va/orm (tarball) -> HTTP -> PostgreSQL asli.
//
// Backend "postgres" di mini-pg-http adalah bridge: statement SQL + params
// masuk lewat HTTP, dieksekusi PostgreSQL sungguhan, hasilnya JSON.
//
// Butuh PostgreSQL lokal. Default: postgres://localhost:5432/va_orm_http_e2e
// Override: DATABASE_URL=postgres://... bun test test/postgres-http.test.ts

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { VaClient } from "@v-va/orm";
import { startMiniServer, type MiniServer } from "./harness.js";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://localhost:5432/va_orm_http_e2e";

const DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    email text,
    name text
  )
`;

let server: MiniServer;
let va: ReturnType<typeof VaClient.create>;

async function reachable(): Promise<boolean> {
  try {
    const res = await fetch(`${DATABASE_URL.replace(/^postgres/, "http")}`);
    void res;
    return true;
  } catch {
    // bukan cara cek yang andal - pakai query nyata
  }
  try {
    const { PostgresDriver } = await import("@v-va/orm/drivers/postgres");
    const driver = new PostgresDriver(DATABASE_URL, {
      connectionTimeoutMs: 2000,
      max: 1,
    });
    await driver.query("SELECT 1");
    await driver.close();
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  if (!(await reachable())) {
    throw new Error(`PostgreSQL tidak bisa dijangkau: ${DATABASE_URL}`);
  }
  server = await startMiniServer({
    MINI_PG_BACKEND: "postgres",
    DATABASE_URL,
  });
  va = VaClient.create({
    driver: "http",
    dsn: `${server.url}/sql`,
    http: { protocol: "generic" },
    models: { user: { tableName: "users" } },
  });
  await va.repository("user").raw(DDL);
});

afterAll(async () => {
  await va?.disconnect();
  await server?.stop();
});

beforeEach(async () => {
  await va.repository("user").raw("TRUNCATE TABLE users");
});

describe("e2e http -> postgres asli", () => {
  it("CRUD lengkap lewat HTTP", async () => {
    const repo = va.repository("user");

    const created = await repo.create({ email: "a@x.dev", name: "A" });
    expect(created.id).toBeGreaterThan(0);
    expect(created.email).toBe("a@x.dev");

    const found = await repo.findUnique({ id: created.id as any });
    expect(found?.name).toBe("A");

    const updated = await repo.update({ id: created.id as any }, {
      name: "B",
    } as any);
    expect(updated.name).toBe("B");

    const many = await repo.findMany({ where: { name: "B" } as any });
    expect(many).toHaveLength(1);

    expect(await repo.count()).toBe(1);
    expect(await repo.exists({ email: "a@x.dev" } as any)).toBe(true);

    const removed = await repo.delete({ id: created.id as any });
    expect(removed.email).toBe("a@x.dev");
    expect(await repo.count()).toBe(0);
  });

  it("updateMany/deleteMany melaporkan rowCount yang benar", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "a@x.dev", name: "A" });
    await repo.create({ email: "b@x.dev", name: "B" });
    await repo.create({ email: "c@x.dev", name: "C" });

    expect(
      await repo.updateMany({ name: "A" } as any, { name: "X" } as any),
    ).toBe(1);
    expect(await repo.deleteMany({ name: "X" } as any)).toBe(1);
    expect(await repo.count()).toBe(2);
  });

  it("orderBy + limit + offset", async () => {
    const repo = va.repository("user");
    for (const name of ["A", "B", "C", "D", "E"]) {
      await repo.create({ email: `${name.toLowerCase()}@x.dev`, name });
    }

    const page = await repo.findMany({
      orderBy: { email: "desc" } as any,
      limit: 2,
      offset: 1,
    });
    // desc: e,d,c,b,a -> offset 1 -> d,c,b,a -> limit 2 -> d,c
    expect(page.map((r) => r.email)).toEqual(["d@x.dev", "c@x.dev"]);
  });

  it("paginate", async () => {
    const repo = va.repository("user");
    for (const name of ["A", "B", "C", "D", "E"]) {
      await repo.create({ email: `${name.toLowerCase()}@x.dev`, name });
    }
    const page = await repo.paginate({ page: 2, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.totalPages).toBe(3);
  });

  it("raw SQL", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "a@x.dev", name: "A" });
    const rows = await repo.raw('SELECT * FROM "users" WHERE "email" = $1', [
      "a@x.dev",
    ]);
    expect(rows).toHaveLength(1);
  });

  it("error SQL (400) dilempar ke caller tanpa retry panjang", async () => {
    const repo = va.repository("user");
    const started = Date.now();
    await expect(
      repo.raw('SELECT * FROM "definitely_not_a_table"'),
    ).rejects.toThrow();
    // tanpa retryable=false, retryMode=reads akan retry 3x dengan backoff
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("e2e http -> postgres, protocol neon", () => {
  let neonServer: MiniServer;
  let neonVa: ReturnType<typeof VaClient.create>;

  beforeAll(async () => {
    neonServer = await startMiniServer({
      MINI_PG_BACKEND: "postgres",
      DATABASE_URL,
    });
    neonVa = VaClient.create({
      driver: "http",
      dsn: `${neonServer.url}/sql`,
      http: { protocol: "neon" },
      models: { user: { tableName: "users" } },
    });
    await neonVa.repository("user").raw(DDL);
  });

  afterAll(async () => {
    await neonVa?.disconnect();
    await neonServer?.stop();
  });

  it("CRUD dengan body {query, params}", async () => {
    const repo = neonVa.repository("user");
    const created = await repo.create({ email: "neon@x.dev", name: "N" });
    expect(created.email).toBe("neon@x.dev");
    expect(await repo.count()).toBeGreaterThanOrEqual(1);
  });
});

describe("e2e http -> postgres, protocol turso (interactive transaction)", () => {
  let tursoServer: MiniServer;
  let tursoVa: ReturnType<typeof VaClient.create>;

  beforeAll(async () => {
    tursoServer = await startMiniServer({
      MINI_PG_BACKEND: "postgres",
      DATABASE_URL,
    });
    tursoVa = VaClient.create({
      driver: "http",
      dsn: tursoServer.url,
      // Wire format = pipeline Hrana (turso), tapi SQL-nya postgres.
      // Ini bukti bahwa "protocol" (bentuk wire) dan "dialect" (SQL) terpisah.
      http: { protocol: "turso", dialect: "postgres", placeholder: "numbered" },
      models: { user: { tableName: "users" } },
    });
    await tursoVa.repository("user").raw(DDL);
  });

  afterAll(async () => {
    await tursoVa?.disconnect();
    await tursoServer?.stop();
  });

  it("CRUD lewat pipeline /v2/pipeline", async () => {
    const repo = tursoVa.repository("user");
    const created = await repo.create({ email: "turso@x.dev", name: "T" });
    expect(created.email).toBe("turso@x.dev");

    const found = await repo.findUnique({ id: created.id as any });
    expect(found?.name).toBe("T");
  });

  it("interactive transaction benar-benar di-COMMIT", async () => {
    const repo = tursoVa.repository("user");
    const before = await repo.count();

    await tursoVa.transaction(async (tx) => {
      await tx.repository("user").create({ email: "tx@x.dev", name: "TX" });
      await tx.repository("user").create({ email: "tx2@x.dev", name: "TX2" });
    });

    expect(await repo.count()).toBe(before + 2);
  });

  it("interactive transaction yang GAGAL di-ROLLBACK", async () => {
    const repo = tursoVa.repository("user");
    const before = await repo.count();

    await expect(
      tursoVa.transaction(async (tx) => {
        await tx
          .repository("user")
          .create({ email: "rollback@x.dev", name: "RB" });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // row harus hilang (rollback)
    expect(await repo.count()).toBe(before);
    const leftover = await repo.findMany({
      where: { email: "rollback@x.dev" } as any,
    });
    expect(leftover).toHaveLength(0);
  });
});
