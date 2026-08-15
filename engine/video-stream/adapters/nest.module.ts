import type { DynamicModule } from '@nestjs/common';
import { createVideoEngineController, type NestVideoEngineOptions } from './nest.controller.js';

/**
 * NestJS adapter for the video engine. Registers one dynamic controller that
 * exposes the same envelope (`{ value }` / `{ error: { code, message, status } }`)
 * and header contract as the Elysia adapter, so you can switch platforms
 * without touching the client.
 *
 * ```ts
 * @Module({ imports: [VideoEngineModule.forRoot({ engine, apiKey: '…' })] })
 * export class VideoModule {}
 * ```
 */
export class VideoEngineModule {
  static forRoot(options: NestVideoEngineOptions): DynamicModule {
    const controller = createVideoEngineController(options);
    return {
      module: VideoEngineModule,
      controllers: [controller],
    };
  }
}