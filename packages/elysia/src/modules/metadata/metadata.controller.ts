import {
  ODataResponse,
  type ODataSingleResponse,
  type ODataErrorResponse,
} from '../../lib/odata/index.js';
import type { HandlerContext } from '../../lib/endpoint/index.js';
import { MetadataService } from './metadata.service.js';
import type { MetadataEntityType } from './metadata.interface.js';
import { registerMetadataTranslations } from './metadata.i18n.js';

export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {
    registerMetadataTranslations();
  }

  getMetadata(_ctx: HandlerContext) {
    const meta = this.metadataService.getMetadata();
    return ODataResponse.item(meta.entityTypes).context(meta['@odata.context']).build();
  }

  getEntityType(ctx: HandlerContext): ODataSingleResponse<MetadataEntityType> | ODataErrorResponse {
    const fragment = ctx.params.fragment;
    if (!fragment) {
      return ODataResponse.error('MissingFragment', 'Entity type fragment is required').build();
    }
    const entity = this.metadataService.getEntityTypeByFragment(fragment);
    if (!entity) {
      ctx.set.status = 404;
      return ODataResponse.error(
        'EntityTypeNotFound',
        `Entity type '${fragment}' not found`,
      ).build();
    }
    return ODataResponse.item(entity).build();
  }
}
