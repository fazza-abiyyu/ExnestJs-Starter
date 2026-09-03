// VA-ORM Integrations Spec

import { describe, it, expect } from 'bun:test'

describe('Integrations', () => {
  describe('NestJS', () => {
    it('should export VaModule', async () => {
      const { VaModule } = await import('../integrations/nestjs/va.module.js')
      expect(VaModule).toBeDefined()
      expect(typeof VaModule.forRoot).toBe('function')
      expect(typeof VaModule.forRootAsync).toBe('function')
    })

    it('should export VaService', async () => {
      const { VaService } = await import('../integrations/nestjs/va.service.js')
      expect(VaService).toBeDefined()
    })
  })

  describe('Elysia', () => {
    it('should export VaSingleton', async () => {
      const { VaSingleton } = await import('../integrations/elysia/va.singleton.js')
      expect(VaSingleton).toBeDefined()
      expect(typeof VaSingleton.getInstance).toBe('function')
    })

    it('should export createVaSingleton', async () => {
      const { createVaSingleton } = await import('../integrations/elysia/va.singleton.js')
      expect(typeof createVaSingleton).toBe('function')
    })

    it('should export vaPlugin', async () => {
      const { vaPlugin } = await import('../integrations/elysia/va.singleton.js')
      expect(typeof vaPlugin).toBe('function')
    })
  })
})
