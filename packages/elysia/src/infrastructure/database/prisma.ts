import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pkg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pkg;

const isTest = config.nodeEnv === 'test';

const pool = isTest ? null : new Pool({ connectionString: config.databaseUrl });
const adapter = pool ? new PrismaPg(pool) : null;

export const prisma = isTest
  ? new PrismaClient({ accelerateUrl: 'prisma://localhost' })
  : new PrismaClient(adapter ? { adapter } : undefined);
