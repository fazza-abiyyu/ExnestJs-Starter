process.env.NODE_ENV = 'test';

import { beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { createNestApp } from '../src/main.js';

let app: INestApplication;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  app = await createNestApp();
  await app.init();

  server = app.getHttpServer();
  server.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));

  const address = server.address();
  if (address && typeof address === 'object') {
    baseUrl = `http://127.0.0.1:${address.port}`;
  } else {
    throw new Error('could not determine test port');
  }
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('App (e2e)', () => {
  it('GET /health/live returns 200', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('ok');
  });

  it('GET /$metadata returns 200 with entity types', async () => {
    const res = await fetch(`${baseUrl}/$metadata`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { value: unknown[] };
    expect(Array.isArray(body.value)).toBe(true);
  });

  it('GET /$metadata/User returns 200', async () => {
    const res = await fetch(`${baseUrl}/$metadata/User`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { value: { name: string } };
    expect(body.value.name).toBe('User');
  });

  it('GET /$metadata/Nope returns 404 with EntityTypeNotFound', async () => {
    const res = await fetch(`${baseUrl}/$metadata/Nope`);
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EntityTypeNotFound');
  });

  it('unknown route returns 404', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
