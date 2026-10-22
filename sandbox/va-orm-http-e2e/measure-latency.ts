// Ukur latency transport: HTTP gateway (remote) vs TCP (lewat tunnel).
//
// Metrik: p50 / p95 / min / max dari N request, plus waktu cold (request
// pertama, belum ada koneksi pool).

import { VaClient } from '@v-va/orm';
import { loadRemoteEnv, remoteEnvAvailable } from './test/remote-env.js';
import { appDatabaseUrl, migratorDatabaseUrl } from './test/env-files.js';

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
  return {
    n: sorted.length,
    min: sorted[0]!.toFixed(1),
    p50: p(0.5).toFixed(1),
    p95: p(0.95).toFixed(1),
    max: sorted[sorted.length - 1]!.toFixed(1),
    avg: (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1),
  };
}

function fmt(label: string, s: ReturnType<typeof stats>) {
  console.log(
    `  ${label.padEnd(34)} n=${String(s.n).padStart(3)}  min=${String(s.min).padStart(7)}ms  ` +
      `p50=${String(s.p50).padStart(7)}ms  p95=${String(s.p95).padStart(7)}ms  ` +
      `max=${String(s.max).padStart(7)}ms  avg=${String(s.avg).padStart(7)}ms`,
  );
}

const N = Number(process.env.LAT_N ?? 30);

// ---------- 1. HTTP gateway ----------
if (remoteEnvAvailable()) {
  const env = loadRemoteEnv();
  const url = `${env.VA_HTTP_URL}`;

  const rawTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.VA_HTTP_TOKEN}`,
          'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
          'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
        },
        body: JSON.stringify({ sql: 'SELECT 1' }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      console.error(`  [warn] request ${i + 1} gagal: ${(error as Error).message}`);
    }
    rawTimes.push(performance.now() - t0);
  }

  const va = VaClient.create({
    driver: 'http',
    dsn: url,
    http: {
      protocol: 'generic',
      dialect: 'postgres',
      authToken: env.VA_HTTP_TOKEN,
      headers: {
        'CF-Access-Client-Id': env.CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': env.CF_ACCESS_CLIENT_SECRET,
      },
      timeoutMs: 8000,
    },
    models: { job: { tableName: 'scrape_jobs' } },
  });

  const ormTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await va.repository('job').findMany({ limit: 5 });
    ormTimes.push(performance.now() - t0);
  }
  await va.disconnect();

  console.log('\n=== HTTP gateway (sqlgw-…v-va.cc, Cloudflare Access) ===');
  fmt('fetch() SELECT 1 (raw)', stats(rawTimes));
  fmt('ORM findMany (limit 5)', stats(ormTimes));
}

// ---------- 2. TCP lewat tunnel ----------
const appUrl = appDatabaseUrl();
if (appUrl) {
  const { PostgresDriver } = await import('@v-va/orm/drivers/postgres');
  const driver = new PostgresDriver(appUrl, { max: 5, min: 1 });

  const times: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await driver.query('SELECT 1');
    times.push(performance.now() - t0);
  }

  const va = VaClient.create({
    driver: 'postgres',
    dsn: appUrl,
    models: { job: { tableName: 'scrape_jobs' } },
  });
  const ormTimes: number[] = [];
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    try {
      await va.repository('job').findMany({ limit: 5 });
    } catch {
      // tabel scrape_jobs mungkin tidak ada di DB ini - abaikan
    }
    ormTimes.push(performance.now() - t0);
  }
  await va.disconnect();
  await driver.close();

  console.log('\n=== TCP Postgres (lewat SSH tunnel) ===');
  fmt('driver.query SELECT 1', stats(times));
  fmt('ORM findMany (limit 5)', stats(ormTimes));
}

console.log(
  '\ncatatan: latensi HTTP = RTT ke gateway + TLS + Cloudflare Access + query.',
);
process.exit(0);
