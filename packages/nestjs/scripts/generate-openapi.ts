import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { endpointRegistry } from '../src/endpoints/registry.js';
import type { EndpointConfig } from '../src/lib/endpoint/index.js';

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8'));
const appName = pkg.name ?? 'unnamed';

dotenvConfig();

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';

interface OpenApiPathItem {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: Record<string, string[]>[];
  deprecated?: boolean;
}

interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  description?: string;
  schema: Record<string, unknown>;
}

interface OpenApiRequestBody {
  required: boolean;
  content: Record<
    string,
    {
      schema: Record<string, unknown>;
      example?: unknown;
    }
  >;
}

interface OpenApiResponse {
  description?: string;
  $ref?: string;
  headers?: Record<string, { $ref: string }>;
  content?: Record<
    string,
    {
      schema: Record<string, unknown>;
      examples?: Record<string, { summary: string; value: unknown }>;
    }
  >;
}

function pathToOpenApi(expressPath: string): string {
  return expressPath.replace(/\/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '/{$1}');
}

function extractPathParams(expressPath: string): string[] {
  const params: string[] = [];
  const regex = /\/:([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match;
  while ((match = regex.exec(expressPath)) !== null) {
    params.push(match[1]);
  }
  return params;
}

function replaceDates(schema: z.ZodTypeAny): z.ZodTypeAny {
  const s = schema as any;
  if (!s || typeof s !== 'object') return schema;

  if (s.type === 'date') return z.string().datetime();

  if (s.type === 'object' && s.shape) {
    const newShape: Record<string, z.ZodTypeAny> = {};
    for (const key of Object.keys(s.shape)) {
      newShape[key] = replaceDates(s.shape[key]);
    }
    return z.object(newShape);
  }

  if (s.type === 'array' && s.element) {
    return z.array(replaceDates(s.element));
  }

  if (s.type === 'union' && s.options) {
    return z.union(s.options.map((o: any) => replaceDates(o)));
  }

  if (s.type === 'record') {
    const val = s.valueType ? replaceDates(s.valueType) : s.valueType;
    return z.record(s.keyType, val);
  }

  if (s.type === 'optional' || s.type === 'nullable') {
    const inner = s.unwrap();
    if (inner) {
      const replaced = replaceDates(inner);
      return s.type === 'optional' ? replaced.optional() : replaced.nullable();
    }
  }

  if (s.type === 'null') return z.null();
  if (s.type === 'undefined') return z.undefined();

  return schema;
}

function resolveSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    const patched = replaceDates(schema);
    const raw = (patched as any).toJSONSchema() as Record<string, unknown>;
    if (typeof raw === 'object' && raw !== null) {
      const { $schema: _$schema, $defs: rawDefs, ...rest } = raw as Record<string, unknown>;
      if (rawDefs && typeof rawDefs === 'object') {
        const defs = rawDefs as Record<string, unknown>;
        return resolveDefs(rest, defs) as Record<string, unknown>;
      }
      return rest;
    }
    return raw;
  } catch {
    return { type: 'object' };
  }
}

function resolveDefs(node: unknown, defs: Record<string, unknown>): unknown {
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((item) => resolveDefs(item, defs));

  const obj = node as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === '$ref' && typeof value === 'string') {
      const defName = value.replace(/^#\/\$defs\//, '');
      if (defs[defName] !== undefined) {
        const resolved = resolveDefs(defs[defName], defs);
        if (resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
          Object.assign(result, resolved as Record<string, unknown>);
        } else {
          result[key] = resolved;
        }
        continue;
      }
    }
    result[key] = resolveDefs(value, defs);
  }

  return result;
}

function isSingleResourcePath(path: string): boolean {
  return /\/[^/]+$/.test(path) && !path.endsWith('/');
}

function successResponseSchema(config: EndpointConfig): Record<string, unknown> {
  const isCollection = config.method === 'GET' && !isSingleResourcePath(config.path);
  return isCollection
    ? { $ref: '#/components/schemas/ODataCollectionResponse' }
    : { $ref: '#/components/schemas/ODataSingleResponse' };
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
  };
  const name = map[status];
  return name ? `#/components/responses/${name}` : undefined;
}

function correlationIdParam(): OpenApiParameter {
  return {
    name: 'X-Correlation-Id',
    in: 'header',
    required: false,
    schema: { type: 'string', format: 'uuid' },
  };
}

function buildParameters(config: EndpointConfig): OpenApiParameter[] {
  const params: OpenApiParameter[] = [correlationIdParam()];
  const pathParams = extractPathParams(config.path);

  for (const name of pathParams) {
    params.push({ name, in: 'path', required: true, schema: { type: 'string' } });
  }

  if (config.schema?.params) {
    const resolved = resolveSchema(config.schema.params);
    const properties = (resolved.properties ?? {}) as Record<string, unknown>;
    for (const [name, schema] of Object.entries(properties)) {
      if (!params.find((p) => p.name === name)) {
        params.push({
          name,
          in: 'path',
          required: true,
          schema: schema as Record<string, unknown>,
        });
      }
    }
  }

  if (config.schema?.query) {
    const resolved = resolveSchema(config.schema.query);
    const properties = (resolved.properties ?? {}) as Record<string, unknown>;
    for (const [name, schema] of Object.entries(properties)) {
      params.push({
        name,
        in: 'query',
        required: false,
        schema: schema as Record<string, unknown>,
      });
    }
  }

  return params;
}

function buildRequestBody(config: EndpointConfig): OpenApiRequestBody | undefined {
  if (!config.schema?.body) return undefined;
  const schema = resolveSchema(config.schema.body);

  return {
    required: true,
    content: {
      'application/json': { schema },
    },
  };
}

function buildSuccessResponse(config: EndpointConfig, statusCode: number): OpenApiResponse {
  return {
    description: '',
    content: {
      'application/json': {
        schema: successResponseSchema(config),
      },
    },
  };
}

function buildResponses(config: EndpointConfig): Record<string, OpenApiResponse> {
  const responses: Record<string, OpenApiResponse> = {};
  const successStatus = config.method === 'POST' ? 201 : 200;

  for (const res of config.responses ?? []) {
    const status = res.status.toString();
    const isSuccess = res.status === successStatus || (res.status >= 200 && res.status < 300);

    if (isSuccess) {
      responses[status] = buildSuccessResponse(config, res.status);
      responses[status].description = res.description ?? '';
    } else {
      const ref = errorRef(res.status);
      responses[status] = ref
        ? { $ref: ref }
        : { description: res.description ?? '', $ref: '#/components/responses/InternalError' };
    }
  }

  if (!responses['500']) {
    responses['500'] = { $ref: '#/components/responses/InternalError' };
  }

  return responses;
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
};

function generate(): void {
  const paths: Record<string, Record<string, OpenApiPathItem>> = {};
  const sorted = [...endpointRegistry].sort((a, b) => a.path.localeCompare(b.path));

  for (const config of sorted) {
    const openApiPath = pathToOpenApi(config.path);
    const method = config.method.toLowerCase();

    if (!paths[openApiPath]) paths[openApiPath] = {};

    const parameters = buildParameters(config);

    paths[openApiPath][method] = {
      tags: config.tags,
      summary: `${config.method} ${config.path}`,
      operationId: `${config.handler}${config.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      parameters: parameters.length > 0 ? parameters : undefined,
      requestBody: buildRequestBody(config),
      responses: buildResponses(config),
    };
  }

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Exnest API',
      version: '0.0.1',
      description: 'Internal NestJS-based framework with OData V4.',
    },
    servers: [{ url: '/', description: 'Relative server; host determined by deployment.' }],
    paths,
    components: COMPONENTS,
  };

  const outputDir = resolve(__dirname, '../openapi');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const outputPath = resolve(outputDir, `${appName}.openapi.json`);
  writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');
  console.log(`OpenAPI spec generated: ${outputPath}`);
}

generate();
