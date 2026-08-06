import {
  Router,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
  type ErrorRequestHandler,
} from 'express';
import type { INestApplication } from '@nestjs/common';
import { ODataResponse, odataI18n } from '../lib/odata/index.js';
import { ODataError } from '../lib/exception/index.js';
import { validate } from '../middleware/validate.middleware.js';
import { endpointRegistry } from './registry.js';

function asyncWrapper(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function errorHandler(): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof ODataError || err.name === 'ODataError') {
      const body = ODataResponse.error(err.code, err.message)
        .translate(odataI18n.getTranslator(), err.lang)
        .build();

      res.status(err.status).json(body);
      return;
    }

    console.error('Unhandled Server Error:', err);
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    const body = ODataResponse.error('INTERNAL_ERROR', message).build();
    res.status(500).json(body);
  };
}

export function mountEndpoints(app: INestApplication): Router {
  const router = Router();

  for (const config of endpointRegistry) {
    const method = config.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const handlers: RequestHandler[] = [];

    for (const mw of config.middleware ?? []) {
      handlers.push(mw);
    }

    for (const perm of config.permissions ?? []) {
      handlers.push(perm);
    }

    if (config.schema) {
      handlers.push(validate(config.schema));
    }

    handlers.push(
      asyncWrapper(async (_req, res, next) => {
        try {
          const controller = app.get(config.controller);
          const handler = (controller as Record<string, unknown>)[config.handler] as
            ((...args: unknown[]) => unknown) | undefined;

          if (!handler) {
            throw new Error(`Handler "${config.handler}" not found on controller`);
          }

          const result = await handler.call(controller, _req, res);
          if (!res.headersSent) {
            res.json(result);
          }
        } catch (error) {
          next(error);
        }
      }),
    );

    router[method](config.path, ...handlers);
  }

  router.use(errorHandler());

  router.use((_req, res) => {
    const body = ODataResponse.error('NOT_FOUND', 'Route not found').build();
    res.status(404).json(body);
  });

  return router;
}
