import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const featureNameArg = process.argv[2];

if (!featureNameArg) {
  console.error('Usage: bun run scripts/generate-module.ts <feature-name>');
  process.exit(1);
}

const feature = featureNameArg.toLowerCase();
const PascalName = feature.charAt(0).toUpperCase() + feature.slice(1);
const camelName = feature;

const srcPath = join(process.cwd(), 'src');
const moduleDir = join(srcPath, 'modules', feature);
const endpointDir = join(srcPath, 'endpoints', feature);

if (existsSync(moduleDir) || existsSync(endpointDir)) {
  console.error(`Error: Module or Endpoint directory for "${feature}" already exists.`);
  process.exit(1);
}

mkdirSync(moduleDir, { recursive: true });
mkdirSync(endpointDir, { recursive: true });

console.log(`Generating module and endpoints for "${feature}"...`);

// 1. *.dto.ts
const dtoContent = `// Data transfer types & validation schemas for ${PascalName}
import { z } from 'zod';

export const create${PascalName}Schema = z.object({
  name: z.string().min(1, 'Name is required'),
});

export type Create${PascalName}Dto = z.infer<typeof create${PascalName}Schema>;

export const update${PascalName}Schema = z.object({
  name: z.string().min(1, 'Name is required').optional(),
});

export type Update${PascalName}Dto = z.infer<typeof update${PascalName}Schema>;
`;
writeFileSync(join(moduleDir, `${feature}.dto.ts`), dtoContent, 'utf-8');
console.log(`  → Created ${feature}.dto.ts`);

// 2. *.interface.ts
const interfaceContent = `// Domain & persistence interfaces for ${PascalName}
export interface ${PascalName}Data {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ${PascalName}Response {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
`;
writeFileSync(join(moduleDir, `${feature}.interface.ts`), interfaceContent, 'utf-8');
console.log(`  → Created ${feature}.interface.ts`);

// 3. *.i18n.ts
const i18nContent = `// i18n translations for ${PascalName}
import { odataI18n } from '../../lib/odata/index.js';

export function register${PascalName}Translations(): void {
  odataI18n.register('id', {
    ${PascalName}NotFound: '${PascalName} tidak ditemukan',
    ${PascalName}Duplicate: '${PascalName} sudah ada',
    ${PascalName}Created: '${PascalName} berhasil dibuat',
    ${PascalName}Updated: '${PascalName} berhasil diperbarui',
    ${PascalName}Archived: '${PascalName} berhasil diarsipkan',
  });

  odataI18n.register('en', {
    ${PascalName}NotFound: '${PascalName} not found',
    ${PascalName}Duplicate: '${PascalName} already exists',
    ${PascalName}Created: '${PascalName} created successfully',
    ${PascalName}Updated: '${PascalName} updated successfully',
    ${PascalName}Archived: '${PascalName} archived successfully',
  });
}
`;
writeFileSync(join(moduleDir, `${feature}.i18n.ts`), i18nContent, 'utf-8');
console.log(`  → Created ${feature}.i18n.ts`);

// 4. *.service.ts
const serviceContent = `// Business logic for ${PascalName}
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { ODataError } from '../../lib/exception/index.js';
import { paginateList, type PaginatedResult } from '../../lib/odata/pagination.js';
import type { ${PascalName}Data, ${PascalName}Response } from './${feature}.interface.js';
import type { Create${PascalName}Dto, Update${PascalName}Dto } from './${feature}.dto.js';

function map${PascalName}Response(${camelName}Data: ${PascalName}Data): ${PascalName}Response {
  return {
    id: ${camelName}Data.id,
    tenant_id: ${camelName}Data.tenantId,
    name: ${camelName}Data.name,
    created_at: ${camelName}Data.createdAt.toISOString(),
    updated_at: ${camelName}Data.updatedAt.toISOString(),
  };
}

@Injectable()
export class ${PascalName}Service {
  constructor(private readonly prisma: PrismaService) {}

  async list${PascalName}s(
    tenantId: string,
    query: Record<string, unknown>,
  ): Promise<PaginatedResult<${PascalName}Response>> {
    const where = { tenantId };
    const { items, total, skip, take } = await paginateList<${PascalName}Data>(
      (args) => this.prisma.${camelName}.findMany(args),
      (args) => this.prisma.${camelName}.count(args),
      where,
      { query, defaultTop: 20 },
    );
    return { items: items.map(map${PascalName}Response), total, skip, take };
  }

  async get${PascalName}(
    tenantId: string,
    ${camelName}Id: string,
    options?: { lang?: string },
  ): Promise<${PascalName}Response> {
    const existing${PascalName} = await this.prisma.${camelName}.findUnique({
      where: { id: ${camelName}Id, tenantId },
    });
    if (!existing${PascalName}) {
      throw new ODataError('${PascalName}NotFound', '${PascalName} not found', 404, options?.lang);
    }
    return map${PascalName}Response(existing${PascalName} as unknown as ${PascalName}Data);
  }

  async create${PascalName}(
    tenantId: string,
    create${PascalName}Dto: Create${PascalName}Dto,
    options?: { lang?: string },
  ): Promise<${PascalName}Response> {
    const existing${PascalName} = await this.prisma.${camelName}.findFirst({
      where: { tenantId, name: create${PascalName}Dto.name },
    });
    if (existing${PascalName}) {
      throw new ODataError('${PascalName}Duplicate', '${PascalName} already exists', 409, options?.lang);
    }
    const created${PascalName} = (await this.prisma.${camelName}.create({
      data: { tenantId, ...create${PascalName}Dto },
    })) as unknown as ${PascalName}Data;
    return map${PascalName}Response(created${PascalName});
  }

  async update${PascalName}(
    tenantId: string,
    ${camelName}Id: string,
    update${PascalName}Dto: Update${PascalName}Dto,
    options?: { lang?: string },
  ): Promise<${PascalName}Response> {
    const existing${PascalName} = await this.prisma.${camelName}.findUnique({
      where: { id: ${camelName}Id, tenantId },
    });
    if (!existing${PascalName}) {
      throw new ODataError('${PascalName}NotFound', '${PascalName} not found', 404, options?.lang);
    }
    const updateData: Record<string, unknown> = {};
    if (update${PascalName}Dto.name !== undefined) updateData.name = update${PascalName}Dto.name;
    if (Object.keys(updateData).length === 0) {
      throw new ODataError('BadRequest', 'At least one field must be provided', 400, options?.lang);
    }
    const updated${PascalName} = (await this.prisma.${camelName}.update({
      where: { id: ${camelName}Id },
      data: updateData,
    })) as unknown as ${PascalName}Data;
    return map${PascalName}Response(updated${PascalName});
  }

  async archive${PascalName}(
    tenantId: string,
    ${camelName}Id: string,
    options?: { lang?: string },
  ): Promise<{ id: string }> {
    const existing${PascalName} = await this.prisma.${camelName}.findUnique({
      where: { id: ${camelName}Id, tenantId },
    });
    if (!existing${PascalName}) {
      throw new ODataError('${PascalName}NotFound', '${PascalName} not found', 404, options?.lang);
    }
    await this.prisma.${camelName}.delete({ where: { id: ${camelName}Id } });
    return { id: ${camelName}Id };
  }
}
`;
writeFileSync(join(moduleDir, `${feature}.service.ts`), serviceContent, 'utf-8');
console.log(`  → Created ${feature}.service.ts`);

// 5. *.controller.ts
const controllerContent = `// HTTP handlers for ${PascalName}
import { Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ODataResponse,
  type ODataCollectionResponse,
  type ODataSingleResponse,
} from '../../lib/odata/index.js';
import { buildNextLink } from '../../lib/odata/pagination.js';
import { ConfigService } from '../../infrastructure/config/config.service.js';
import { ${PascalName}Service } from './${feature}.service.js';
import type { Create${PascalName}Dto, Update${PascalName}Dto } from './${feature}.dto.js';
import type { ${PascalName}Response } from './${feature}.interface.js';
import { register${PascalName}Translations } from './${feature}.i18n.js';

@Injectable()
export class ${PascalName}Controller {
  constructor(
    private readonly ${camelName}Service: ${PascalName}Service,
    private readonly config: ConfigService,
  ) {
    register${PascalName}Translations();
  }

  private metadataUrl(fragment: string): string {
    return \`\${this.config.apiBaseUrl}/\$metadata/\${fragment}\`;
  }

  private getTenantId(req: Request): string {
    return 'default-tenant';
  }

  async list${PascalName}s(req: Request): Promise<ODataCollectionResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(req);
    const result = await this.${camelName}Service.list${PascalName}s(tenantId, req.query as Record<string, unknown>);

    const basePath = \`\${this.config.apiBaseUrl}/api/v1/${feature}s\`;
    const nextLink = buildNextLink(basePath, req.query as Record<string, unknown>, result.skip, result.take ?? 0, result.total);

    return ODataResponse.collection(result.items)
      .context(this.metadataUrl('Model.${PascalName}'))
      .count(result.total)
      .nextLink(nextLink ?? '')
      .build();
  }

  async get${PascalName}(req: Request): Promise<ODataSingleResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(req);
    const ${camelName}Id = req.params.${feature}_id as string;
    const lang = req.query.lang as string | undefined;
    const record = await this.${camelName}Service.get${PascalName}(tenantId, ${camelName}Id, { lang });
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build();
  }

  async create${PascalName}(req: Request, res: Response): Promise<ODataSingleResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(req);
    const lang = req.query.lang as string | undefined;
    const create${PascalName}Dto = req.body as Create${PascalName}Dto;
    const record = await this.${camelName}Service.create${PascalName}(tenantId, create${PascalName}Dto, { lang });
    res.status(201);
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build();
  }

  async update${PascalName}(req: Request): Promise<ODataSingleResponse<${PascalName}Response>> {
    const tenantId = this.getTenantId(req);
    const ${camelName}Id = req.params.${feature}_id as string;
    const lang = req.query.lang as string | undefined;
    const update${PascalName}Dto = req.body as Update${PascalName}Dto;
    const record = await this.${camelName}Service.update${PascalName}(tenantId, ${camelName}Id, update${PascalName}Dto, { lang });
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build();
  }

  async archive${PascalName}(req: Request): Promise<ODataSingleResponse<{ id: string }>> {
    const tenantId = this.getTenantId(req);
    const ${camelName}Id = req.params.${feature}_id as string;
    const lang = req.query.lang as string | undefined;
    const record = await this.${camelName}Service.archive${PascalName}(tenantId, ${camelName}Id, { lang });
    return ODataResponse.item(record).context(this.metadataUrl('Model.${PascalName}')).build();
  }
}
`;
writeFileSync(join(moduleDir, `${feature}.controller.ts`), controllerContent, 'utf-8');
console.log(`  → Created ${feature}.controller.ts`);

// 6. *.module.ts
const moduleContent = `// Module wiring for ${PascalName}
import { Module } from '@nestjs/common';
import { ${PascalName}Service } from './${feature}.service.js';
import { ${PascalName}Controller } from './${feature}.controller.js';
import { register${PascalName}Translations } from './${feature}.i18n.js';

register${PascalName}Translations();

@Module({
  providers: [${PascalName}Service, ${PascalName}Controller],
  exports: [${PascalName}Service, ${PascalName}Controller],
})
export class ${PascalName}Module {}
`;
writeFileSync(join(moduleDir, `${feature}.module.ts`), moduleContent, 'utf-8');
console.log(`  → Created ${feature}.module.ts`);

// 7. index.ts (Module level)
const moduleIndexContent = `export * from './${feature}.dto.js';
export * from './${feature}.interface.js';
export * from './${feature}.service.js';
export * from './${feature}.controller.js';
export * from './${feature}.module.js';
`;
writeFileSync(join(moduleDir, 'index.ts'), moduleIndexContent, 'utf-8');
console.log(`  → Created module/index.ts`);

// 8. *.endpoint.ts
const endpointContent = `// Endpoint configurations for ${PascalName}
import type { EndpointConfig } from '../../lib/endpoint/index.js';
import { ${PascalName}Controller } from '../../modules/${feature}/index.js';
import { create${PascalName}Schema, update${PascalName}Schema } from '../../modules/${feature}/${feature}.dto.js';
import {
  read${PascalName}Permission,
  manage${PascalName}Permission,
} from './${feature}.rbac.js';

export const list${PascalName}sEndpoint: EndpointConfig = {
  method: 'GET',
  path: '/api/v1/${feature}s',
  controller: ${PascalName}Controller,
  handler: 'list${PascalName}s',
  auth: true,
  permissions: [read${PascalName}Permission],
  tags: ['${PascalName}'],
  responses: [
    { status: 200, description: 'List of ${feature}' },
    { status: 401, description: 'Unauthorized' },
  ],
};

export const create${PascalName}Endpoint: EndpointConfig = {
  method: 'POST',
  path: '/api/v1/${feature}s',
  controller: ${PascalName}Controller,
  handler: 'create${PascalName}',
  auth: true,
  permissions: [manage${PascalName}Permission],
  schema: { body: create${PascalName}Schema },
  tags: ['${PascalName}'],
  responses: [
    { status: 201, description: '${PascalName} created' },
    { status: 400, description: 'Validation error' },
    { status: 401, description: 'Unauthorized' },
    { status: 409, description: '${PascalName} already exists' },
  ],
};

export const get${PascalName}Endpoint: EndpointConfig = {
  method: 'GET',
  path: '/api/v1/${feature}s/:${feature}_id',
  controller: ${PascalName}Controller,
  handler: 'get${PascalName}',
  auth: true,
  permissions: [read${PascalName}Permission],
  tags: ['${PascalName}'],
  responses: [
    { status: 200, description: '${PascalName} details' },
    { status: 401, description: 'Unauthorized' },
    { status: 404, description: '${PascalName} not found' },
  ],
};

export const update${PascalName}Endpoint: EndpointConfig = {
  method: 'PATCH',
  path: '/api/v1/${feature}s/:${feature}_id',
  controller: ${PascalName}Controller,
  handler: 'update${PascalName}',
  auth: true,
  permissions: [manage${PascalName}Permission],
  schema: { body: update${PascalName}Schema },
  tags: ['${PascalName}'],
  responses: [
    { status: 200, description: '${PascalName} updated' },
    { status: 400, description: 'Validation error' },
    { status: 401, description: 'Unauthorized' },
    { status: 404, description: '${PascalName} not found' },
  ],
};

export const archive${PascalName}Endpoint: EndpointConfig = {
  method: 'POST',
  path: '/api/v1/${feature}s/:${feature}_id/archive',
  controller: ${PascalName}Controller,
  handler: 'archive${PascalName}',
  auth: true,
  permissions: [manage${PascalName}Permission],
  tags: ['${PascalName}'],
  responses: [
    { status: 200, description: '${PascalName} archived' },
    { status: 401, description: 'Unauthorized' },
    { status: 404, description: '${PascalName} not found' },
  ],
};
`;
writeFileSync(join(endpointDir, `${feature}.endpoint.ts`), endpointContent, 'utf-8');
console.log(`  → Created ${feature}.endpoint.ts`);

// 9. *.rbac.ts
const rbacContent = `// RBAC permissions for ${PascalName}
import { requirePermission } from '../../lib/auth/auth.guard.js';

export const read${PascalName}Permission = requirePermission('organization.${camelName}.read');
export const manage${PascalName}Permission = requirePermission('organization.${camelName}.manage');
`;
writeFileSync(join(endpointDir, `${feature}.rbac.ts`), rbacContent, 'utf-8');
console.log(`  → Created ${feature}.rbac.ts`);

// 10. index.ts (Endpoint level)
const endpointIndexContent = `import {
  list${PascalName}sEndpoint,
  create${PascalName}Endpoint,
  get${PascalName}Endpoint,
  update${PascalName}Endpoint,
  archive${PascalName}Endpoint,
} from './${feature}.endpoint.js';

export default [
  list${PascalName}sEndpoint,
  create${PascalName}Endpoint,
  get${PascalName}Endpoint,
  update${PascalName}Endpoint,
  archive${PascalName}Endpoint,
];
`;
writeFileSync(join(endpointDir, 'index.ts'), endpointIndexContent, 'utf-8');
console.log(`  → Created endpoint/index.ts`);

// Auto-register in app.module.ts
const appModulePath = join(srcPath, 'app.module.ts');
let appModuleContent = readFileSync(appModulePath, 'utf-8');
appModuleContent = appModuleContent.replace(
  /(\n\n@Module)/,
  `\nimport { ${PascalName}Module } from './modules/${feature}/index.js';$1`,
);
appModuleContent = appModuleContent.replace(
  /(imports:\s*\[)([\s\S]*?)(\])/,
  (_match: string, open: string, body: string, close: string) => {
    const trimmed = body.replace(/,\s*$/, '');
    return `${open}${trimmed},\n    ${PascalName}Module\n  ${close}`;
  },
);
writeFileSync(appModulePath, appModuleContent, 'utf-8');
console.log(`  → Registered ${PascalName}Module in app.module.ts`);

// Auto-register in endpoints/registry.ts
const registryPath = join(srcPath, 'endpoints', 'registry.ts');
let registryContent = readFileSync(registryPath, 'utf-8');
registryContent = registryContent.replace(
  /(\n)(export)/,
  `\nimport ${feature}Config from './${feature}/index.js';$1$2`,
);
registryContent = registryContent.replace(
  /(endpointRegistry:\s*EndpointConfig\[\]\s*=\s*\[)([\s\S]*?)(\])/,
  (_match: string, open: string, body: string, close: string) => {
    const trimmed = body.replace(/,\s*$/, '');
    return `${open}${trimmed},\n  ...${feature}Config\n${close}`;
  },
);
writeFileSync(registryPath, registryContent, 'utf-8');
console.log(`  → Registered ${feature} endpoints in endpoints/registry.ts`);

// 10. Metadata entity type
const metadataDir = join(srcPath, 'modules', 'metadata', 'entities');
if (!existsSync(metadataDir)) {
  mkdirSync(metadataDir, { recursive: true });
}
const metadataContent = `// OData metadata entity type for ${PascalName}
import type { MetadataEntityType } from '../metadata.interface.js';

export const ${camelName}EntityTypes: MetadataEntityType[] = [
  {
    name: 'Model.${PascalName}',
    fragment: 'Model.${PascalName}',
    description: '${PascalName} entity',
    properties: [
      { name: 'id', type: 'Edm.String' },
      { name: 'tenant_id', type: 'Edm.String' },
      { name: 'name', type: 'Edm.String' },
      { name: 'created_at', type: 'Edm.DateTimeOffset' },
      { name: 'updated_at', type: 'Edm.DateTimeOffset' },
      { name: 'archived_at', type: 'Edm.DateTimeOffset', nullable: true },
    ],
  },
];
`;
writeFileSync(join(metadataDir, `${feature}.metadata.ts`), metadataContent, 'utf-8');
console.log(`  → Created ${feature}.metadata.ts`);

// 11. *.service.spec.ts
const specContent = `// Unit tests for ${PascalName}Service
import { Test, TestingModule } from '@nestjs/testing';
import { ${PascalName}Service } from './${feature}.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

const mockRecord = {
  id: '${camelName}-1',
  tenantId: 'tenant-1',
  name: 'Test ${PascalName}',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

describe('${PascalName}Service', () => {
  let service: ${PascalName}Service;

  const mockPrisma = {
    ${camelName}: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ${PascalName}Service,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<${PascalName}Service>(${PascalName}Service);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('list${PascalName}s', () => {
    it('should return list of ${camelName}s', async () => {
      mockPrisma.${camelName}.findMany.mockResolvedValueOnce([mockRecord]);
      mockPrisma.${camelName}.count.mockResolvedValueOnce(1);

      const result = await service.list${PascalName}s('tenant-1', {});

      expect(result.items).toHaveLength(1);
      expect(result.items[0].name).toBe('Test ${PascalName}');
    });

    it('should return empty when no records exist', async () => {
      mockPrisma.${camelName}.findMany.mockResolvedValueOnce([]);
      mockPrisma.${camelName}.count.mockResolvedValueOnce(0);

      const result = await service.list${PascalName}s('tenant-1', {});

      expect(result.items).toEqual([]);
    });
  });

  describe('get${PascalName}', () => {
    it('should return ${camelName} detail', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord);

      const result = await service.get${PascalName}('tenant-1', '${camelName}-1');

      expect(result.id).toBe('${camelName}-1');
      expect(result.name).toBe('Test ${PascalName}');
    });

    it('should throw ODataError 404 when not found', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(null);

      await expect(service.get${PascalName}('tenant-1', 'missing')).rejects.toMatchObject({
        code: '${PascalName}NotFound',
        status: 404,
      });
    });
  });

  describe('create${PascalName}', () => {
    it('should create a new ${camelName}', async () => {
      mockPrisma.${camelName}.findFirst.mockResolvedValueOnce(null);
      mockPrisma.${camelName}.create.mockResolvedValueOnce(mockRecord);

      const result = await service.create${PascalName}('tenant-1', { name: 'Test ${PascalName}' });

      expect(result.name).toBe('Test ${PascalName}');
    });

    it('should throw ODataError 409 when duplicate', async () => {
      mockPrisma.${camelName}.findFirst.mockResolvedValueOnce(mockRecord);

      await expect(
        service.create${PascalName}('tenant-1', { name: 'Test ${PascalName}' }),
      ).rejects.toMatchObject({ code: '${PascalName}Duplicate', status: 409 });
    });
  });

  describe('update${PascalName}', () => {
    it('should update ${camelName} fields', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord);
      mockPrisma.${camelName}.update.mockResolvedValueOnce({ ...mockRecord, name: 'Updated' });

      const result = await service.update${PascalName}('tenant-1', '${camelName}-1', { name: 'Updated' });

      expect(result.name).toBe('Updated');
    });

    it('should throw ODataError 404 when not found', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.update${PascalName}('tenant-1', 'missing', { name: 'X' }),
      ).rejects.toMatchObject({ code: '${PascalName}NotFound', status: 404 });
    });
  });

  describe('archive${PascalName}', () => {
    it('should archive a ${camelName}', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord);
      mockPrisma.${camelName}.delete.mockResolvedValueOnce(mockRecord);

      const result = await service.archive${PascalName}('tenant-1', '${camelName}-1');

      expect(result.id).toBe('${camelName}-1');
    });

    it('should throw ODataError 404 when not found', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(null);

      await expect(
        service.archive${PascalName}('tenant-1', 'missing'),
      ).rejects.toMatchObject({ code: '${PascalName}NotFound', status: 404 });
    });
  });
});
`;
writeFileSync(join(moduleDir, `${feature}.service.spec.ts`), specContent, 'utf-8');
console.log(`  → Created ${feature}.service.spec.ts`);

// Auto-register metadata entity type in metadata.service.ts
const metadataServicePath = join(srcPath, 'modules', 'metadata', 'metadata.service.ts');
if (existsSync(metadataServicePath)) {
  let metadataServiceContent = readFileSync(metadataServicePath, 'utf-8');

  // Insert import before @Injectable
  metadataServiceContent = metadataServiceContent.replace(
    /(\n@Injectable\()/,
    `\nimport { ${camelName}EntityTypes } from './entities/${feature}.metadata.js';$1`,
  );

  // Insert spread before the closing `];` of getEntityTypes array
  metadataServiceContent = metadataServiceContent.replace(
    /(    \];\n  }\n\n  getMetadata)/,
    `      ...${camelName}EntityTypes,\n$1`,
  );

  writeFileSync(metadataServicePath, metadataServiceContent, 'utf-8');
  console.log(`  → Registered ${feature} metadata in metadata.service.ts`);
}

// 12. test/${feature}.e2e-spec.ts
const e2eDir = join(process.cwd(), 'test');
mkdirSync(e2eDir, { recursive: true });
const e2eContent = `import request from 'supertest';
import express from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ${PascalName}Module } from '../src/modules/${feature}/index.js';
import { ConfigModule } from '../src/infrastructure/config/config.module.js';
import { DatabaseModule } from '../src/infrastructure/database/database.module.js';
import { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import { mountEndpoints } from '../src/endpoints/index.js';

describe('${PascalName} Endpoints (e2e)', () => {
  let nestApp: INestApplication;
  let app: express.Application;

  const mockRecord = {
    id: '${camelName}-1',
    tenantId: 'tenant-1',
    name: 'Test ${PascalName}',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };

  const mockPrisma = {
    ${camelName}: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(mockRecord),
      update: jest.fn().mockResolvedValue(mockRecord),
      delete: jest.fn().mockResolvedValue(mockRecord),
      count: jest.fn().mockResolvedValue(0),
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [${PascalName}Module, ConfigModule, DatabaseModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();

    nestApp = moduleFixture.createNestApplication();
    await nestApp.init();

    app = express();
    app.use(express.json());
    app.use(mountEndpoints(nestApp));
  });

  afterAll(async () => {
    await nestApp.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/v1/${feature}s', () => {
    it('should return paginated list', async () => {
      mockPrisma.${camelName}.findMany.mockResolvedValueOnce([mockRecord]);
      mockPrisma.${camelName}.count.mockResolvedValueOnce(1);

      const res = await request(app)
        .get('/api/v1/${feature}s')
        .expect(200);

      expect(res.body.value).toHaveLength(1);
      expect(res.body['@odata.count']).toBe(1);
    });
  });

  describe('POST /api/v1/${feature}s', () => {
    it('should create a new record', async () => {
      mockPrisma.${camelName}.findFirst.mockResolvedValueOnce(null);
      mockPrisma.${camelName}.create.mockResolvedValueOnce(mockRecord);

      const res = await request(app)
        .post('/api/v1/${feature}s')
        .send({ name: 'Test ${PascalName}' })
        .expect(201);

      expect(res.body.value.name).toBe('Test ${PascalName}');
    });

    it('should return 400 with invalid name', async () => {
      await request(app)
        .post('/api/v1/${feature}s')
        .send({ name: '' })
        .expect(400);
    });
  });

  describe('GET /api/v1/${feature}s/:${feature}_id', () => {
    it('should return record detail', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord);

      const res = await request(app)
        .get('/api/v1/${feature}s/${camelName}-1')
        .expect(200);

      expect(res.body.value.id).toBe('${camelName}-1');
    });

    it('should return 404 when not found', async () => {
      await request(app)
        .get('/api/v1/${feature}s/missing')
        .expect(404);
    });
  });

  describe('PATCH /api/v1/${feature}s/:${feature}_id', () => {
    it('should update record', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord);
      mockPrisma.${camelName}.update.mockResolvedValueOnce({ ...mockRecord, name: 'Updated' });

      const res = await request(app)
        .patch('/api/v1/${feature}s/${camelName}-1')
        .send({ name: 'Updated' })
        .expect(200);

      expect(res.body.value.name).toBe('Updated');
    });

    it('should return 404 when not found', async () => {
      await request(app)
        .patch('/api/v1/${feature}s/missing')
        .send({ name: 'X' })
        .expect(404);
    });
  });

  describe('POST /api/v1/${feature}s/:${feature}_id/archive', () => {
    it('should archive a record', async () => {
      mockPrisma.${camelName}.findUnique.mockResolvedValueOnce(mockRecord);

      const res = await request(app)
        .post('/api/v1/${feature}s/${camelName}-1/archive')
        .expect(200);

      expect(res.body.value.id).toBe('${camelName}-1');
    });

    it('should return 404 when not found', async () => {
      await request(app)
        .post('/api/v1/${feature}s/missing/archive')
        .expect(404);
    });
  });
});
`;
writeFileSync(join(e2eDir, `${feature}.e2e-spec.ts`), e2eContent, 'utf-8');
console.log(`  → Created test/${feature}.e2e-spec.ts`);

console.log(`\nDone! Generated module and endpoints for "${feature}".`);
