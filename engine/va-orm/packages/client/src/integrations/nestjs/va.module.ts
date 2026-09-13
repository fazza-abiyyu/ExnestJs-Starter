// VA-ORM NestJS Module

import { VaService } from './va.service.js'
import type { VaClientOptions } from '../../core/va.client.js'

export interface VaModuleOptions extends VaClientOptions {
  isGlobal?: boolean
}

// any by design: @nestjs/common is an optional peer — resolved at runtime.
let Global: any
let Module: any
try {
  const nestCommon = require('@nestjs/common')
  Global = nestCommon.Global
  Module = nestCommon.Module
} catch {
  Global = () => (target: any) => target
  Module = () => (target: any) => target
}

@Global()
@Module({})
export class VaModule {
  static forRoot(options: VaModuleOptions) {
    const vaServiceProvider = {
      provide: VaService,
      useFactory: () => {
        return new VaService(options)
      },
    }

    return {
      module: VaModule,
      providers: [vaServiceProvider],
      exports: [VaService],
    }
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => VaClientOptions | Promise<VaClientOptions>
    inject?: any[]
    isGlobal?: boolean
  }) {
    const vaServiceProvider = {
      provide: VaService,
      useFactory: async (...args: any[]) => {
        const config = await options.useFactory(...args)
        return new VaService(config)
      },
      inject: options.inject || [],
    }

    return {
      module: VaModule,
      providers: [vaServiceProvider],
      exports: [VaService],
    }
  }
}
