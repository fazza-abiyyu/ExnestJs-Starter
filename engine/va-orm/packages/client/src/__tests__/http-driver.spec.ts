// VA-ORM HTTP Driver Spec — SQL over HTTP transport
import { describe, it, expect } from 'bun:test';
import { HttpDriver } from '../drivers/http/http.driver.js';
import {
  HTTP_PROFILES,
  detectHttpProtocol,
  resolveHttpProfile,
  encodeTursoValue,
  decodeTursoValue,
} from '../drivers/http/http.protocols.js';
import { VaClient } from '../core/va.client.js';
import { ConnectionPool } from '../core/connection.pool.js';

interface MockCall {
  url: string;
  body: any;
  headers: Record<string, string>;
  method: string;
}

/** Fetch palsu yang mencatat request dan membalas dengan payload dari handler. */
function mockFetch(handler: (body: any, call: MockCall) => any): {
  fn: typeof globalThis.fetch;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  const fn = (async (url: any, init: any) => {
    const call: MockCall = {
      url: String(url),
      body: init?.body ? JSON.parse(init.body) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
      method: init?.method ?? 'GET',
    };
    calls.push(call);
    const payload = handler(call.body, call);
    if (payload instanceof Response) return payload;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

describe('http protocol profiles', () => {
  it('generic posts {sql, params} and accepts several response shapes', () => {
    const profile = HTTP_PROFILES.generic;
    expect(profile.buildBody('SELECT 1', [1], {})).toEqual({ sql: 'SELECT 1', params: [1] });
    expect(profile.mapResponse({ rows: [{ id: 1 }] }).rows).toEqual([{ id: 1 }]);
    expect(profile.mapResponse({ data: [{ id: 2 }] }).rows).toEqual([{ id: 2 }]);
    expect(profile.mapResponse([{ id: 3 }]).rows).toEqual([{ id: 3 }]);
    expect(profile.mapResponse({ rows: [{ id: 1 }], rowCount: 7 }).rowCount).toBe(7);
  });

  it('neon posts {query, params} and maps array or {rows}', () => {
    const profile = HTTP_PROFILES.neon;
    expect(profile.buildBody('SELECT $1', [5], {})).toEqual({ query: 'SELECT $1', params: [5] });
    expect(profile.mapResponse([{ id: 1 }]).rows).toEqual([{ id: 1 }]);
    expect(profile.mapResponse({ rows: [{ id: 2 }], rowCount: 1 }).rowCount).toBe(1);
  });

  it('neon merges array-rows with the fields list (bentuk respons Neon asli)', () => {
    // Respons mentah Neon: rows = array-of-arrays, fields = daftar kolom.
    const profile = HTTP_PROFILES.neon;
    const mapped = profile.mapResponse({
      command: 'SELECT',
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: 'email', dataTypeID: 25 },
      ],
      rowCount: 1,
      rows: [[1, 'a@x.dev']],
    });
    expect(mapped.rows).toEqual([{ id: 1, email: 'a@x.dev' }]);
    expect(mapped.rowCount).toBe(1);
  });

  it('accelerate maps {data} and raises remote errors', () => {
    const profile = HTTP_PROFILES.accelerate;
    expect(profile.buildBody('SELECT 1', [], {})).toEqual({ query: 'SELECT 1', params: [] });
    expect(profile.mapResponse({ data: [{ id: 9 }] }).rows).toEqual([{ id: 9 }]);
    expect(() => profile.mapResponse({ error: 'boom' })).toThrow(/boom/);
  });

  it('d1 maps result[0].results and falls back to meta.changes', () => {
    const profile = HTTP_PROFILES.d1;
    expect(profile.buildBody('SELECT ?', ['a'], {})).toEqual({ sql: 'SELECT ?', params: ['a'] });
    const ok = profile.mapResponse({ result: [{ results: [{ id: 1 }], success: true }] });
    expect(ok.rows).toEqual([{ id: 1 }]);
    expect(ok.rowCount).toBe(1);
    const write = profile.mapResponse({
      result: [{ results: [], success: true, meta: { changes: 3 } }],
    });
    expect(write.rowCount).toBe(3);
    expect(() => profile.mapResponse({ success: false, errors: [{ message: 'nope' }] })).toThrow();
  });

  it('turso builds a pipeline request and decodes typed values', () => {
    const profile = HTTP_PROFILES.turso;
    const body = profile.buildBody('SELECT * FROM t WHERE id = ?', [42], { close: true }) as any;
    expect(body.baton).toBeNull();
    expect(body.requests[0].type).toBe('execute');
    expect(body.requests[0].stmt.args).toEqual([{ type: 'integer', value: '42' }]);
    expect(body.requests[1]).toEqual({ type: 'close' });

    const mapped = profile.mapResponse({
      baton: 'baton-1',
      results: [
        {
          type: 'ok',
          response: {
            type: 'execute',
            result: {
              cols: [{ name: 'id' }, { name: 'name' }],
              rows: [
                [
                  { type: 'integer', value: '1' },
                  { type: 'text', value: 'a' },
                ],
              ],
              affected_row_count: 0,
            },
          },
        },
      ],
    });
    expect(mapped.rows).toEqual([{ id: 1, name: 'a' }]);
    expect(mapped.baton).toBe('baton-1');
  });

  it('encodes and decodes libSQL values', () => {
    expect(encodeTursoValue(null)).toEqual({ type: 'null', value: null });
    expect(encodeTursoValue(1.5)).toEqual({ type: 'float', value: '1.5' });
    expect(encodeTursoValue(true)).toEqual({ type: 'integer', value: '1' });
    expect(encodeTursoValue('x')).toEqual({ type: 'text', value: 'x' });
    expect(decodeTursoValue({ type: 'integer', value: '7' })).toBe(7);
    expect(decodeTursoValue({ type: 'null', value: null })).toBeNull();
  });

  it('detects the protocol from the endpoint host', () => {
    expect(detectHttpProtocol('https://db-foo.turso.io')).toBe('turso');
    expect(detectHttpProtocol('https://api.cloudflare.com/client/v4/x')).toBe('d1');
    expect(detectHttpProtocol('https://ep-cool-name.neon.tech')).toBe('neon');
    expect(detectHttpProtocol('https://accelerate.prisma-data.net/?api_key=x')).toBe('accelerate');
    expect(detectHttpProtocol('https://sql.example.com')).toBe('generic');
    expect(detectHttpProtocol('not a url')).toBe('generic');
  });

  it('lets options override dialect and placeholder', () => {
    const profile = resolveHttpProfile({
      protocol: 'generic',
      dialect: 'sqlite',
      placeholder: 'positional',
    });
    expect(profile.dialect).toBe('sqlite');
    expect(profile.placeholder).toBe('positional');
    expect(() => resolveHttpProfile({ protocol: 'bogus' as any })).toThrow(/Unknown http protocol/);
  });
});

describe('HttpDriver', () => {
  it('rejects non-http URLs', () => {
    expect(() => new HttpDriver('file:///tmp/db.sqlite')).toThrow(/unsupported protocol/);
    expect(() => new HttpDriver('not-a-url')).toThrow(/invalid endpoint URL/);
  });

  it('uses numbered placeholders for postgres and positional for sqlite', () => {
    expect(new HttpDriver('https://x.dev', { protocol: 'neon' }).getPlaceholder(2)).toBe('$2');
    expect(new HttpDriver('https://x.dev', { protocol: 'd1' }).getPlaceholder(2)).toBe('?');
  });

  it('reports the remote engine dialect, not the transport', () => {
    expect(new HttpDriver('https://x.dev', { protocol: 'neon' }).getDialect()).toBe('postgres');
    expect(new HttpDriver('https://x.dev', { protocol: 'turso' }).getDialect()).toBe('sqlite');
  });

  it('sends the statement and maps rows', async () => {
    const { fn, calls } = mockFetch(() => ({ rows: [{ id: 1 }] }));
    const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fn });
    const result = await driver.query('SELECT * FROM users WHERE id = $1', [1]);
    expect(result.rows).toEqual([{ id: 1 }]);
    expect(result.rowCount).toBe(1);
    expect(calls[0].body).toEqual({ query: 'SELECT * FROM users WHERE id = $1', params: [1] });
    expect(calls[0].method).toBe('POST');
  });

  it('sends the bearer token and custom headers', async () => {
    const { fn, calls } = mockFetch(() => ({ rows: [] }));
    const driver = new HttpDriver('https://x.dev/query', {
      protocol: 'neon',
      fetch: fn,
      authToken: 'secret-token',
      headers: { 'x-api-key': 'key-123' },
    });
    await driver.query('SELECT 1');
    expect(calls[0].headers.authorization).toBe('Bearer secret-token');
    expect(calls[0].headers['x-api-key']).toBe('key-123');
    expect(calls[0].headers['content-type']).toBe('application/json');
  });

  it('maps a non-2xx response to a VaError', async () => {
    const { fn } = mockFetch(() => new Response('upstream exploded', { status: 502 }));
    const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fn });
    await expect(driver.query('SELECT 1')).rejects.toThrow(/502/);
  });

  it('marks 4xx as non-retryable so the pool does not hammer the endpoint', async () => {
    const { fn } = mockFetch(() => new Response('bad sql', { status: 400 }));
    const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fn });
    try {
      await driver.query('SELECT 1');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as any).retryable).toBe(false);
    }
  });

  it('keeps 5xx retryable', async () => {
    const { fn } = mockFetch(() => new Response('boom', { status: 503 }));
    const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fn });
    try {
      await driver.query('SELECT 1');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as any).retryable).toBe(true);
    }
  });

  it('rejects a non-JSON response', async () => {
    const { fn } = mockFetch(() => new Response('<html>oops</html>', { status: 200 }));
    const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fn });
    await expect(driver.query('SELECT 1')).rejects.toThrow(/not valid JSON/);
  });

  it('does not retry a 4xx response through the pool', async () => {
    const { fn, calls } = mockFetch(() => new Response('bad sql', { status: 400 }));
    const pool = new ConnectionPool('http', 'https://x.dev/query', {
      http: { protocol: 'neon', fetch: fn },
      min: 1,
      max: 2,
      retryAttempts: 3,
      retryDelayMs: 10,
    });
    try {
      await expect(pool.query('SELECT * FROM broken')).rejects.toThrow(/400/);
      // 1 percobaan saja — error 4xx bukan transient.
      expect(calls.length).toBe(1);
    } finally {
      await pool.close();
    }
  });

  it('refuses interactive transactions on stateless protocols', async () => {
    const { fn } = mockFetch(() => ({ rows: [] }));
    const driver = new HttpDriver('https://x.dev/query', { protocol: 'neon', fetch: fn });
    await expect(driver.transaction(async () => 1)).rejects.toThrow(/stateless/);
  });

  it('runs a session transaction over a turso stream', async () => {
    const { fn, calls } = mockFetch((body) => ({
      baton: 'baton-9',
      results: [
        {
          type: 'ok',
          response: {
            type: 'execute',
            result: { cols: [{ name: 'id' }], rows: [[{ type: 'integer', value: '1' }]] },
          },
        },
      ],
    }));
    const driver = new HttpDriver('https://db.turso.io', { protocol: 'turso', fetch: fn });
    const value = await driver.transaction(async (tx) => {
      const res = await tx.query('INSERT INTO t VALUES (1)');
      return res.rows[0].id;
    });
    expect(value).toBe(1);
    // BEGIN → statement → COMMIT, all on the same stream.
    expect(calls.length).toBe(3);
    expect(calls[0].body.requests[0].stmt.sql).toBe('BEGIN');
    expect(calls[1].body.baton).toBe('baton-9');
    expect(calls[2].body.requests[0].stmt.sql).toBe('COMMIT');
    expect(calls[2].body.requests[1]).toEqual({ type: 'close' });
  });
});

describe('VaClient with driver: http', () => {
  it('runs repository queries through the http transport', async () => {
    const { fn, calls } = mockFetch(() => ({
      rows: [{ id: 1, email: 'a@x.dev' }],
    }));
    const va = VaClient.create({
      driver: 'http',
      dsn: 'https://ep-x.neon.tech/sql',
      http: { protocol: 'neon', fetch: fn },
      models: { user: { tableName: 'users' } },
    });

    const user = await va.repository('user').findUnique({ id: 1 });
    expect(user).toEqual({ id: 1, email: 'a@x.dev' });
    expect(calls[0].url).toBe('https://ep-x.neon.tech/sql');
    expect(calls[0].body.query).toContain('FROM "users"');
    expect(calls[0].body.params).toEqual([1]);
    await va.disconnect();
  });

  it('uses the remote dialect for identifier quoting', async () => {
    const { fn, calls } = mockFetch(() => ({ rows: [] }));
    const va = VaClient.create({
      driver: 'http',
      dsn: 'https://db.turso.io',
      http: { protocol: 'turso', fetch: fn },
      models: { user: { tableName: 'users' } },
    });
    await va.repository('user').findMany({ where: { id: 1 } });
    expect(calls[0].body.requests[0].stmt.sql).toContain('"users"');
    await va.disconnect();
  });

  it('resolves the placeholder before the pool finishes initializing', async () => {
    // Placeholder harus diketahui sinkron — pool belum tentu punya driver
    // ketika statement pertama disusun.
    const { fn, calls } = mockFetch(() => ({ rows: [] }));
    const va = VaClient.create({
      driver: 'http',
      dsn: 'https://db.turso.io',
      http: { protocol: 'turso', fetch: fn },
      models: { user: { tableName: 'users' } },
    });
    await va.repository('user').findMany({ where: { id: 1 } });
    const sql = calls[0].body.requests[0].stmt.sql as string;
    expect(sql).toContain('?');
    expect(sql).not.toContain('$1');
    await va.disconnect();
  });

  it('uses numbered placeholders for a postgres endpoint', async () => {
    const { fn, calls } = mockFetch(() => ({ rows: [] }));
    const va = VaClient.create({
      driver: 'http',
      dsn: 'https://ep-x.neon.tech/sql',
      http: { fetch: fn },
      models: { user: { tableName: 'users' } },
    });
    await va.repository('user').findMany({ where: { id: 1 } });
    expect(calls[0].body.query).toContain('$1');
    await va.disconnect();
  });
});
