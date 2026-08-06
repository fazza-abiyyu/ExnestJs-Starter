import { Module } from '@nestjs/common';
import { HealthService } from './health.service.js';
import { HealthController } from './health.controller.js';
import { registerHealthTranslations } from './health.i18n.js';

registerHealthTranslations();

@Module({
  providers: [HealthService, HealthController],
  exports: [HealthService, HealthController],
})
export class HealthModule {}
