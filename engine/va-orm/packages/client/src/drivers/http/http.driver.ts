// VA-ORM HTTP Driver — SQL over HTTP
//
// Menjalankan SQL lewat endpoint http/https alih-alih koneksi TCP.
// Cocok untuk: Neon serverless, Prisma Accelerate, Cloudflare D1, Turso/libSQL,
// atau endpoint SQL-over-HTTP sendiri.
//
// Kontrak `DatabaseDriver` tetap sama (sql + params), jadi Repository,
// QueryBuilder, relation, dan pagination tidak berubah sama sekali.
//
// Catatan penting:
// - Transport HTTP bersifat stateless. Interactive transaction hanya mungkin
//   bila protocol mendukung session/stream (turso). Selain itu `transaction()`
//   melempar error eksplisit — bukan diam-diam berjalan tanpa transaksi.
// - Placeholder mengikuti dialect server: `$1` (postgres) atau `?` (sqlite).
// - Query retry tetap mengikuti aturan pool (hanya read yang di-retry).

import { VaError } from '../../core/errors.js';
import { safeJsonParse } from '../../core/security.js';
import type {
  DatabaseDriver,
  HttpClientOptions,
  HttpRequestContext,
  HttpResponseMapping,
  QueryResult,
  SqlDialect,
} from '../../core/types.js';
import {
  detectHttpProtocol,
  resolveHttpProfile,
  type HttpProtocolProfile,
} from './http.protocols.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ERROR_BODY = 500;

function truncate(text: string, max = MAX_ERROR_BODY): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated)`;
}

export class HttpDriver implements DatabaseDriver {
  /** true hanya kalau protocol punya session/stream (turso). */
  readonly supportsTransactions: boolean;

  private readonly url: string;
  private readonly options: HttpClientOptions;
  private readonly profile: HttpProtocolProfile;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  /** Session aktif (turso): menyimpan baton stream yang terbuka. */
  private session: { baton: string | null } | null = null;

  constructor(url: string, options: HttpClientOptions = {}) {
    this.url = HttpDriver.validateUrl(url);
    this.options = options;
    this.profile = resolveHttpProfile({
      ...options,
      protocol: options.protocol ?? detectHttpProtocol(this.url),
    });
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.supportsTransactions = this.profile.supportsSession;

    if (typeof this.fetchImpl !== 'function') {
      throw new VaError('http driver requires a fetch implementation (Node 18+, Bun, Workers)', {
        code: 'HTTP_NO_FETCH',
      });
    }
  }

  /** Hanya http/https yang diterima — menolak `file:` dsb. */
  static validateUrl(url: string): string {
    if (!url || typeof url !== 'string') {
      throw new VaError('http driver requires an endpoint URL', { code: 'HTTP_INVALID_URL' });
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new VaError(`http driver: invalid endpoint URL: ${truncate(url, 80)}`, {
        code: 'HTTP_INVALID_URL',
      });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new VaError(
        `http driver: unsupported protocol "${parsed.protocol}" — use http:// or https://`,
        { code: 'HTTP_INVALID_URL' },
      );
    }
    return url;
  }

  /** Profile protocol aktif (berguna untuk diagnosa). */
  getProtocol(): string {
    return this.profile.name;
  }

  // ============ READ / WRITE ============

  async query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>> {
    const result = await this.send(sql, params ?? []);
    return { rows: result.rows as T[], rowCount: result.rowCount };
  }

  async execute(sql: string, params?: any[]): Promise<{ rowCount: number }> {
    const result = await this.send(sql, params ?? []);
    return { rowCount: result.rowCount };
  }

  // ============ TRANSACTION ============

  /**
   * Transaction hanya bisa dijamin bila protocol mendukung session
   * (turso/libSQL stream). Untuk protocol stateless, interactive transaction
   * mustahil — lempar error supaya tidak ada write yang lolos tanpa rollback.
   */
  async transaction<T>(fn: (driver: DatabaseDriver) => Promise<T>): Promise<T> {
    if (!this.profile.supportsSession) {
      throw new VaError(
        `http protocol "${this.profile.name}" is stateless — interactive transactions are not supported. ` +
          'Use a batch/array API, or switch to a session-capable protocol (turso).',
        { code: 'HTTP_TRANSACTION_UNSUPPORTED' },
      );
    }
    if (this.session) {
      throw new VaError('http transaction already in progress (nested transactions unsupported)', {
        code: 'HTTP_TRANSACTION_NESTED',
      });
    }

    this.session = { baton: null };
    try {
      await this.send('BEGIN', [], { close: false });
      const result = await fn(this.createSessionDriver());
      await this.send('COMMIT', [], { close: true });
      return result;
    } catch (error) {
      try {
        await this.send('ROLLBACK', [], { close: true });
      } catch {
        // ignore — rollback best-effort, error asli yang lebih penting
      }
      throw error;
    } finally {
      this.session = null;
    }
  }

  /** Driver yang dipakai di dalam transaction — berbagi session state. */
  private createSessionDriver(): DatabaseDriver {
    const parent = this;
    const sessionDriver: DatabaseDriver = {
      query: async <R = any>(sql: string, params?: any[]) => {
        const result = await parent.send(sql, params ?? [], { close: false });
        return { rows: result.rows as R[], rowCount: result.rowCount };
      },
      execute: async (sql: string, params?: any[]) => {
        const result = await parent.send(sql, params ?? [], { close: false });
        return { rowCount: result.rowCount };
      },
      transaction: async <R>(fn: (driver: DatabaseDriver) => Promise<R>): Promise<R> => {
        throw new VaError('http transactions cannot be nested', {
          code: 'HTTP_TRANSACTION_NESTED',
        });
      },
      close: async () => {},
      getPlaceholder: (index: number) => parent.getPlaceholder(index),
      getDialect: () => parent.getDialect(),
    };
    return sessionDriver;
  }

  // ============ LIFECYCLE ============

  async close(): Promise<void> {
    this.session = null;
  }

  // ============ DIALECT ============

  getPlaceholder(index: number): string {
    return this.profile.placeholder === 'positional' ? '?' : `$${index}`;
  }

  getDialect(): SqlDialect {
    return this.profile.dialect;
  }

  // ============ TRANSPORT ============

  private resolveTargetUrl(): string {
    const path = this.profile.path;
    if (!path) return this.url;
    if (this.url.endsWith(path)) return this.url;
    return `${this.url.replace(/\/+$/, '')}${path}`;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(this.options.headers ?? {}),
    };
    if (this.options.authToken) {
      headers.authorization = `Bearer ${this.options.authToken}`;
    }
    return headers;
  }

  private async send(
    sql: string,
    params: any[],
    opts: { close?: boolean } = {},
  ): Promise<HttpResponseMapping> {
    const ctx: HttpRequestContext = {
      baton: this.session?.baton ?? null,
      close: opts.close ?? this.session === null,
    };

    const body = this.options.buildBody
      ? this.options.buildBody(sql, params, ctx)
      : this.profile.buildBody(sql, params, ctx);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.resolveTargetUrl(), {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw VaError.wrap(error, 'http query', 'HTTP_ERROR');
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      // 4xx = kesalahan permintaan (SQL salah, auth, endpoint) -> tidak
      // transient, retry cuma memperlambat. 408/429 tetap boleh di-retry.
      const clientError =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429;
      throw new VaError(
        `http query failed: ${response.status} ${response.statusText} — ${truncate(text)}`,
        { code: 'HTTP_STATUS', retryable: !clientError },
      );
    }

    let parsed: any = null;
    if (text.trim().length > 0) {
      parsed = safeJsonParse(text);
      if (parsed === undefined) {
        throw new VaError('http response is not valid JSON', { code: 'HTTP_INVALID_JSON' });
      }
    }

    let mapped: HttpResponseMapping;
    try {
      mapped = this.options.mapResponse
        ? this.options.mapResponse(parsed)
        : this.profile.mapResponse(parsed);
    } catch (error) {
      throw VaError.wrap(error, 'http query', 'HTTP_REMOTE_ERROR');
    }

    if (this.session && mapped.baton !== undefined) {
      this.session.baton = mapped.baton;
    }

    return mapped;
  }
}
