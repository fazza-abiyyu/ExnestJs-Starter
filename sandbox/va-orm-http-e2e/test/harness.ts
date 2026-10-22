// Harness E2E terisolasi.
//
// Menjalankan mini SQL-over-HTTP server sebagai proses terpisah, lalu
// mengarahkan @v-va/orm (yang ter-install dari tarball) ke server tersebut.
//
// Isolasi yang dijamin:
// - ORM datang dari tarball (file:../packs/*.tgz), bukan dari source repo
// - server jalan di proses terpisah (bukan import in-process)
// - tidak ada import silang ke source engine/va-orm

import { fileURLToPath } from "node:url";

const SERVER_ENTRY = fileURLToPath(
  new URL("../../mini-pg-http/src/server.ts", import.meta.url),
);

export interface MiniServer {
  url: string;
  stop(): Promise<void>;
}

/**
 * Start mini server dan tunggu sampai siap.
 * Port 0 (random) + parsing stdout `MINI_PG_READY <url>`.
 */
export async function startMiniServer(
  env: Record<string, string> = {},
): Promise<MiniServer> {
  const proc = Bun.spawn(["bun", "run", SERVER_ENTRY], {
    env: { ...process.env, PORT: "0", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  let output = "";
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value, { stream: true });
      }
    } catch {
      // stream ditutup
    }
  };

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(`mini-pg-http tidak ready dalam 15s. Output: ${output}`),
      );
    }, 15_000);

    const check = () => {
      const match = output.match(/MINI_PG_READY (\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    };

    void drain(proc.stdout as ReadableStream<Uint8Array>).then(() => check());
    void drain(proc.stderr as ReadableStream<Uint8Array>);

    const interval = setInterval(check, 50);
    void interval;
  });

  return {
    url,
    async stop() {
      proc.kill();
      await proc.exited;
    },
  };
}

/** Tabel test untuk backend postgres. */
export const USERS_DDL = `
  CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    email text,
    name text
  )
`;

export const USERS_TRUNCATE = "TRUNCATE TABLE users";
