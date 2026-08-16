import { describe, expect, mock, test } from 'bun:test';
import { PdfEngine } from './engine.js';
import type { DocumentStore, StreamDocument } from './types.js';

let seq = 0;
const now = new Date();

function makeDoc(overrides: Partial<StreamDocument> = {}): StreamDocument {
  seq++;
  return {
    id: `doc-${seq}`,
    tenantId: 't1',
    name: 'doc.pdf',
    source: 'FILE',
    sourceUrl: null,
    fileName: 'doc.pdf',
    filePath: null,
    watermark: null,
    pageCount: 0,
    status: 'pending',
    attempt: 0,
    readyAt: null,
    errorMsg: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

interface Fake {
  store: DocumentStore;
  getRows(): StreamDocument[];
}

async function catchCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

function createStore(): Fake {
  const rows: StreamDocument[] = [];
  const store: DocumentStore = {
    create: mock((input) => {
      const doc = makeDoc({
        id: input.id,
        tenantId: input.tenantId,
        name: input.name,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        fileName: input.fileName ?? null,
        filePath: input.filePath ?? null,
        watermark: input.watermark ?? null,
      });
      rows.push(doc);
      return Promise.resolve(doc);
    }),
    get: mock((tenantId: string, id: string) => {
      return Promise.resolve(rows.find((d) => d.id === id && d.tenantId === tenantId) ?? null);
    }),
    getById: mock((id: string) => {
      return Promise.resolve(rows.find((d) => d.id === id) ?? null);
    }),
    list: mock((tenantId: string) => {
      return Promise.resolve(rows.filter((d) => d.tenantId === tenantId));
    }),
    update: mock((id: string, patch) => {
      const idx = rows.findIndex((d) => d.id === id);
      if (idx < 0) return Promise.reject(new Error(`update: not found ${id}`));
      const updated = { ...rows[idx], ...patch } as StreamDocument;
      rows[idx] = updated;
      return Promise.resolve(updated);
    }),
    findByStatus: mock((status) => Promise.resolve(rows.filter((d) => d.status === status))),
    resetProcessing: mock(() => {
      rows.forEach((d) => {
        if (d.status === 'processing') d.status = 'pending';
      });
      return Promise.resolve();
    }),
    remove: mock((tenantId: string, id: string) => {
      const idx = rows.findIndex((d) => d.id === id && d.tenantId === tenantId);
      if (idx >= 0) rows.splice(idx, 1);
      return Promise.resolve();
    }),
  };
  return { store, getRows: () => rows };
}

function makeEngine(store: DocumentStore, overrides: Record<string, unknown> = {}) {
  return new PdfEngine(
    {
      storageDir: '/tmp/pdf-engine-test',
      signSecret: 'test-secret',
      maxBytes: 1024,
      ...overrides,
    },
    store,
  );
}

describe('PdfEngine', () => {
  test('ingestFile rejects an empty body', async () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    expect(
      await catchCode(engine.ingestFile({ tenantId: 't1', fileName: 'a.pdf', stream: null })),
    ).toBe('EMPTY_BODY');
  });

  test('status throws DOCUMENT_NOT_FOUND', async () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    const code = await catchCode(engine.status('t1', 'nope'));
    expect(code).toBe('DOCUMENT_NOT_FOUND');
  });

  test('page token signing + verification round-trips', () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    const url = engine.signedPageUrl('doc-a', 1, 'http://localhost:3000/api/v1/documents');
    const q = new URL(url).searchParams;
    expect(engine.verifyPage('doc-a', 1, { exp: q.get('exp')!, sig: q.get('sig')! })).toBe(true);
    expect(engine.verifyPage('doc-a', 2, { exp: q.get('exp')!, sig: q.get('sig')! })).toBe(false);
    expect(engine.verifyPage('doc-b', 1, { exp: q.get('exp')!, sig: q.get('sig')! })).toBe(false);
  });

  test('session cookie round-trips and is bound to the document', () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    const cookie = engine.sessionCookie('doc-c');
    expect(engine.verifySessionCookie('doc-c', cookie)).toBe(true);
    expect(engine.verifySessionCookie('doc-other', cookie)).toBe(false);
    expect(engine.verifySessionCookie('doc-c', undefined)).toBe(false);
    expect(engine.verifySessionCookie('doc-c', 'garbage')).toBe(false);
  });

  test('pageSession refuses a non-ready document', async () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    const doc = await store.create({
      id: 'x',
      tenantId: 't1',
      name: 'x.pdf',
      source: 'FILE',
    });
    expect(
      await catchCode(
        engine.pageSession('t1', doc.id, { baseUrl: 'http://localhost:3000/api/v1/documents' }),
      ),
    ).toBe('DOCUMENT_NOT_READY');
  });

  test('pageSession issues one signed URL per page', async () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    await store.create({ id: 'y', tenantId: 't1', name: 'y.pdf', source: 'FILE' });
    await store.update('y', { status: 'ready', pageCount: 2 });
    const session = await engine.pageSession('t1', 'y', {
      baseUrl: 'http://localhost:3000/api/v1/documents',
    });
    expect(session.pages).toHaveLength(2);
    expect(session.pages[0].url).toContain('/pages/1?exp=');
    expect(session.pages[1].url).toContain('/pages/2?exp=');
  });

  test('pageImage throws PAGE_NOT_RENDERED when no file on disk', async () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    await store.create({ id: 'ready-doc', tenantId: 't1', name: 'r.pdf', source: 'FILE' });
    await store.update('ready-doc', { status: 'ready', pageCount: 1 });
    expect(await catchCode(engine.pageImage('ready-doc', 1))).toBe('PAGE_NOT_RENDERED');
  });

  test('pageImage rejects out-of-range page', async () => {
    const { store } = createStore();
    const engine = makeEngine(store);
    await store.create({ id: 'shortdoc', tenantId: 't1', name: 's.pdf', source: 'FILE' });
    await store.update('shortdoc', { status: 'ready', pageCount: 1 });
    expect(await catchCode(engine.pageImage('shortdoc', 5))).toBe('PAGE_OUT_OF_RANGE');
  });

  test('remove deletes from store', async () => {
    const { store, getRows } = createStore();
    const engine = makeEngine(store);
    await store.create({ id: 'rm', tenantId: 't1', name: 'rm.pdf', source: 'FILE' });
    await engine.remove('t1', 'rm');
    expect(getRows()).toHaveLength(0);
  });
});
