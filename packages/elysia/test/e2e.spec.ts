import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/app.js'

describe('e2e (app.handle)', () => {
  test('GET /health/live returns ok', async () => {
    const res = await createApp().handle(new Request('http://localhost/health/live'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.status).toBe('ok')
  })

  test('GET /$metadata returns all entity types', async () => {
    const res = await createApp().handle(new Request('http://localhost/$metadata'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.value.length).toBeGreaterThan(0)
    expect(body['@odata.context']).toContain('/$metadata')
  })

  test('GET /$metadata/:fragment returns a single entity type', async () => {
    const res = await createApp().handle(new Request('http://localhost/$metadata/User'))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.value.name).toBe('User')
  })

  test('GET /$metadata/:fragment returns 404 for unknown fragment', async () => {
    const res = await createApp().handle(new Request('http://localhost/$metadata/Nope'))
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error.code).toBe('EntityTypeNotFound')
  })

  test('POST /api/v1/customers invalid body returns VALIDATION_ERROR', async () => {
    const res = await createApp().handle(
      new Request('http://localhost/api/v1/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)

    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  test('unknown route returns 404 NOT_FOUND', async () => {
    const res = await createApp().handle(new Request('http://localhost/does-not-exist'))
    expect(res.status).toBe(404)

    const body = await res.json()
    expect(body.error.code).toBe('NOT_FOUND')
  })
})