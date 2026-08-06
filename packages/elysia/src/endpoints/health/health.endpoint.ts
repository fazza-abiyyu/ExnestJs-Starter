import type { RouteConfig } from '../../lib/endpoint/index.js';

export const healthRoutes: RouteConfig[] = [
  {
    method: 'GET',
    path: '/health/live',
    handler: 'live',
    tags: ['System'],
    responses: [{ status: 200, description: 'Process alive' }],
  },
  {
    method: 'GET',
    path: '/health/ready',
    handler: 'ready',
    tags: ['System'],
    responses: [
      { status: 200, description: 'Service ready' },
      { status: 503, description: 'Service unavailable' },
    ],
  },
];
