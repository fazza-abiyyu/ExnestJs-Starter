import { Elysia } from 'elysia';
import { errorHandler } from './lib/exception/handler.js';
import { ODataResponse } from './lib/odata/index.js';
import { moduleBuilders } from './modules/registry.js';

export function createApp() {
  const app = new Elysia()
    .onRequest(({ store }) => {
      (store as Record<string, unknown>).__start = Date.now();
    })
    .onAfterResponse(({ store, request, set }) => {
      const start = Number((store as Record<string, unknown>).__start ?? Date.now());
      const duration = Date.now() - start;
      console.log(`${request.method} ${request.url} ${set.status} ${duration}ms`);
    })
    .onError(errorHandler);

  for (const builder of moduleBuilders) {
    builder(app);
  }

  app.all('*', ({ set }) => {
    set.status = 404;
    return ODataResponse.error('NOT_FOUND', 'Route not found').build();
  });

  return app;
}
