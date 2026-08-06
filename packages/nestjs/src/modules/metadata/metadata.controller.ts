import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ODataResponse } from '../../lib/odata/index.js';
import { MetadataService } from './metadata.service.js';

@Injectable()
export class MetadataController {
  constructor(private readonly metadataService: MetadataService) {}

  async getMetadata() {
    const meta = this.metadataService.getMetadata();
    return ODataResponse.item(meta.entityTypes).context(meta['@odata.context']).build();
  }

  async getEntityType(req: Request, res: Response) {
    const fragment = req.params.fragment as string;
    if (!fragment) {
      return ODataResponse.error('MissingFragment', 'Entity type fragment is required').build();
    }
    const entity = this.metadataService.getEntityTypeByFragment(fragment);
    if (!entity) {
      res.status(404);
      return ODataResponse.error(
        'EntityTypeNotFound',
        `Entity type '${fragment}' not found`,
      ).build();
    }
    return ODataResponse.item(entity).build();
  }
}
