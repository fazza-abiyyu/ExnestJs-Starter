import { Module } from '@nestjs/common';
import { MetadataService } from './metadata.service.js';
import { MetadataController } from './metadata.controller.js';
import { registerMetadataTranslations } from './metadata.i18n.js';

registerMetadataTranslations();

@Module({
  providers: [MetadataService, MetadataController],
  exports: [MetadataService, MetadataController],
})
export class MetadataModule {}
