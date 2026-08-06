import type { RouteConfig } from '../lib/endpoint/index.js';
import { customersRoutes } from './customers/index.js';
import { healthRoutes } from './health/index.js';
import { metadataRoutes } from './metadata/index.js';

export const routeRegistry: RouteConfig[] = [
  ...customersRoutes,
  ...healthRoutes,
  ...metadataRoutes,
];
