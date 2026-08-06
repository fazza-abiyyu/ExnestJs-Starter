import type Elysia from 'elysia'
import type { z } from 'zod'
import { ValidationError } from '../exception/index.js'

export interface HandlerContext {
  params: Record<string, string>
  query: Record<string, string | undefined>
  body: unknown
  headers: Record<string, string | undefined>
  set: {
    status?: number | string
    headers?: Record<string, string>
  }
}

export type AnyController = Record<string, (ctx: HandlerContext) => unknown>

export interface EndpointSchema {
  body?: z.ZodTypeAny
  query?: z.ZodTypeAny
  params?: z.ZodTypeAny
}

export type PermissionHandler = (ctx: HandlerContext) => void

export interface RouteConfig {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  handler: string
  schema?: EndpointSchema
  auth?: boolean
  permissions?: PermissionHandler[]
  tags?: string[]
  responses?: {
    status: number
    description?: string
  }[]
}

type ElysiaContext = {
  params: Record<string, string>
  query: Record<string, string | undefined>
  body: unknown
  headers: Record<string, string | undefined>
  set: { status?: number | string; headers?: Record<string, string> }
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
}

export function mountRoutes(
  app: Elysia,
  controller: object,
  configs: RouteConfig[],
): Elysia {
  const handlers = controller as AnyController

  for (const route of configs) {
    const { path, handler, schema, permissions } = route

    const wrappedHandler = (context: ElysiaContext) => {
      let body = context.body
      let query = context.query
      let params = context.params

      if (schema) {
        if (schema.body) {
          const parsed = schema.body.safeParse(body)
          if (!parsed.success) {
            throw new ValidationError(formatZodError(parsed.error))
          }
          body = parsed.data
        }
        if (schema.query) {
          const parsed = schema.query.safeParse(query)
          if (!parsed.success) {
            throw new ValidationError(formatZodError(parsed.error))
          }
          query = parsed.data as Record<string, string | undefined>
        }
        if (schema.params) {
          const parsed = schema.params.safeParse(params)
          if (!parsed.success) {
            throw new ValidationError(formatZodError(parsed.error))
          }
          params = parsed.data as Record<string, string>
        }
      }

      for (const permission of permissions ?? []) {
        permission({ params, query, body, headers: context.headers, set: context.set })
      }

      const fn = handlers[handler]
      if (typeof fn !== 'function') {
        throw new ValidationError(`Handler '${handler}' is not implemented`)
      }
      return fn.call(controller, {
        params,
        query,
        body,
        headers: context.headers,
        set: context.set,
      })
    }

    app.route(route.method, path, wrappedHandler as never)
  }

  return app
}