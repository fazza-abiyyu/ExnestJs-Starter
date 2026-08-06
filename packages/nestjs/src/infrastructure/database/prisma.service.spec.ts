import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '../config/config.service.js';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('should instantiate PrismaService as a singleton', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ConfigService, PrismaService],
    }).compile();

    const instance1 = module.get(PrismaService);
    const instance2 = module.get(PrismaService);

    expect(instance1).toBeDefined();
    expect(instance1).toBe(instance2);
  });
});
