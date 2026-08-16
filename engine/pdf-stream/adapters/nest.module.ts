import type { DynamicModule } from '@nestjs/common';
import { createPdfEngineController, type NestPdfEngineOptions } from './nest.controller.js';

/**
 * NestJS adapter for the PDF engine. Registers one dynamic controller that
 * exposes the same envelope (`{ value }` / `{ error: { code, message, status } }`)
 * and header contract as the Elysia adapter, so you can switch platforms
 * without touching the client.
 *
 * ```ts
 * @Module({ imports: [PdfEngineModule.forRoot({ engine, apiKey: '…' })] })
 * export class DocumentModule {}
 * ```
 */
export class PdfEngineModule {
  static forRoot(options: NestPdfEngineOptions): DynamicModule {
    const controller = createPdfEngineController(options);
    return {
      module: PdfEngineModule,
      controllers: [controller],
    };
  }
}