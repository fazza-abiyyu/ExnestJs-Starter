import { Module } from '@nestjs/common';
import { ConfigModule } from './infrastructure/config/index.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { HealthModule } from './modules/health/index.js';
import { MetadataModule } from './modules/metadata/index.js';

@Module({
  imports: [ConfigModule, DatabaseModule, HealthModule, MetadataModule],
})
export class AppModule {}
