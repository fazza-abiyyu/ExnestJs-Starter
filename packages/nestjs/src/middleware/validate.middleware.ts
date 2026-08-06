import type { Request, Response, NextFunction } from 'express';
import type { EndpointSchema } from '../lib/endpoint/index.js';
import { ODataResponse } from '../lib/odata/index.js';
import type { ZodError } from 'zod';

function formatZodError(err: ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}

export function validate(schema: EndpointSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = schema.body.parse(req.body);
      }
      if (schema.query) {
        // Express 5 uses getter-only on prototype — shadow with own property
        const parsed = schema.query.parse(req.query);
        Object.defineProperty(req, 'query', {
          value: parsed,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (schema.params) {
        req.params = schema.params.parse(req.params) as Record<string, string>;
      }
      next();
    } catch (error) {
      const message =
        error && typeof error === 'object' && 'issues' in error
          ? formatZodError(error as ZodError)
          : 'Validation failed';

      const body = ODataResponse.error('VALIDATION_ERROR', message).build();
      res.status(400).json(body);
    }
  };
}
