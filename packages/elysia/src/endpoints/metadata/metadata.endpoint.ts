import type { RouteConfig } from '../../lib/endpoint/index.js';

export const metadataRoutes: RouteConfig[] = [
  {
    method: 'GET',
    path: '/$metadata',
    handler: 'getMetadata',
    tags: ['metadata'],
    responses: [{ status: 200, description: 'All OData entity types' }],
  },
  {
    method: 'GET',
    path: '/$metadata/:fragment',
    handler: 'getEntityType',
    tags: ['metadata'],
    responses: [
      { status: 200, description: 'Single entity type by fragment' },
      { status: 404, description: 'Entity type not found' },
    ],
  },
];
