import { Test, TestingModule } from '@nestjs/testing';
import { HealthService } from './health.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';

describe('HealthService', () => {
  let service: HealthService;
  let config: ConfigService;
  const mockPrisma = { $queryRawUnsafe: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [HealthService, ConfigService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<HealthService>(HealthService);
    config = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return live status', () => {
    const result = service.live();
    expect(result.data.status).toBe('ok');
    expect(result.data.service).toBe(config.appName);
    expect(result.meta).toBeDefined();
  });

  it('should return ready status when database check succeeds', async () => {
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([1]);

    const result = await service.ready();
    expect(result.data.status).toBe('ok');
    expect(result.data.checks.database).toEqual({ status: 'ok' });
  });

  it('should return unavailable when database check fails', async () => {
    mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Connection failed'));

    const result = await service.ready();
    expect(result.data.status).toBe('unavailable');
    expect(result.data.checks.database.status).toBe('unavailable');
  });
});
