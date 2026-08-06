import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { HealthService } from './health.service.js';

@Injectable()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  live(req: Request) {
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    return this.healthService.live({ correlationId });
  }

  async ready(req: Request) {
    const correlationId = (req.headers['x-correlation-id'] as string) || undefined;
    return this.healthService.ready({ correlationId });
  }
}
