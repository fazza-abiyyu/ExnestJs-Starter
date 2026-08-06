import type { Elysia } from 'elysia';
import { registerMetadataTranslations } from './metadata.i18n.js';
import { MetadataService } from './metadata.service.js';
import { MetadataController } from './metadata.controller.js';
import { metadataRoutes } from '../../endpoints/metadata/metadata.endpoint.js';
import { mountRoutes } from '../../lib/endpoint/index.js';

export function buildMetadataModule(app: Elysia): Elysia {
  registerMetadataTranslations();

  const metadataService = new MetadataService();
  const metadataController = new MetadataController(metadataService);

  return mountRoutes(app, metadataController, metadataRoutes);
}
