import type { RequestHandler } from 'express';
import type { z } from 'zod';

export interface EndpointSchema {
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
}

export interface EndpointConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  controller: { new (...args: never[]): unknown };
  handler: string;
  schema?: EndpointSchema;
  middleware?: RequestHandler[];
  auth?: boolean;
  permissions?: RequestHandler[];
  tags?: string[];
  responses?: {
    status: number;
    description?: string;
  }[];
}
