import { describe, expect, test, mock } from 'bun:test'
import { HealthService } from './health.service.js'
import { config } from '../../infrastructure/config/index.js'

function createService() {
  const mockPrisma = {
    $queryRawUnsafe: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve([1])),
  }
  const service = new HealthService(mockPrisma as never, config)
  return { mockPrisma, service }
}

describe('HealthService', () => {
  test('should return live status', () => {
    const { service } = createService()
    const result = service.live()

    expect(result.data.status).toBe('ok')
    expect(result.data.service).toBe(config.appName)
    expect(result.meta).toBeDefined()
  })

  test('should return ready status when database check succeeds', async () => {
    const { service } = createService()
    const result = await service.ready()

    expect(result.data.status).toBe('ok')
    expect(result.data.checks.database).toEqual({ status: 'ok' })
  })

  test('should return unavailable when database check fails', async () => {
    const { mockPrisma, service } = createService()
    mockPrisma.$queryRawUnsafe.mockRejectedValueOnce(new Error('Connection failed'))

    const result = await service.ready()

    expect(result.data.status).toBe('unavailable')
    const db = result.data.checks.database as { status: string }
    expect(db.status).toBe('unavailable')
  })
})