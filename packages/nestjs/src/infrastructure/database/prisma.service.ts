import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from 'pg';
import { ConfigService } from '../config/config.service.js';

const { Pool } = pkg;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService) {
    const isTest = configService.env.NODE_ENV === 'test';

    if (isTest) {
      super({ accelerateUrl: 'prisma://localhost' });
    } else {
      const pool = new Pool({
        connectionString: configService.env.DATABASE_URL,
      });
      const adapter = new PrismaPg(pool);
      super({ adapter });
    }
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
