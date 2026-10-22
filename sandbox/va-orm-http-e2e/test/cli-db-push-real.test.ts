// E2E: `va db push` + pemisahan role DDL/DML pada DB ASLI (dari env file).
//
// Memakai kredensial nyata dari:
//   engine/va-orm/connection.env  -> role aplikasi  (DML)
//   engine/va-orm/migrator.env   -> role migrator  (DDL)
//
// Kalau DB-nya tidak bisa dijangkau (mis. tunnel ke VPS belum aktif) ->
// suite di-SKIP, bukan error. Suite sintetis (role lokal) ada di
// cli-db-push.test.ts.
//
// Perhatian: test ini menyentuh DB sungguhan — tabel yang dibuat DIHAPUS
// lagi di akhir (cleanup).

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { VaClient } from "@v-va/orm";
import { appDatabaseUrl, migratorDatabaseUrl } from "./env-files.js";

const CLI = "node_modules/@v-va/orm/packages/cli/dist/bin/va.js";
const SCHEMA_FILE = "./fixtures/va.schema";
const TABLES = ["projects", "tasks"];

async function runCli(args: string[], env: Record<string, string>) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode, output: stdout + stderr };
}

async function reachable(dsn: string): Promise<boolean> {
  const { PostgresDriver } = await import("@v-va/orm/drivers/postgres");
  const driver = new PostgresDriver(dsn, {
    max: 1,
    min: 0,
    connectionTimeoutMs: 3000,
  });
  try {
    await driver.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await driver.close().catch(() => {});
  }
}

const appUrl = appDatabaseUrl();
const migratorUrl = migratorDatabaseUrl();

describe("cli db push pada DB asli (connection.env + migrator.env)", () => {
  let reachableMigrator = false;
  let reachableApp = false;

  beforeAll(async () => {
    if (!migratorUrl || !appUrl) {
      console.warn("\n[cli-db-push-real] DSN tidak ada — suite di-skip");
      return;
    }
    reachableMigrator = await reachable(migratorUrl);
    reachableApp = await reachable(appUrl);
    if (!reachableMigrator || !reachableApp) {
      console.warn(
        "\n[cli-db-push-real] DB tidak bisa dijangkau (butuh akses ke VPS / tunnel aktif) — suite di-skip",
      );
    }
  });

  afterAll(async () => {
    if (!reachableMigrator) return;
    // Bersihkan tabel yang dibuat test.
    const { PostgresDriver } = await import("@v-va/orm/drivers/postgres");
    const driver = new PostgresDriver(migratorUrl!, { max: 1, min: 0 });
    try {
      for (const table of TABLES) {
        await driver
          .execute(`DROP TABLE IF EXISTS "${table}" CASCADE`)
          .catch(() => {});
      }
    } finally {
      await driver.close().catch(() => {});
    }
  });

  it("db push dengan MIGRATOR_DATABASE_URL (role DDL) berhasil", async () => {
    if (!reachableMigrator || !reachableApp) return;

    const result = await runCli(["db", "push", "--schema", SCHEMA_FILE], {
      MIGRATOR_DATABASE_URL: migratorUrl!,
    });
    expect(result.output).toContain("Schema pushed successfully");
  });

  it("db push dengan role aplikasi saja ditolak (DDL ditolak server)", async () => {
    if (!reachableMigrator || !reachableApp) return;

    // Buang dulu supaya DDL-nya beneran dicoba.
    const { PostgresDriver } = await import("@v-va/orm/drivers/postgres");
    const cleaner = new PostgresDriver(migratorUrl!, { max: 1, min: 0 });
    try {
      for (const table of TABLES) {
        await cleaner
          .execute(`DROP TABLE IF EXISTS "${table}" CASCADE`)
          .catch(() => {});
      }
    } finally {
      await cleaner.close().catch(() => {});
    }

    const result = await runCli(["db", "push", "--schema", SCHEMA_FILE], {
      DATABASE_URL: appUrl!,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toMatch(/DDL ditolak|permission denied/i);
  });

  it("ORM dengan role aplikasi: CRUD jalan, DDL ditolak", async () => {
    if (!reachableMigrator || !reachableApp) return;

    // Pastikan tabel ada dulu (dibuat di test pertama).
    const push = await runCli(["db", "push", "--schema", SCHEMA_FILE], {
      MIGRATOR_DATABASE_URL: migratorUrl!,
    });
    expect(push.output).toContain("Schema pushed successfully");

    const va = VaClient.create({
      driver: "postgres",
      dsn: appUrl!,
      models: { project: { tableName: "projects" } },
    });

    try {
      const created = await va.repository("project").create({
        id: `p-${Date.now()}`,
        name: "Proyek Uji",
        slug: "uji",
      } as any);
      expect(created.id).toBeDefined();

      const found = await va
        .repository("project")
        .findUnique({ id: created.id } as any);
      expect(found?.name).toBe("Proyek Uji");

      // DDL dari role aplikasi harus ditolak.
      await expect(
        va.repository("project").raw("CREATE TABLE tries_ddl (x int)"),
      ).rejects.toThrow();
    } finally {
      await va.disconnect();
    }
  });
});
