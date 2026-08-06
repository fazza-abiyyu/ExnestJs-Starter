# Exnest Framework — Conventions

## Architecture

- **NestJS 11** + Express v5
- **No CLI plugins** — all providers, controllers, modules wired manually
- **No Swagger** — use `scripts/generate-openapi.ts` instead
- **Endpoints** are declared as `EndpointConfig` objects in `src/endpoints/` and registered via `src/endpoints/registry.ts`
- **Controllers** are `@Injectable()` classes (not `@Controller()`) — they act as handler bags for the endpoint system
- **Modules** export `Controller`, `Service`, and DTOs

## Code Style

- No JSDoc/TSDoc comments
- No semicolons when possible (follow existing style)
- Use `import type` for type-only imports
- Always use `.js` extension in relative imports
- Service method names use full form: `list${PascalName}s`, `get${PascalName}`, `create${PascalName}`, `update${PascalName}`, plus domain-specific actions like `provision${PascalName}`, `revoke${PascalName}`
- Controller method names match their service counterparts (e.g. `listTerminals`, `getTerminal`)
- Service methods accept `options?: { lang?: string }` for language parameter
- Controller methods use `req`/`res` as parameter names
- Extract `lang` from `req.query.lang as string | undefined`, pass as `{ lang }`

## Module Structure

Each module in `src/modules/<name>/` has 8 files:

| File | Purpose |
|------|---------|
| `index.ts` | Barrel re-export of all module files |
| `<name>.module.ts` | NestJS `@Module()` — provides & exports `Service` + `Controller` |
| `<name>.controller.ts` | `@Injectable()` handler bag |
| `<name>.service.ts` | Business logic, Prisma access |
| `<name>.dto.ts` | Zod schemas + derived DTO types |
| `<name>.interface.ts` | Raw database shape + response interfaces |
| `<name>.i18n.ts` | Translation registrations via `odataI18n.register()` |
| `<name>.service.spec.ts` | Jest tests with mocked `PrismaService` |

Each endpoint set in `src/endpoints/<name>/` has 3 files:

| File | Purpose |
|------|---------|
| `<name>.endpoint.ts` | `EndpointConfig[]` — routes, handlers, auth, permissions, schema, tags, responses |
| `<name>.rbac.ts` | RBAC permission handlers via `requirePermission()` |
| `index.ts` | Re-exports endpoint config array as default |

## OData Patterns

### Controller
- Import: `import { ODataResponse, type ODataCollectionResponse, type ODataSingleResponse } from '../../lib/odata/index.js'`
- List: return `ODataResponse.collection(items).context(url).build()`
- Single: return `ODataResponse.item(record).context(url).build()`
- Explicit return types: `Promise<ODataCollectionResponse<T>>`, `Promise<ODataSingleResponse<T>>`
- Call `res.status(201)` before returning for creates
- Extract tenant from `(req as AuthRequest).session.activeTenantId ?? (req as AuthRequest).user?.sub ?? ''`
- Call `register${PascalName}Translations()` in constructor

### Service
- Do NOT import `ODataResponse` — OData wrapping belongs in controller
- Return raw types directly (arrays, single objects)
- Throw `ODataError` with code, message, status, and optional `lang`
- Use descriptive variable names: `existing${PascalName}`, `created${PascalName}`, `updated${PascalName}`
- Map Prisma records through `record as unknown as ${PascalName}Data`
- For partial updates, use `Record<string, unknown>` and check emptiness

### DTO
- Use `z.input<typeof schema>` when schema has `.default()` (create/provision DTOs)
- Use `z.infer<typeof schema>` for direct schema inference (update/action DTOs)

### i18n
- Each module has a `register${PascalName}Translations()` function
- Registers `'id'` (Indonesian) and `'en'` (English) translations
- Called in both `module.ts` top-level and `controller.ts` constructor

### RBAC
- Defined in `src/endpoints/<name>/<name>.rbac.ts`
- Permission format: `organization.<resource>.<action>` (e.g. `organization.terminal.read`)
- Exported as Express middleware via `requirePermission('<permission>')`
- Applied in `EndpointConfig.permissions` array

## Endpoint Configuration

```ts
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
}
```

## Exceptions

| Code | When |
|------|------|
| `${PascalName}NotFound` | Resource not found (404) |
| `${PascalName}Duplicate` / `${PascalName}CodeExists` | Duplicate resource (409) |
| `${PascalName}InvalidState` | Invalid state transition (409) |
| `ValidationError` | Input validation failure (400) |
| `BadRequest` | Missing required fields (400) |

## Service Conventions

- Inject `PrismaService` (not raw Prisma client)
- Use `PrismaService` from `../../infrastructure/database/prisma.service.js`
- DTO parameter names: `create${PascalName}Dto`, `update${PascalName}Dto`
- For creates with dependent entities, validate existence first (e.g. check outlet exists before creating terminal)

## Database

- PostgreSQL via Prisma
- Multi-tenant via `tenantId` column on every entity
- Prisma schema in `prisma/schema.prisma`

## App Name

- Read from `package.json` `name` field at runtime
- Exposed via `ConfigService.appName`
- Used in health checks, DB defaults, SMTP_FROM, output filenames
