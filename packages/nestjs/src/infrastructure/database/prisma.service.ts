import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from 'pg';
import { ConfigService } from '../config/config.service.js';

const { Pool } = pkg;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly isTestMode: boolean;

  constructor(configService: ConfigService) {
    const isTestMode = configService.env.NODE_ENV === 'test';

    if (isTestMode) {
      super({ accelerateUrl: 'prisma://localhost' });
    } else {
      const pool = new Pool({
        connectionString: configService.env.DATABASE_URL,
      });
      const adapter = new PrismaPg(pool);
      super({ adapter });
    }

    this.isTestMode = isTestMode;
  }

  async onModuleInit() {
    if (this.isTestMode) return;
    await this.$connect();
  }

  async onModuleDestroy() {
    if (this.isTestMode) return;
    await this.$disconnect();
  }
}
