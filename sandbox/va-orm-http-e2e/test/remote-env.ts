// Loader env untuk endpoint remote.
//
// File `engine/va-orm/va-orm.remote.local.env` tidak pernah di-commit
// (sudah masuk .gitignore). Kalau tidak ada -> suite di-skip, bukan error.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ENV_FILE = fileURLToPath(
  new URL("../../../engine/va-orm/va-orm.remote.local.env", import.meta.url),
);

export interface RemoteEnv {
  VA_HTTP_URL: string;
  VA_HTTP_PROTOCOL?: string;
  VA_HTTP_DIALECT?: string;
  VA_HTTP_TOKEN: string;
  CF_ACCESS_CLIENT_ID: string;
  CF_ACCESS_CLIENT_SECRET: string;
}

export function remoteEnvAvailable(): boolean {
  return existsSync(ENV_FILE);
}

export function loadRemoteEnv(): RemoteEnv {
  if (!existsSync(ENV_FILE)) {
    throw new Error(`env remote tidak ditemukan: ${ENV_FILE}`);
  }
  const out: Record<string, string> = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
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
  return out as unknown as RemoteEnv;
}
