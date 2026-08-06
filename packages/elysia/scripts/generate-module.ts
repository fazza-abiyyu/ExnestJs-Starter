import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const featureNameArg = process.argv[2]

if (!featureNameArg) {
  console.error('Usage: bun run scripts/generate-module.ts <feature-name>')
  process.exit(1)
}

const feature = featureNameArg.toLowerCase()
const PascalName = feature.charAt(0).toUpperCase() + feature.slice(1)
const camelName = feature

const srcPath = join(process.cwd(), 'src')
const moduleDir = join(srcPath, 'modules', feature)
const endpointDir = join(srcPath, 'endpoints', feature)

if (existsSync(moduleDir) || existsSync(endpointDir)) {
  console.error(`Error: Module or Endpoint directory for "${feature}" already exists.`)
  process.exit(1)
}

mkdirSync(moduleDir, { recursive: true })
mkdirSync(endpointDir, { recursive: true })

console.log(`Generating module and endpoints for "${feature}"...`)

// 1. *.dto.ts
const dtoContent = `// Data transfer types & validation schemas for ${PascalName}
import { z } from 'zod'

export const create${PascalName}Schema = z.object({
  name: z.string().min(1, 'Name is required'),
})

export type Create${PascalName}Dto = z.infer<typeof create${PascalName}Schema>

export const update${PascalName}Schema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
})

export type Update${PascalName}Dto = z.infer<typeof update${PascalName}Schema>
`
writeFileSync(join(moduleDir, `${feature}.dto.ts`), dtoContent, 'utf-8')
console.log(`  → Created ${feature}.dto.ts`)

// 2. *.interface.ts
const interfaceContent = `// Domain & persistence interfaces for ${PascalName}
export interface ${PascalName}Data {
  id: string
  tenantId: string
  name: string
  createdAt: Date
  updatedAt: Date
}

export interface ${PascalName}Response {
  id: string
  tenant_id: string
  name: string
  created_at: string
  updated_at: string
}
`
writeFileSync(join(moduleDir, `${feature}.interface.ts`), interfaceContent, 'utf-8')
console.log(`  → Created ${feature}.interface.ts`)

// 3. *.i18n.ts
const i18nContent = `// i18n translations for ${PascalName}
import { odataI18n } from '../../lib/odata/index.js'

export function register${PascalName}Translations(): void {
  odataI18n.register('id', {
    ${PascalName}NotFound: '${PascalName} tidak ditemukan',
    ${PascalName}Duplicate: '${PascalName} sudah ada',
    ${PascalName}Created: '${PascalName} berhasil dibuat',
    ${PascalName}Updated: '${PascalName} berhasil diperbarui',
    ${PascalName}Archived: '${PascalName} berhasil diarsipkan',
  })

  odataI18n.register('en', {
    ${PascalName}NotFound: '${PascalName} not found',
    ${PascalName}Duplicate: '${PascalName} already exists',
    ${PascalName}Created: '${PascalName} created successfully',
    ${PascalName}Updated: '${PascalName} updated successfully',
    ${PascalName}Archived: '${PascalName} archived successfully',
  })
}
`
writeFileSync(join(moduleDir, `${feature}.i18n.ts`), i18nContent, 'utf-8')
console.log(`  → Created ${feature}.i18n.ts`)

// 4. *.service.ts
const serviceContent = `// Business logic for ${PascalName}
import type { PrismaClient } from '@prisma/client'
import { ODataError } from '../../lib/exception/index.js'
import { paginateList, type PaginatedResult } from '../../lib/odata/pagination.js'
import type { ${PascalName}Data, ${PascalName}Response } from './${feature}.interface.js'
import type { Create${PascalName}Dto, Update${PascalName}Dto } from './${feature}.dto.js'

function map${PascalName}Response(${camelName}Data: ${PascalName}Data): ${PascalName}Response {
  return {
    id: ${camelName}Data.id,
    tenant_id: ${camelName}Data.tenantId,
    name: ${camelName}Data.name,
    created_at: ${camelName}Data.createdAt.toISOString(),
    updated_at: ${camelName}Data.updatedAt.toISOString(),
  }
}

export class ${PascalName}Service {
  constructor(private readonly prisma: PrismaClient) {}

  async list${PascalName}s(
    tenantId: string,
    query: Record<string, unknown>,
  ): Promise<PaginatedResult<${PascalName}Response>> {
    const where = { tenantId }
    const { items, total, skip, take } = await paginateList<${PascalName}Data>(
      (args) => this.prisma.${camelName}.findMany(args),
      (args) => this.prisma.${camelName}.count(args),
      where,
      { query, defaultTop: 20 },
    )
    return { items: items.map(map${PascalName}Response), total, skip, take }
  }

  async get${PascalName}(
    tenantId: string,
    ${camelName}Id: string,
    options?: { lang?: string },
  ): Promise<${PascalName}Response> {
    const existing${PascalName} = await this.prisma.${camelName}.findUnique({
      where: { id: ${camelName}Id, tenantId },
    })
    if (!existing${PascalName}) {
      throw new ODataError('${PascalName}NotFound', '${PascalName} not found', 404, options?.lang)
    }
    return map${PascalName}Response(existing${PascalName} as unknown as ${PascalName}Data)
  }

  async create${PascalName}(
    tenantId: string,
    create${PascalName}Dto: Create${PascalName}Dto,
    options?: { lang?: string },
  ): Promise<${PascalName}Response> {
    const existing${PascalName} = await this.prisma.${camelName}.findFirst({
      where: { tenantId, name: create${PascalName}Dto.name },
    })
    if (existing${PascalName}) {
      throw new ODataError('${PascalName}Duplicate', '${PascalName} already exists', 409, options?.lang)
    }
    const created${PascalName} = (await this.prisma.${camelName}.create({
      data: { tenantId, ...create${PascalName}Dto },
    })) as unknown as ${PascalName}Data
    return map${PascalName}Response(created${PascalName})
  }

  async update${PascalName}(
    tenantId: string,
    ${camelName}Id: string,
    update${PascalName}Dto: Update${PascalName}Dto,
    options?: { lang?: string },
  ): Promise<${PascalName}Response> {
    const existing${PascalName} = await this.prisma.${camelName}.findUnique({
      where: { id: ${camelName}Id, tenantId },
    })
    if (!existing${PascalName}) {
      throw new ODataError('${PascalName}NotFound', '${PascalName} not found', 404, options?.lang)
    }
    const updateData: Record<string, unknown> = {}
    if (update${PascalName}Dto.name !== undefined) updateData.name = update${PascalName}Dto.name
    if (Object.keys(updateData).length === 0) {
      throw new ODataError('BadRequest', 'At least one field must be provided', 400, options?.lang)
    }
    const updated${PascalName} = (await this.prisma.${camelName}.update({
      where: { id: ${camelName}Id },
      data: updateData,
    })) as unknown as ${PascalName}Data
    return map${PascalName}Response(updated${PascalName})
  }

  async archive${PascalName}(
    tenantId: string,
    ${camelName}Id: string,
    options?: { lang?: string },
  ): Promise<{ id: string }> {
    const existing${PascalName} = await this.prisma.${camelName}.findUnique({
      where: { id: ${camelName}Id, tenantId },
    })
    if (!existing${PascalName}) {
      throw new ODataError('${PascalName}NotFound', '${PascalName} not found', 404, options?.lang)
    }
    await this.prisma.${camelName}.delete({ where: { id: ${camelName}Id } })
    return { id: ${camelName}Id }
  }
}
`
writeFileSync(join(moduleDir, `${feature}.service.ts`), serviceContent, 'utf-8')
console.log(`  → Created ${feature}.service.ts`)

// 5. *.controller.ts
const controllerContent = `// HTTP handlers for ${PascalName}
import {
  ODataResponse,
  type ODataCollectionResponse,
  type ODataSingleResponse,
} from '../../lib/odata/index.js'
import { buildNextLink } from '../../lib/odata/pagination.js'
import { config } from '../../infrastructure/config/index.js'
import type { HandlerContext } from '../../lib/endpoint/index.js'
import { ${PascalName}Service } from './${feature}.service.js'
import type { Create${PascalName}Dto, Update${PascalName}Dto } from './${feature}.dto.js'
import type { ${PascalName}Response } from './${feature}.interface.js'
import { register${PascalName}Translations } from './${feature}.i18n.js'

export class ${PascalName}Controller {
  constructor(private readonly ${camelName}Service: ${PascalName}Service) {
    register${PascalName}Translations()
  }

  private metadataUrl(fragment: string): string {
    return \`\${config.apiBaseUrl}/\$metadata/\${fragment}\`
  }

  private getTenantId(ctx: HandlerContext): string {
    return ctx.headers['x-tenant-id'] ?? 'default-tenant'
  }

  async list${PascalName}s(ctx: HandlerContext): Promise<ODataCollectionResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(ctx)
    const query: Record<string, unknown> = { ...ctx.query }
    const result = await this.${camelName}Service.list${PascalName}s(tenantId, query)

    const basePath = \`\${config.apiBaseUrl}/api/v1/${feature}s\`
    const nextLink = buildNextLink(basePath, query, result.skip, result.take, result.total)

    return ODataResponse.collection(result.items)
      .context(this.metadataUrl('Model.${PascalName}'))
      .count(result.total)
      .nextLink(nextLink ?? '')
      .build()
  }

  async get${PascalName}(ctx: HandlerContext): Promise<ODataSingleResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(ctx)
    const ${camelName}Id = ctx.params.${feature}_id
    const lang = ctx.query.lang
    const record = await this.${camelName}Service.get${PascalName}(tenantId, ${camelName}Id, { lang })
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build()
  }

  async create${PascalName}(ctx: HandlerContext): Promise<ODataSingleResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(ctx)
    const lang = ctx.query.lang
    const create${PascalName}Dto = ctx.body as Create${PascalName}Dto
    const record = await this.${camelName}Service.create${PascalName}(tenantId, create${PascalName}Dto, { lang })
    ctx.set.status = 201
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build()
  }

  async update${PascalName}(ctx: HandlerContext): Promise<ODataSingleResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(ctx)
    const ${camelName}Id = ctx.params.${feature}_id
    const lang = ctx.query.lang
    const update${PascalName}Dto = ctx.body as Update${PascalName}Dto
    const record = await this.${camelName}Service.update${PascalName}(
      tenantId,
      ${camelName}Id,
      update${PascalName}Dto,
      { lang },
    )
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build()
  }

  async archive${PascalName}(ctx: HandlerContext): Promise<ODataSingleResponse<{ id: string }>> {
    const tenantId = this.getTenantId(ctx)
    const ${camelName}Id = ctx.params.${feature}_id
    const lang = ctx.query.lang
    const record = await this.${camelName}Service.archive${PascalName}(tenantId, ${camelName}Id, { lang })
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build()
  }
}
`
writeFileSync(join(moduleDir, `${feature}.controller.ts`), controllerContent, 'utf-8')
console.log(`  → Created ${feature}.controller.ts`)

// 6. index.ts (Module level)
const moduleIndexContent = `export * from './${feature}.dto.js'
export * from './${feature}.interface.js'
export * from './${feature}.service.js'
export * from './${feature}.controller.js'
export * from './${feature}.module.js'
`
writeFileSync(join(moduleDir, 'index.ts'), moduleIndexContent, 'utf-8')
console.log(`  → Created module/index.ts`)

// 7. *.module.ts
const moduleContent = `// Module wiring for ${PascalName}
import type { Elysia } from 'elysia'
import { mountRoutes } from '../../lib/endpoint/index.js'
import { register${PascalName}Translations } from './${feature}.i18n.js'
import { ${PascalName}Service } from './${feature}.service.js'
import { ${PascalName}Controller } from './${feature}.controller.js'
import { ${feature}Routes } from '../../endpoints/${feature}/index.js'
import { prisma } from '../../infrastructure/database/prisma.js'

export function build${PascalName}Module(app: Elysia): Elysia {
  register${PascalName}Translations()

  const ${camelName}Service = new ${PascalName}Service(prisma)
  const ${camelName}Controller = new ${PascalName}Controller(${camelName}Service)

  return mountRoutes(app, ${camelName}Controller, ${feature}Routes)
}
`
writeFileSync(join(moduleDir, `${feature}.module.ts`), moduleContent, 'utf-8')
console.log(`  → Created ${feature}.module.ts`)

// 8. *.endpoint.ts
const endpointContent = `// Endpoint configurations for ${PascalName}
import type { RouteConfig } from '../../lib/endpoint/index.js'
import { create${PascalName}Schema, update${PascalName}Schema } from '../../modules/${feature}/${feature}.dto.js'

export const ${feature}Routes: RouteConfig[] = [
  {
    method: 'GET',
    path: '/api/v1/${feature}s',
    handler: 'list${PascalName}s',
    tags: ['${PascalName}'],
  },
  {
    method: 'POST',
    path: '/api/v1/${feature}s',
    handler: 'create${PascalName}',
    schema: { body: create${PascalName}Schema },
    tags: ['${PascalName}'],
    responses: [
      { status: 201, description: '${PascalName} created' },
      { status: 400, description: 'Validation error' },
      { status: 409, description: '${PascalName} duplicate' },
    ],
  },
  {
    method: 'GET',
    path: '/api/v1/${feature}s/:${feature}_id',
    handler: 'get${PascalName}',
    tags: ['${PascalName}'],
  },
  {
    method: 'PATCH',
    path: '/api/v1/${feature}s/:${feature}_id',
    handler: 'update${PascalName}',
    schema: { body: update${PascalName}Schema },
    tags: ['${PascalName}'],
  },
  {
    method: 'POST',
    path: '/api/v1/${feature}s/:${feature}_id/archive',
    handler: 'archive${PascalName}',
    tags: ['${PascalName}'],
  },
]
`
writeFileSync(join(endpointDir, `${feature}.endpoint.ts`), endpointContent, 'utf-8')
console.log(`  → Created ${feature}.endpoint.ts`)

// 9. index.ts (Endpoint level)
const endpointIndexContent = `export * from './${feature}.endpoint.js'
`
writeFileSync(join(endpointDir, 'index.ts'), endpointIndexContent, 'utf-8')
console.log(`  → Created endpoint/index.ts`)

// 10. *.service.spec.ts
const specContent = `// Unit tests for ${PascalName}Service
import { describe, expect, test, mock } from 'bun:test'
import { ${PascalName}Service } from './${feature}.service.js'

const mockRecord = {
  id: '${camelName}-1',
  tenantId: 'tenant-1',
  name: 'Test ${PascalName}',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}

function createService() {
  const mockPrisma = {
    ${camelName}: {
      findMany: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve([])),
      findUnique: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(null)),
      findFirst: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(null)),
      create: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(mockRecord)),
      update: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(mockRecord)),
      delete: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(mockRecord)),
      count: mock<(...args: any[]) => Promise<any>>(() => Promise.resolve(0)),
    },
  }
  const service = new ${PascalName}Service(mockPrisma as never)
  return { mockPrisma, service }
}

describe('${PascalName}Service', () => {
  describe('list${PascalName}s', () => {
    test('should return list of ${camelName}s', async () => {
      const { mockPrisma, service } = createService()
      mockPrisma.${camelName}.findMany.mockResolvedValueOnce([mockRecord])
      mockPrisma.${camelName}.count.mockResolvedValueOnce(1)

      const result = await service.list${PascalName}s('tenant-1', {})

      expect(result.items).toHaveLength(1)
      expect(result.items[0].name).toBe('Test ${PascalName}')
    })

    test('should return empty when no records exist', async () => {
      const { service } = createService()

      const result = await service.list${PascalName}s('tenant-1', {})

      expect(result.items).toEqual([])
    })
  })

  describe('get${PascalName}', () => {
    test('should return ${camelName} detail', async () => {
      const { mockPrisma, service } = createService()
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord)

      const result = await service.get${PascalName}('tenant-1', '${camelName}-1')

      expect(result.id).toBe('${camelName}-1')
    })

    test('should throw ODataError 404 when not found', async () => {
      const { service } = createService()

      expect(service.get${PascalName}('tenant-1', 'missing')).rejects.toMatchObject({
        code: '${PascalName}NotFound',
        status: 404,
      })
    })
  })

  describe('create${PascalName}', () => {
    test('should create a new ${camelName}', async () => {
      const { mockPrisma, service } = createService()
      mockPrisma.${camelName}.create.mockResolvedValueOnce(mockRecord)

      const result = await service.create${PascalName}('tenant-1', { name: 'Test ${PascalName}' })

      expect(result.name).toBe('Test ${PascalName}')
    })

    test('should throw ODataError 409 when duplicate', async () => {
      const { mockPrisma, service } = createService()
      mockPrisma.${camelName}.findFirst.mockResolvedValueOnce(mockRecord)

      expect(
        service.create${PascalName}('tenant-1', { name: 'Test ${PascalName}' }),
      ).rejects.toMatchObject({ code: '${PascalName}Duplicate', status: 409 })
    })
  })

  describe('update${PascalName}', () => {
    test('should update ${camelName} fields', async () => {
      const { mockPrisma, service } = createService()
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord)
      mockPrisma.${camelName}.update.mockResolvedValueOnce({ ...mockRecord, name: 'Updated' })

      const result = await service.update${PascalName}('tenant-1', '${camelName}-1', { name: 'Updated' })

      expect(result.name).toBe('Updated')
    })

    test('should throw ODataError 404 when not found', async () => {
      const { service } = createService()

      expect(
        service.update${PascalName}('tenant-1', 'missing', { name: 'X' }),
      ).rejects.toMatchObject({ code: '${PascalName}NotFound', status: 404 })
    })
  })

  describe('archive${PascalName}', () => {
    test('should archive a ${camelName}', async () => {
      const { mockPrisma, service } = createService()
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord)

      const result = await service.archive${PascalName}('tenant-1', '${camelName}-1')

      expect(result.id).toBe('${camelName}-1')
    })

    test('should throw ODataError 404 when not found', async () => {
      const { service } = createService()

      expect(
        service.archive${PascalName}('tenant-1', 'missing'),
      ).rejects.toMatchObject({ code: '${PascalName}NotFound', status: 404 })
    })
  })
})
`
writeFileSync(join(moduleDir, `${feature}.service.spec.ts`), specContent, 'utf-8')
console.log(`  → Created ${feature}.service.spec.ts`)

// 11. Register build module in src/modules/registry.ts
const moduleRegistryPath = join(srcPath, 'modules', 'registry.ts')
let moduleRegistryContent = readFileSync(moduleRegistryPath, 'utf-8')
moduleRegistryContent = moduleRegistryContent.replace(
  /(\n)(export)/,
  `\nimport { build${PascalName}Module } from './${feature}/index.js';$1$2`,
)
moduleRegistryContent = moduleRegistryContent.replace(
  /(moduleBuilders:\s*ModuleBuilder\[\]\s*=\s*\[)([\s\S]*?)(\])/,
  (_match: string, open: string, body: string, close: string) => {
    const trimmed = body.replace(/,\s*$/, '')
    return `${open}${trimmed},\n  build${PascalName}Module\n${close}`
  },
)
writeFileSync(moduleRegistryPath, moduleRegistryContent, 'utf-8')
console.log(`  → Registered ${PascalName}Module in modules/registry.ts`)

// 12. Auto-register routes in src/endpoints/registry.ts
const endpointRegistryPath = join(srcPath, 'endpoints', 'registry.ts')
let endpointRegistryContent = readFileSync(endpointRegistryPath, 'utf-8')
endpointRegistryContent = endpointRegistryContent.replace(
  /(\n)(export)/,
  `\nimport { ${feature}Routes } from './${feature}/index.js';$1$2`,
)
endpointRegistryContent = endpointRegistryContent.replace(
  /(routeRegistry:\s*RouteConfig\[\]\s*=\s*\[)([\s\S]*?)(\])/,
  (_match: string, open: string, body: string, close: string) => {
    const trimmed = body.replace(/,\s*$/, '')
    return `${open}${trimmed},\n  ...${feature}Routes\n${close}`
  },
)
writeFileSync(endpointRegistryPath, endpointRegistryContent, 'utf-8')
console.log(`  → Registered ${feature} routes in endpoints/registry.ts`)

// 13. Append prisma model
const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma')
const schemaContent = readFileSync(schemaPath, 'utf-8')
const modelBlock = `

model ${PascalName} {
  id        String   @id @default(uuid())
  tenantId  String
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId])
}
`
// Only append if the model doesn't already exist
if (!schemaContent.includes(`model ${PascalName} `)) {
  writeFileSync(schemaPath, schemaContent + modelBlock, 'utf-8')
  console.log(`  → Appended ${PascalName} model to prisma/schema.prisma`)
}

console.log(`\nDone! Generated module and endpoints for "${feature}".`)
console.log(`Run \`bun run db:generate\` to regenerate the Prisma client.`)