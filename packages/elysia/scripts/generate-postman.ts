import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { routeRegistry } from '../src/endpoints/registry.js'
import type { RouteConfig } from '../src/lib/endpoint/index.js'
import { config } from '../src/infrastructure/config/index.js'
import { healthScenarios, metadataScenarios } from './postman/index.js'

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))
const appName = pkg.name ?? 'unnamed'
const baseUrl = config.apiBaseUrl

interface FormDataEntry {
  key: string
  type: 'text' | 'file'
  value?: string
  src?: string
  content?: string
  contentType?: string
}

interface Scenario {
  name: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: Record<string, unknown>
  formdata?: FormDataEntry[]
  prerequest?: string[]
  expect: {
    status: number
    body?: Record<string, unknown>
  }
}

export interface CustomScenario extends Scenario {
  tests?: string[]
  params?: Record<string, string>
}

const customScenarios: Record<string, CustomScenario[]> = {
  ...healthScenarios,
  ...metadataScenarios,
}

function endpointKey(route: RouteConfig): string {
  return `${route.method} ${route.path}`
}

function generateExample(schema: z.ZodTypeAny, fieldName?: string): unknown {
  if (schema instanceof z.ZodObject) {
    const result: Record<string, unknown> = {}
    for (const [key, valueSchema] of Object.entries(schema.shape)) {
      result[key] = generateExample(valueSchema as z.ZodTypeAny, key)
    }
    return result
  }

  if (schema instanceof z.ZodString) {
    if (fieldName?.toLowerCase().includes('email')) return 'user@example.com'
    if (fieldName?.toLowerCase().includes('password')) return 'P@ssw0rd123'
    if (fieldName?.toLowerCase().includes('name') || fieldName?.toLowerCase().includes('display'))
      return 'John Doe'
    if (fieldName?.toLowerCase().includes('phone')) return '+6281234567890'
    if (fieldName?.toLowerCase().includes('url')) return 'https://example.com/image.png'
    return 'string'
  }

  if (schema instanceof z.ZodNumber) return 1
  if (schema instanceof z.ZodBoolean) return true
  if (schema instanceof z.ZodArray) {
    return [generateExample(schema.element as unknown as z.ZodTypeAny)]
  }
  if (schema instanceof z.ZodEnum) return schema.options[0]

  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    const inner =
      'unwrap' in schema
        ? schema.unwrap()
        : (schema as { _def?: { innerType?: unknown } })._def?.innerType
    return generateExample(inner as unknown as z.ZodTypeAny, fieldName)
  }

  if (schema instanceof z.ZodLiteral) return schema.value
  if (schema instanceof z.ZodUnion) {
    return generateExample(schema.options[0] as unknown as z.ZodTypeAny, fieldName)
  }

  return null
}

function generateInvalidExample(schema: z.ZodTypeAny, fieldName?: string): unknown {
  if (schema instanceof z.ZodObject) {
    const result: Record<string, unknown> = {}
    for (const [key, valueSchema] of Object.entries(schema.shape)) {
      result[key] = generateInvalidExample(valueSchema as z.ZodTypeAny, key)
    }
    return result
  }

  if (schema instanceof z.ZodString) {
    if (fieldName?.toLowerCase().includes('email')) return 'not-an-email'
    return fieldName?.toLowerCase().includes('password') ? 'a' : ''
  }

  if (schema instanceof z.ZodNumber) return 'not-a-number'
  if (schema instanceof z.ZodBoolean) return 'not-a-boolean'
  if (schema instanceof z.ZodArray) return 'not-an-array'

  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault
  ) {
    const inner =
      'unwrap' in schema
        ? schema.unwrap()
        : (schema as { _def?: { innerType?: unknown } })._def?.innerType
    return generateInvalidExample(inner as unknown as z.ZodTypeAny, fieldName)
  }

  return null
}

function findSuccessStatus(route: RouteConfig): number {
  if (!route.responses?.length) {
    return route.method === 'POST' ? 201 : 200
  }
  const successCodes = route.responses.filter((r) => r.status < 400).map((r) => r.status)
  return successCodes.length > 0
    ? Math.min(...successCodes)
    : route.method === 'POST'
      ? 201
      : 200
}

function generateScenarios(route: RouteConfig): CustomScenario[] {
  const key = endpointKey(route)
  if (customScenarios[key]) return customScenarios[key]

  const scenarios: CustomScenario[] = []
  const successStatus = findSuccessStatus(route)

  const success: CustomScenario = { name: 'Success', expect: { status: successStatus } }
  if (route.schema?.body) {
    success.body = generateExample(route.schema.body) as Record<string, unknown>
  }
  scenarios.push(success)

  for (const res of route.responses ?? []) {
    if (res.status === successStatus) continue
    if (res.status === 500) continue

    const scenario: CustomScenario = {
      name: res.description ?? `Status ${res.status}`,
      expect: { status: res.status },
    }

    if (res.status === 400 && route.schema?.body) {
      scenario.body = generateInvalidExample(route.schema.body) as Record<string, unknown>
    } else if (route.schema?.body && res.status >= 400) {
      scenario.body = generateExample(route.schema.body) as Record<string, unknown>
    }

    scenarios.push(scenario)
  }

  return scenarios
}

function buildTestScript(
  expectStatus: number,
  expectBody?: Record<string, unknown>,
  customTests?: string[],
): string {
  const skipVars: string[] = []
  let skipStatusAssertion = false

  if (customTests) {
    for (let i = customTests.length - 1; i >= 0; i--) {
      const match = customTests[i].match(/^__skipIf\(([^)]+)\)$/)
      if (match) {
        skipVars.push(match[1])
        customTests.splice(i, 1)
        continue
      }
      if (customTests[i] === '__skipStatusAssertion__') {
        skipStatusAssertion = true
        customTests.splice(i, 1)
      }
    }
  }

  const assertions: string[] = []
  if (!skipStatusAssertion) {
    assertions.push(`pm.response.to.have.status(${expectStatus})`)
  }

  if (expectBody) {
    for (const [key, value] of Object.entries(expectBody)) {
      const isLiteralKey = key.includes('@')
      if (isLiteralKey) {
        assertions.push(
          `pm.expect(pm.response.json()[${JSON.stringify(key)}]).eql(${JSON.stringify(value)})`,
        )
      } else {
        const parts = key.split('.')
        const accessor = parts
          .map((p) =>
            /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(p) ? `.${p}` : `[${JSON.stringify(p)}]`,
          )
          .join('')
        assertions.push(
          `pm.expect(pm.response.json()${accessor}).eql(${JSON.stringify(value)})`,
        )
      }
    }
  }

  if (customTests) {
    for (const test of customTests) {
      assertions.push(test)
    }
  }

  const body = assertions.join(';\n')

  if (skipVars.length > 0) {
    const guard = skipVars
      .map(
        (v) =>
          `(function() { var v = pm.collectionVariables.get(${JSON.stringify(v)}); return !!v; })()`,
      )
      .join(' && ')
    return `if (${guard}) { ${body} } else { pm.test("Skipped: required variable not set", function() { pm.expect(true).to.be.true; }); }`
  }

  return body
}

function buildQueryString(query?: Record<string, string>): string {
  if (!query) return ''
  return '?' + new URLSearchParams(query).toString()
}

function folderName(path: string): string {
  return path.split('/').filter(Boolean)[0] ?? 'ungrouped'
}

function buildItem(route: RouteConfig, scenario: CustomScenario): Record<string, unknown> {
  let resolvedPath = route.path
  if (scenario.params) {
    for (const [key, value] of Object.entries(scenario.params)) {
      resolvedPath = resolvedPath.replace(`:${key}`, value)
    }
  }
  const path = resolvedPath + buildQueryString(scenario.query)
  const testScript = buildTestScript(scenario.expect.status, scenario.expect.body, scenario.tests)
  const events: Record<string, unknown>[] = []

  if (scenario.prerequest) {
    const hasAwait = scenario.prerequest.some((line) => line.includes('await'))
    let execLines = scenario.prerequest
    if (hasAwait) {
      execLines = [
        '(async () => {',
        '  const sendRequest = (options) => new Promise((resolve, reject) => {',
        '    pm.sendRequest(options, (err, res) => {',
        '      if (err) reject(err);',
        '      else resolve(res);',
        '    });',
        '  });',
        ...scenario.prerequest.map((line) => '  ' + line.replace(/pm\.sendRequest/g, 'sendRequest')),
        '})().catch(console.error);',
      ]
    }
    events.push({
      listen: 'prerequest',
      script: {
        exec: execLines,
        type: 'text/javascript',
      },
    })
  }

  events.push({
    listen: 'test',
    script: {
      exec: testScript.split('\n'),
      type: 'text/javascript',
    },
  })

  const headers: Record<string, string>[] = []
  if (scenario.headers) {
    for (const [key, value] of Object.entries(scenario.headers)) {
      headers.push({ key, value })
    }
  }

  const request: Record<string, unknown> = {
    method: route.method,
    header: headers,
    url: {
      raw: `{{baseUrl}}${path}`,
      host: ['{{baseUrl}}'],
      path: path.split('/').filter(Boolean),
    },
  }

  if (scenario.body) {
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(scenario.body, null, 2),
    }
    if (!headers.find((h) => h.key === 'Content-Type')) {
      headers.push({ key: 'Content-Type', value: 'application/json' })
    }
  }

  if (scenario.formdata) {
    request.body = {
      mode: 'formdata',
      formdata: scenario.formdata.map((entry) => ({
        key: entry.key,
        type: entry.type,
        ...(entry.type === 'file' && entry.content ? { content: entry.content } : {}),
        ...(entry.type === 'file' && entry.src && !entry.content ? { src: entry.src } : {}),
        ...(entry.type === 'text' && entry.value !== undefined ? { value: entry.value } : {}),
        ...(entry.contentType ? { contentType: entry.contentType } : {}),
      })),
    }
  }

  return {
    name: `${route.method} ${path}`,
    event: events,
    request,
  }
}

function generate(): void {
  const folders = new Map<string, Record<string, unknown>[]>()

  for (const route of routeRegistry) {
    const folder = folderName(route.path)
    if (!folders.has(folder)) folders.set(folder, [])

    for (const scenario of generateScenarios(route)) {
      folders.get(folder)!.push(buildItem(route, scenario))
    }
  }

  const items: Record<string, unknown>[] = []
  for (const [name, children] of folders) {
    items.push({ name, item: children })
  }

  const collection = {
    info: {
      name: appName,
      description: 'Auto-generated from endpoint configs',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: items,
    variable: [{ key: 'baseUrl', value: baseUrl, type: 'string' }],
  }

  const outDir = join(process.cwd(), 'postman')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const outputPath = join(outDir, `${appName}.postman_collection.json`)
  writeFileSync(outputPath, JSON.stringify(collection, null, 2), 'utf-8')
  console.log(`→ Generated ${outputPath}`)
}

generate()