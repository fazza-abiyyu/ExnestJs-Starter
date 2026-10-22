// Mini Postgres bridge - mengubah PostgreSQL jadi endpoint SQL-over-HTTP.
//
// Ini "mini port postgres/sql": statement SQL + params masuk lewat HTTP,
// dieksekusi oleh PostgreSQL asli, hasilnya dikembalikan sebagai JSON.
//
// Session (baton) dipakai untuk interactive transaction ala turso/libSQL:
// satu client postgres dipegang per baton sampai COMMIT/ROLLBACK/close.

import { Pool, type PoolClient } from "pg";
import type { QueryResult } from "./protocol.js";

export class PostgresBridge {
  private pool: Pool;
  private sessions = new Map<string, PoolClient>();
  private counter = 0;

  constructor(dsn: string) {
    this.pool = new Pool({
      connectionString: dsn,
      max: 10,
      connectionTimeoutMillis: 5000,
    });
  }

  async query(sql: string, params: any[] = []): Promise<QueryResult> {
    const result = await this.pool.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  /** Buka sesi transaksi baru, kembalikan baton. */
  async begin(): Promise<string> {
    const client = await this.pool.connect();
    await client.query("BEGIN");
    const baton = `sess-${++this.counter}-${Date.now().toString(36)}`;
    this.sessions.set(baton, client);
    return baton;
  }

  /** Jalankan statement pada sesi (baton). */
  async queryInSession(
    baton: string,
    sql: string,
    params: any[] = [],
  ): Promise<QueryResult> {
    const client = this.sessions.get(baton);
    if (!client) {
      // Baton sudah ditutup / tidak dikenal - jalankan di pool biasa.
      return this.query(sql, params);
    }
    const result = await client.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  async commit(baton: string): Promise<void> {
    const client = this.sessions.get(baton);
    if (!client) return;
    try {
      await client.query("COMMIT");
    } finally {
      this.sessions.delete(baton);
      client.release();
    }
  }

  async rollback(baton: string): Promise<void> {
    const client = this.sessions.get(baton);
    if (!client) return;
    try {
      await client.query("ROLLBACK");
    } finally {
      this.sessions.delete(baton);
      client.release();
    }
  }

  /** Tutup sesi (dilepas tanpa commit). */
  async release(baton: string): Promise<void> {
    const client = this.sessions.get(baton);
    if (!client) return;
    this.sessions.delete(baton);
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    for (const baton of [...this.sessions.keys()]) {
      await this.release(baton);
    }
    await this.pool.end();
  }
}
