import { buildCustomersModule } from './customers/index.js'
import { buildHealthModule } from './health/index.js'
import { buildMetadataModule } from './metadata/index.js'

export type ModuleBuilder = (app: any) => any

export const moduleBuilders: ModuleBuilder[] = [
  buildCustomersModule,
  buildHealthModule,
  buildMetadataModule,
]