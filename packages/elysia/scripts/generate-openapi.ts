import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { routeRegistry } from '../src/endpoints/registry.js'
import type { RouteConfig } from '../src/lib/endpoint/index.js'
import { config } from '../src/infrastructure/config/index.js'

const appName = config.appName
const API_BASE_URL = config.apiBaseUrl

interface OpenApiPathItem {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses: Record<string, OpenApiResponse>
  security?: Record<string, string[]>[]
  deprecated?: boolean
}

interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  description?: string
  schema: Record<string, unknown>
}

interface OpenApiRequestBody {
  required: boolean
  content: Record<
    string,
    {
      schema: Record<string, unknown>
      example?: unknown
    }
  >
}

interface OpenApiResponse {
  description?: string
  $ref?: string
  headers?: Record<string, { $ref: string }>
  content?: Record<
    string,
    {
      schema: Record<string, unknown>
      examples?: Record<string, { summary: string; value: unknown }>
    }
  >
}

function isOptionalSchema(schema: unknown): boolean {
  const name = (schema as { constructor?: { name?: string } })?.constructor?.name
  return name === 'ZodOptional' || name === 'ZodDefault' || name === 'ZodNullable'
}

function zodToJsonSchema(schema: unknown): Record<string, unknown> {
  const s = schema as {
    _def?: any
    constructor?: { name?: string }
    shape?: Record<string, unknown>
  }
  if (!s || typeof s !== 'object' || !s._def) {
    return {}
  }
  const def = s._def
  const name = s.constructor?.name

  switch (name) {
    case 'ZodObject': {
      const properties: Record<string, unknown> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(s.shape ?? {})) {
        properties[key] = zodToJsonSchema(value)
        if (!isOptionalSchema(value)) required.push(key)
      }
      const result: Record<string, unknown> = { type: 'object', properties }
      if (required.length > 0) result.required = required
      return result
    }
    case 'ZodString': {
      const result: Record<string, unknown> = { type: 'string' }
      for (const check of def.checks ?? []) {
        if (check.kind === 'email') result.format = 'email'
        else if (check.kind === 'url') result.format = 'uri'
        else if (check.kind === 'uuid') result.format = 'uuid'
      }
      return result
    }
    case 'ZodNumber': {
      const result: Record<string, unknown> = { type: 'number' }
      for (const check of def.checks ?? []) {
        if (check.kind === 'int') result.type = 'integer'
      }
      return result
    }
    case 'ZodBoolean':
      return { type: 'boolean' }
    case 'ZodDate':
      return { type: 'string', format: 'date-time' }
    case 'ZodEnum':
      return { type: 'string', enum: def.values }
    case 'ZodNativeEnum':
      return { type: 'string', enum: Object.values(def.values) }
    case 'ZodArray':
      return { type: 'array', items: zodToJsonSchema(def.type) }
    case 'ZodOptional':
      return zodToJsonSchema(def.innerType)
    case 'ZodNullable':
      return { ...zodToJsonSchema(def.innerType), nullable: true }
    case 'ZodDefault':
      return zodToJsonSchema(def.innerType)
    case 'ZodLiteral':
      return { const: def.value }
    case 'ZodUnion':
      return { anyOf: def.options.map((o: unknown) => zodToJsonSchema(o)) }
    case 'ZodEffects':
      return zodToJsonSchema(def.schema ?? def)
    default:
      return { type: 'object' }
  }
}

function pathToOpenApi(rawPath: string): string {
  return rawPath.replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '/{$1}')
}

function extractPathParams(rawPath: string): string[] {
  const params: string[] = []
  const regex = /\/:([a-zA-Z_][a-zA-Z0-9_]*)/g
  let match
  while ((match = regex.exec(rawPath)) !== null) {
    params.push(match[1])
  }
  return params
}

function isSingleResourcePath(path: string): boolean {
  return /\/[^/]+$/.test(path) && !path.endsWith('/')
}

function successResponseSchema(route: RouteConfig): Record<string, unknown> {
  const isCollection = route.method === 'GET' && !isSingleResourcePath(route.path)
  return isCollection
    ? { $ref: '#/components/schemas/ODataCollectionResponse' }
    : { $ref: '#/components/schemas/ODataSingleResponse' }
}

function errorRef(status: number): string | undefined {
  const map: Record<number, string> = {
    400: 'BadRequest',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'NotFound',
    409: 'Conflict',
    422: 'ValidationError',
    429: 'TooManyRequests',
    500: 'InternalError',
  }
  const name = map[status]
  return name ? `#/components/responses/${name}` : undefined
}

function correlationIdParam(): OpenApiParameter {
  return {
    name: 'X-Correlation-Id',
    in: 'header',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  }
}

function buildParameters(route: RouteConfig): OpenApiParameter[] {
  const params: OpenApiParameter[] = [correlationIdParam()]
  const pathParams = extractPathParams(route.path)

  for (const name of pathParams) {
    params.push({ name, in: 'path', required: true, schema: { type: 'string' } })
  }

  if (route.schema?.params) {
    const resolved = zodToJsonSchema(route.schema.params)
    const properties = (resolved.properties ?? {}) as Record<string, unknown>
    for (const [name, schema] of Object.entries(properties)) {
      if (!params.find((p) => p.name === name)) {
        params.push({
          name,
          in: 'path',
          required: true,
          schema: schema as Record<string, unknown>,
        })
      }
    }
  }

  if (route.schema?.query) {
    const resolved = zodToJsonSchema(route.schema.query)
    const properties = (resolved.properties ?? {}) as Record<string, unknown>
    for (const [name, schema] of Object.entries(properties)) {
      params.push({
        name,
        in: 'query',
        required: false,
        schema: schema as Record<string, unknown>,
      })
    }
  }

  return params
}

function buildRequestBody(route: RouteConfig): OpenApiRequestBody | undefined {
  if (!route.schema?.body) return undefined
  const schema = zodToJsonSchema(route.schema.body)

  return {
    required: true,
    content: {
      'application/json': { schema },
    },
  }
}

function buildResponses(route: RouteConfig): Record<string, OpenApiResponse> {
  const responses: Record<string, OpenApiResponse> = {}
  const successStatus = route.method === 'POST' ? 201 : 200

  for (const res of route.responses ?? []) {
    const status = res.status.toString()
    const isSuccess = res.status === successStatus || (res.status >= 200 && res.status < 300)

    if (isSuccess) {
      const success: OpenApiResponse = {
        description: res.description ?? '',
        content: {
          'application/json': { schema: successResponseSchema(route) },
        },
      }
      responses[status] = success
    } else {
      const ref = errorRef(res.status)
      responses[status] = ref
        ? { $ref: ref }
        : { description: res.description ?? '', $ref: '#/components/responses/InternalError' }
    }
  }

  if (!responses['500']) {
    responses['500'] = { $ref: '#/components/responses/InternalError' }
  }

  return responses
}

const COMPONENTS: Record<string, unknown> = {
  parameters: {
    CorrelationId: {
      name: 'X-Correlation-Id',
      in: 'header',
      required: false,
      description: 'Client-generated identifier for request tracing.',
      schema: { type: 'string', format: 'uuid' },
    },
  },
  responses: {
    BadRequest: {
      description: 'Invalid request format or syntax.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    Unauthorized: {
      description: 'Authentication failed or token missing.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    Forbidden: {
      description: 'Insufficient permissions for this resource.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    NotFound: {
      description: 'Resource not found.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    Conflict: {
      description: 'Conflict with current resource state.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    ValidationError: {
      description: 'Request body or parameters failed validation.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    TooManyRequests: {
      description: 'Rate limit reached. Retry later.',
      headers: {
        'Retry-After': { schema: { type: 'integer' }, description: 'Seconds until retry.' },
      },
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
    InternalError: {
      description: 'Internal server error.',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ODataErrorResponse' } },
      },
    },
  },
  schemas: {
    ODataErrorResponse: {
      type: 'object',
      description: 'OData V4 JSON error response.',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            message: { type: 'string' },
            target: { type: 'string' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  message: { type: 'string' },
                  target: { type: 'string' },
                },
              },
            },
          },
          required: ['code', 'message'],
        },
      },
      required: ['error'],
    },
    ODataSingleResponse: {
      type: 'object',
      description: 'Single resource response (OData V4).',
      properties: {
        value: { type: 'object' },
        '@odata.context': { type: 'string' },
        '@odata.etag': { type: 'string' },
      },
      required: ['value'],
    },
    ODataCollectionResponse: {
      type: 'object',
      description: 'Collection response (OData V4).',
      properties: {
        value: { type: 'array', items: { type: 'object' } },
        '@odata.context': { type: 'string' },
        '@odata.count': { type: 'integer' },
        '@odata.nextLink': { type: 'string', format: 'uri' },
      },
      required: ['value'],
    },
  },
}

function generate(): void {
  const paths: Record<string, Record<string, OpenApiPathItem>> = {}
  const sorted = [...routeRegistry].sort((a, b) => a.path.localeCompare(b.path))

  for (const route of sorted) {
    const openApiPath = pathToOpenApi(route.path)
    const method = route.method.toLowerCase()

    if (!paths[openApiPath]) paths[openApiPath] = {}

    const parameters = buildParameters(route)

    paths[openApiPath][method] = {
      tags: route.tags,
      summary: `${route.method} ${route.path}`,
      operationId: `${route.handler}${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      parameters: parameters.length > 0 ? parameters : undefined,
      requestBody: buildRequestBody(route),
      responses: buildResponses(route),
    }
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: appName,
      version: '0.0.1',
      description: 'Internal Elysia-based framework with OData V4.',
    },
    servers: [{ url: API_BASE_URL, description: 'Server base URL.' }],
    paths,
    components: COMPONENTS,
  }

  const outDir = join(process.cwd(), 'openapi')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const outputPath = join(outDir, `${appName}.openapi.json`)
  writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8')
  console.log(`→ Generated ${outputPath} (${routeRegistry.length} routes)`)
}

generate()