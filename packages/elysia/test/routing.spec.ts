import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  mountRoutes,
  type HandlerContext,
  type PermissionHandler,
  type RouteConfig,
} from '../src/lib/endpoint/index.js'
import { ODataError } from '../src/lib/exception/index.js'
import { errorHandler } from '../src/lib/exception/handler.js'
import { ODataResponse } from '../src/lib/odata/index.js'

class TestController {
  create(ctx: HandlerContext) {
    ctx.set.status = 201
    return ODataResponse.item(ctx.body).build()
  }

  list(ctx: HandlerContext) {
    return ODataResponse.collection([{ page: ctx.query.page, tenant: ctx.headers['x-tenant-id'] }])
      .build()
  }

  secure(ctx: HandlerContext) {
    return ODataResponse.item({ allowed: true }).build()
  }
}

function buildApp(permissions?: PermissionHandler[]) {
  const routes: RouteConfig[] = [
    {
      method: 'POST',
      path: '/test',
      handler: 'create',
      schema: { body: z.object({ name: z.string().min(1) }) },
    },
    {
      method: 'GET',
      path: '/test',
      handler: 'list',
      schema: { query: z.object({ page: z.coerce.number() }) },
    },
  ]

  if (permissions) {
    routes.push({ method: 'GET', path: '/test/secure', handler: 'secure', permissions })
  }

  const app = new Elysia().onError(errorHandler) as unknown as Elysia
  return mountRoutes(app, new TestController(), routes)
}

describe('mountRoutes (routing + validation + permissions)', () => {
  test('passes valid body and sets status', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ok' }),
      }),
    )

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.value).toEqual({ name: 'ok' })
  })

  test('rejects invalid body with VALIDATION_ERROR', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '' }),
      }),
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('validates and forwards query params', async () => {
    const res = await buildApp().handle(
      new Request('http://localhost/test?page=2', {
        headers: { 'x-tenant-id': 'tenant-1' },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.value).toEqual([{ page: 2, tenant: 'tenant-1' }])
  })

  test('runs permission handlers and returns 403 when denied', async () => {
    const forbidden: PermissionHandler = () => {
      throw new ODataError('Forbidden', 'No access', 403)
    }
    const res = await buildApp([forbidden]).handle(
      new Request('http://localhost/test/secure'),
    )

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error.code).toBe('Forbidden')
  })

  test('allows request when permission passes', async () => {
    const allow: PermissionHandler = () => {}
    const res = await buildApp([allow]).handle(
      new Request('http://localhost/test/secure'),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.value).toEqual({ allowed: true })
  })
})