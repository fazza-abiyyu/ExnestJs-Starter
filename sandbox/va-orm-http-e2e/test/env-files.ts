// Loader env untuk file kredensial lokal.
//
// Format: file .env sederhana (KEY=VALUE per baris).
// File-file ini tidak pernah di-commit (sudah masuk .gitignore).

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const VA_ORM_DIR = fileURLToPath(
  new URL("../../../engine/va-orm/", import.meta.url),
);

export interface EnvFile {
  [key: string]: string;
}

export function envFilePath(name: string): string {
  return `${VA_ORM_DIR}${name}`;
}

export function envFileExists(name: string): boolean {
  return existsSync(envFilePath(name));
}

export function loadEnvFile(name: string): EnvFile {
  const path = envFilePath(name);
  if (!existsSync(path)) {
    throw new Error(`env file tidak ditemukan: ${path}`);
  }
  const out: EnvFile = {};
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const eq = text.indexOf("=");
    if (eq === -1) continue;
    const key = text.slice(0, eq).trim();
    let value = text.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Override port untuk DSN.
 *
 * Dipakai kalau DB ada di VPS dan diakses lewat SSH tunnel:
 * `VA_TEST_PGPORT=15432` → `127.0.0.1:15432`.
 */
export function applyPortOverride(dsn: string): string {
  const port = process.env.VA_TEST_PGPORT;
  if (!port) return dsn;
  try {
    const url = new URL(dsn);
    url.port = port;
    return url.toString();
  } catch {
    return dsn;
  }
}

/**
 * DSN untuk koneksi role aplikasi (DML).
 * Sumber: `connection.env` (kalau ada) → env `DATABASE_URL`.
 */
export function appDatabaseUrl(): string | undefined {
  if (envFileExists("connection.env")) {
    const env = loadEnvFile("connection.env");
    if (env.DATABASE_URL) return applyPortOverride(env.DATABASE_URL);
  }
  return process.env.DATABASE_URL;
}

/**
 * DSN untuk role migrator (DDL).
 * Sumber: `migrator.env` (kalau ada) → env `MIGRATOR_DATABASE_URL` → `DATABASE_URL`.
 */
export function migratorDatabaseUrl(): string | undefined {
  if (envFileExists("migrator.env")) {
    const env = loadEnvFile("migrator.env");
    if (env.DATABASE_URL) return applyPortOverride(env.DATABASE_URL);
  }
  return process.env.MIGRATOR_DATABASE_URL ?? process.env.DATABASE_URL;
}
