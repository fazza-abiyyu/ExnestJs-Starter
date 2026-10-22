// E2E: @v-va/orm (tarball) -> HTTP -> mini in-memory SQL engine.
//
// Tidak butuh database sungguhan: hanya global fetch + engine mini.
//
// CATATAN API: `repository().create(data)` menerima data langsung (bukan
// `{ data: ... }` seperti Prisma). Bentuk `{ data }` dipakai oleh
// `model().create({ data })` (ModelDelegate).

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

let server: MiniServer;
let va: ReturnType<typeof VaClient.create>;

const DDL =
  "CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, email text, name text)";

beforeAll(async () => {
  server = await startMiniServer({ MINI_PG_BACKEND: "memory" });
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
  await va.repository("user").deleteAll();
});

describe("e2e http + mini in-memory engine", () => {
  it("connect() handshake lewat HTTP", async () => {
    await va.connect();
    expect(await va.isHealthy()).toBe(true);
  });

  it("create -> findUnique round-trip", async () => {
    const created = await va
      .repository("user")
      .create({ email: "a@x.dev", name: "A" });
    expect(created.email).toBe("a@x.dev");
    expect(created.id).toBeDefined();

    const found = await va
      .repository("user")
      .findUnique({ id: created.id as any });
    expect(found?.email).toBe("a@x.dev");
  });

  it("findMany + where + orderBy + limit", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "b@x.dev", name: "B" });
    await repo.create({ email: "a@x.dev", name: "A" });
    await repo.create({ email: "c@x.dev", name: "C" });

    const rows = await repo.findMany({
      where: { name: "A" },
      orderBy: { email: "asc" },
      limit: 10,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("a@x.dev");
  });

  it("count + exists", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "a@x.dev", name: "A" });
    await repo.create({ email: "b@x.dev", name: "B" });

    expect(await repo.count()).toBe(2);
    expect(await repo.count({ email: "a@x.dev" } as any)).toBe(1);
    expect(await repo.exists({ email: "zz@x.dev" } as any)).toBe(false);
  });

  it("update (RETURNING *) mengembalikan row terbaru", async () => {
    const repo = va.repository("user");
    const created = await repo.create({ email: "a@x.dev", name: "A" });

    const updated = await repo.update({ id: created.id as any }, {
      name: "Updated",
    } as any);
    expect(updated.name).toBe("Updated");

    const reloaded = await repo.findUnique({ id: created.id as any });
    expect(reloaded?.name).toBe("Updated");
  });

  it("updateMany + deleteMany melaporkan rowCount", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "a@x.dev", name: "A" });
    await repo.create({ email: "b@x.dev", name: "B" });

    const updated = await repo.updateMany(
      { name: "A" } as any,
      { name: "X" } as any,
    );
    expect(updated).toBe(1);

    const deleted = await repo.deleteMany({ name: "X" } as any);
    expect(deleted).toBe(1);
    expect(await repo.count()).toBe(1);
  });

  it("delete mengembalikan row yang dihapus", async () => {
    const repo = va.repository("user");
    const created = await repo.create({ email: "a@x.dev", name: "A" });
    const deleted = await repo.delete({ id: created.id as any });
    expect(deleted.email).toBe("a@x.dev");
    expect(await repo.count()).toBe(0);
  });

  it("paginate menghitung total dengan benar", async () => {
    const repo = va.repository("user");
    for (const name of ["A", "B", "C", "D", "E"]) {
      await repo.create({ email: `${name.toLowerCase()}@x.dev`, name });
    }

    const page = await repo.paginate({ page: 2, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.items).toHaveLength(2);
    expect(page.totalPages).toBe(3);
    expect(page.hasNext).toBe(true);
    expect(page.hasPrevious).toBe(true);
  });

  it("raw SQL lewat HTTP", async () => {
    const repo = va.repository("user");
    await repo.create({ email: "a@x.dev", name: "A" });
    const rows = await repo.raw('SELECT * FROM "users" WHERE "email" = $1', [
      "a@x.dev",
    ]);
    expect(rows).toHaveLength(1);
  });

  it("error SQL di server jadi exception di client", async () => {
    const repo = va.repository("user");
    await expect(repo.raw('SELECT * FROM "not_a_table"')).rejects.toThrow();
  });

  it("protocol stateless menolak interactive transaction", async () => {
    await expect(
      va.transaction(async () => {
        await va.repository("user").create({ email: "tx@x.dev", name: "TX" });
      }),
    ).rejects.toThrow(/stateless/);
  });
});

describe("e2e http + protocol turso (pipeline)", () => {
  let tursoServer: MiniServer;
  let tursoVa: ReturnType<typeof VaClient.create>;

  beforeAll(async () => {
    tursoServer = await startMiniServer({ MINI_PG_BACKEND: "memory" });
    tursoVa = VaClient.create({
      driver: "http",
      dsn: tursoServer.url,
      http: { protocol: "turso" },
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
    const created = await repo.create({ email: "t@x.dev", name: "T" });
    expect(created.email).toBe("t@x.dev");

    const found = await repo.findUnique({ id: created.id as any });
    expect(found?.name).toBe("T");

    expect(await repo.count()).toBe(1);
  });
});
