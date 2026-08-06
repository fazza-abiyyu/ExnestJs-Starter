import type { HandlerContext } from '../../lib/endpoint/index.js'
import { HealthService } from './health.service.js'
import { registerHealthTranslations } from './health.i18n.js'

export class HealthController {
  constructor(private readonly healthService: HealthService) {
    registerHealthTranslations()
  }

  live(ctx: HandlerContext) {
    const correlationId = (ctx.headers['x-correlation-id'] as string) || undefined
    return this.healthService.live({ correlationId })
  }

  async ready(ctx: HandlerContext) {
    const correlationId = (ctx.headers['x-correlation-id'] as string) || undefined
    return this.healthService.ready({ correlationId })
  }
}