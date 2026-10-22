// E2E terisolasi: `va db push` + pemisahan role DDL/DML.
//
// Skenario produksi yang diuji:
//
//   DATABASE_URL           -> role aplikasi  (DML: SELECT/INSERT/UPDATE/DELETE)
//   MIGRATOR_DATABASE_URL  -> role migrator  (DDL: CREATE TABLE, index, ...)
//
// Yang diperiksa:
//   1. `va db push` dengan MIGRATOR_DATABASE_URL -> tabel terbentuk
//   2. `va db push` dengan role aplikasi saja    -> DDL ditolak, pesan jelas
//   3. `va db push` lewat transport HTTP          -> tabel terbentuk via HTTP
//   4. ORM dengan role aplikasi                  -> CRUD jalan, DDL tetap ditolak
//
// CLI yang dipakai: binary dari TARBALL (`@v-va/orm`), bukan source repo.

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { VaClient } from "@v-va/orm";
import { startMiniServer, type MiniServer } from "./harness.js";

const CLI = "node_modules/@v-va/orm/packages/cli/dist/bin/va.js";
const SCHEMA_FILE = "./fixtures/va.schema";

// Postgres lokal + role split (dibuat oleh setup-split-roles.sh)
const SUPERUSER_URL = "postgresql://fazza_abiyyu@127.0.0.1:5432/postgres";
const SUPERUSER_TARGET_URL =
  "postgresql://fazza_abiyyu@127.0.0.1:5432/va_orm_split_test";
const DB_NAME = "va_orm_split_test";
const MIGRATOR_URL = `postgresql://va_migrator_test:migrator_test_pw@127.0.0.1:5432/${DB_NAME}`;
const APP_URL = `postgresql://va_app_test:app_test_pw@127.0.0.1:5432/${DB_NAME}`;

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

async function sqlViaHttp(
  url: string,
  sql: string,
  params: any[] = [],
): Promise<any[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`SQL gagal: ${JSON.stringify(body)}`);
  return body.rows ?? [];
}

describe("cli db push + role split (DDL vs DML)", () => {
  let adminServer: MiniServer;
  let adminUrl: string;
  let targetServer: MiniServer;
  let targetUrl: string;
  let available = true;

  beforeAll(async () => {
    // Setup butuh postgres lokal + superuser.
    try {
      // (1) koneksi ke DB 'postgres' — buat role & database
      adminServer = await startMiniServer({
        MINI_PG_BACKEND: "postgres",
        DATABASE_URL: SUPERUSER_URL,
      });
      adminUrl = `${adminServer.url}/sql`;
      await sqlViaHttp(adminUrl, "SELECT 1");
    } catch (error) {
      available = false;
      console.warn(
        `\n[cli-db-push] postgres lokal tidak tersedia — suite di-skip: ${(error as Error).message}`,
      );
      return;
    }

    // Bersihkan sisa dari run sebelumnya.
    await sqlViaHttp(adminUrl, `DROP DATABASE IF EXISTS ${DB_NAME}`);
    await sqlViaHttp(
      adminUrl,
      `CREATE ROLE va_migrator_test LOGIN PASSWORD 'migrator_test_pw'`,
    ).catch(() => {});
    await sqlViaHttp(
      adminUrl,
      `CREATE ROLE va_app_test LOGIN PASSWORD 'app_test_pw'`,
    ).catch(() => {});
    await sqlViaHttp(
      adminUrl,
      `CREATE DATABASE ${DB_NAME} OWNER va_migrator_test`,
    );

    // (2) koneksi ke DB target — grant & hak akses harus di DB yang benar
    targetServer = await startMiniServer({
      MINI_PG_BACKEND: "postgres",
      DATABASE_URL: SUPERUSER_TARGET_URL,
    });
    targetUrl = `${targetServer.url}/sql`;

    // Pemisahan hak: migrator boleh CREATE, app tidak.
    await sqlViaHttp(targetUrl, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
    await sqlViaHttp(
      targetUrl,
      `REVOKE CREATE ON SCHEMA public FROM va_app_test`,
    );
    await sqlViaHttp(
      targetUrl,
      `GRANT USAGE, CREATE ON SCHEMA public TO va_migrator_test`,
    );
    await sqlViaHttp(targetUrl, `GRANT USAGE ON SCHEMA public TO va_app_test`);
    await sqlViaHttp(
      targetUrl,
      `ALTER DEFAULT PRIVILEGES FOR ROLE va_migrator_test IN SCHEMA public ` +
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO va_app_test`,
    );
  });

  afterAll(async () => {
    if (targetServer) await targetServer.stop();
    if (adminServer) {
      await sqlViaHttp(adminUrl, `DROP DATABASE IF EXISTS ${DB_NAME}`).catch(
        () => {},
      );
      // Role harus dilepas dependensinya dulu (grant di DB target).
      for (const role of ["va_app_test", "va_migrator_test"]) {
        await sqlViaHttp(
          adminUrl,
          `REASSIGN OWNED BY ${role} TO CURRENT_USER`,
        ).catch(() => {});
        await sqlViaHttp(adminUrl, `DROP OWNED BY ${role}`).catch(() => {});
        await sqlViaHttp(adminUrl, `DROP ROLE IF EXISTS ${role}`).catch(
          () => {},
        );
      }
      await adminServer.stop();
    }
  });

  it("db push dengan MIGRATOR_DATABASE_URL membuat tabel", async () => {
    if (!available) return;

    const result = await runCli(["db", "push", "--schema", SCHEMA_FILE], {
      MIGRATOR_DATABASE_URL: MIGRATOR_URL,
    });
    expect(result.output).toContain("Schema pushed successfully");

    const tables = await sqlViaHttp(
      targetUrl,
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`,
    );
    const names = tables.map((t) => t.tablename);
    expect(names).toContain("projects");
    expect(names).toContain("tasks");
  });

  it("db push dengan role aplikasi saja ditolak dengan pesan jelas", async () => {
    if (!available) return;

    // Buang tabel dulu supaya DDL benar-benar dicoba.
    await sqlViaHttp(targetUrl, `DROP TABLE IF EXISTS tasks`);
    await sqlViaHttp(targetUrl, `DROP TABLE IF EXISTS projects`);

    const result = await runCli(["db", "push", "--schema", SCHEMA_FILE], {
      DATABASE_URL: APP_URL,
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.output).toContain("DDL ditolak");
    expect(result.output).toContain("MIGRATOR_DATABASE_URL");

    const tables = await sqlViaHttp(
      targetUrl,
      `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'`,
    );
    expect(tables[0].n).toBe(0);
  });

  it("db push lewat transport HTTP (SQL gateway) membuat tabel", async () => {
    if (!available) return;

    // Gateway HTTP -> Postgres, dengan role migrator (DDL boleh).
    const gateway = await startMiniServer({
      MINI_PG_BACKEND: "postgres",
      DATABASE_URL: MIGRATOR_URL,
    });
    try {
      const result = await runCli(["db", "push", "--schema", SCHEMA_FILE], {
        DATABASE_URL: `${gateway.url}/sql`,
      });
      expect(result.output).toContain("Schema pushed successfully");

      const tables = await sqlViaHttp(
        targetUrl,
        `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1`,
      );
      expect(tables.map((t) => t.tablename)).toContain("projects");
    } finally {
      await gateway.stop();
    }
  });

  it("ORM dengan role aplikasi: CRUD jalan, DDL tetap ditolak", async () => {
    if (!available) return;

    const va = VaClient.create({
      driver: "postgres",
      dsn: APP_URL,
      models: { project: { tableName: "projects" } },
    });

    try {
      const created = await va.repository("project").create({
        id: "p-1",
        name: "Proyek Uji",
        slug: "uji",
      } as any);
      expect(created.id).toBe("p-1");

      const found = await va
        .repository("project")
        .findUnique({ id: "p-1" } as any);
      expect(found?.name).toBe("Proyek Uji");
      expect(await va.repository("project").count()).toBe(1);

      // DDL dari role aplikasi harus ditolak server.
      await expect(
        va.repository("project").raw("CREATE TABLE tries_ddl (x int)"),
      ).rejects.toThrow();
    } finally {
      await va.disconnect();
    }
  });
});
