// E2E terisolasi ke DB HTTP REMOTE sungguhan.
//
// Config persis seperti yang dipakai di aplikasi:
//
//   import { VaClient } from '@v-va/orm';
//   export const va = VaClient.create({
//     driver: 'http',
//     dsn: process.env.VA_HTTP_URL!,
//     http: {
//       protocol: 'generic',
//       dialect: 'postgres',
//       authToken: process.env.VA_HTTP_TOKEN!,
//       headers: {
//         'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID!,
//         'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET!,
//       },
//       timeoutMs: 8_000,
//     },
//     models: { job: { tableName: 'scrape_jobs' } },
//   });
//
// ORM-nya di-install dari TARBALL (bukan source) — same as test lain di
// sandbox ini.
//
// Env: engine/va-orm/va-orm.remote.local.env (gitignored).
// Kalau file tidak ada -> suite di-skip. Kalau ada tapi endpoint mati ->
// test GAGAL (jangan diam-diam skip, bug jadi tak terlihat).

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { VaClient } from "@v-va/orm";
import { SchemaParser } from "@v-va/orm/schema";
import { loadRemoteEnv, remoteEnvAvailable } from "./remote-env.js";

const available = remoteEnvAvailable();
const describeRemote = available ? describe : describe.skip;

if (!available) {
  console.warn(
    "\n[remote-http] env remote tidak ada — suite di-skip " +
      "(engine/va-orm/va-orm.remote.local.env)",
  );
}

describeRemote("e2e http -> DB remote (SQL gateway sungguhan)", () => {
  const env = loadRemoteEnv();
  const va = VaClient.create({
    driver: "http",
    dsn: env.VA_HTTP_URL!,
    http: {
      protocol: "generic",
      dialect: "postgres",
      authToken: env.VA_HTTP_TOKEN!,
      headers: {
        "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID!,
        "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET!,
      },
      timeoutMs: 8_000,
    },
    models: {
      job: { tableName: "scrape_jobs" },
    },
  });

  // Delegate butuh schema-aware registry.
  const schema = new SchemaParser().parse(`
    datasource db {
      provider = "postgresql"
      url      = env("DATABASE_URL")
    }

    model Job {
      id        String   @id
      targetUrl String
      status    String
      createdAt DateTime @default(now())
      updatedAt DateTime @updatedAt

      @@map("scrape_jobs")
    }
  `);

  const delegateVa = VaClient.create({
    driver: "http",
    dsn: env.VA_HTTP_URL!,
    http: {
      protocol: "generic",
      dialect: "postgres",
      authToken: env.VA_HTTP_TOKEN!,
      headers: {
        "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID!,
        "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET!,
      },
      timeoutMs: 8_000,
    },
    schema,
    models: { job: { tableName: "scrape_jobs" } },
  });

  const repo = va.repository("job");
  const probeId = crypto.randomUUID();

  beforeAll(async () => {
    // Endpoint harus hidup — kalau tidak, test harus gagal loudly.
    const health = await repo.count();
    expect(typeof health).toBe("number");
  });

  afterAll(async () => {
    // Bersihkan baris probe kalau sempat tercipta.
    await repo.deleteMany({ id: probeId } as any).catch(() => {});
    await va.disconnect();
    await delegateVa.disconnect();
  });

  it("count() jalan lewat HTTP + CF Access", async () => {
    const total = await repo.count();
    expect(Number(total)).toBeGreaterThanOrEqual(0);
  });

  it("findMany() membaca data nyata", async () => {
    const rows = await repo.findMany({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row.id).toBeDefined();
      expect(row.status).toBeDefined();
    }
  });

  it("findFirst() + where", async () => {
    const first = await repo.findFirst();
    if (!first) return; // tabel kosong
    const filtered = await repo.findMany({
      where: { status: first.status } as any,
    });
    expect(filtered.length).toBeGreaterThanOrEqual(1);
  });

  it("findUnique() by id", async () => {
    const first = await repo.findFirst();
    if (!first) return;
    const found = await repo.findUnique({ id: first.id } as any);
    expect(found?.id).toBe(first.id);
  });

  it("exists()", async () => {
    const first = await repo.findFirst();
    if (!first) return;
    expect(await repo.exists({ id: first.id } as any)).toBe(true);
  });

  it("orderBy + limit + offset", async () => {
    const rows = await repo.findMany({
      orderBy: { created_at: "desc" } as any,
      limit: 3,
    });
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it("raw() + rawOne()", async () => {
    const rows = await repo.raw('SELECT count(*) AS total FROM "scrape_jobs"');
    expect(Number(rows[0].total)).toBeGreaterThanOrEqual(0);
    const one = await repo.rawOne('SELECT id FROM "scrape_jobs" LIMIT 1');
    expect(one === null || one.id !== undefined).toBe(true);
  });

  it("aggregate lewat delegate (schema-aware)", async () => {
    const agg = await delegateVa
      .model("job")
      .aggregate({ _count: true } as any);
    expect(Number(agg._count)).toBeGreaterThanOrEqual(0);
  });

  it("CRUD penuh + cleanup (baris probe dihapus)", async () => {
    const before = await repo.count();

    // status harus 'queued' atau 'cancelled' (CHECK constraint server)
    const created = await repo.create({
      id: probeId,
      target_url: "https://probe.invalid/va-orm-http-e2e",
      status: "queued",
    } as any);
    expect(created.id).toBe(probeId);

    expect(await repo.count()).toBe(before + 1);

    const found = await repo.findUnique({ id: probeId } as any);
    expect(found?.status).toBe("queued");

    const updated = await repo.update(
      { id: probeId } as any,
      { status: "cancelled" } as any,
    );
    expect(updated.status).toBe("cancelled");

    const removed = await repo.delete({ id: probeId } as any);
    expect(removed.id).toBe(probeId);
    expect(await repo.count()).toBe(before);
  });

  it("error dari server jadi exception (tabel tidak ada)", async () => {
    await expect(
      repo.raw('SELECT * FROM "tabel_yang_tidak_ada_xyz"'),
    ).rejects.toThrow();
  });
});
