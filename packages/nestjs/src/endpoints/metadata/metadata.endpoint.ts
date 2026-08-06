import type { EndpointConfig } from '../../lib/endpoint/index.js';
import { MetadataController } from '../../modules/metadata/index.js';

const metadataConfigs: EndpointConfig[] = [
  {
    method: 'GET',
    path: '/$metadata',
    controller: MetadataController,
    handler: 'getMetadata',
    tags: ['metadata'],
    responses: [{ status: 200, description: 'All OData entity types' }],
  },
  {
    method: 'GET',
    path: '/$metadata/:fragment',
    controller: MetadataController,
    handler: 'getEntityType',
    tags: ['metadata'],
    responses: [
      { status: 200, description: 'Single entity type by fragment' },
      { status: 404, description: 'Entity type not found' },
    ],
  },
];

export default metadataConfigs;
