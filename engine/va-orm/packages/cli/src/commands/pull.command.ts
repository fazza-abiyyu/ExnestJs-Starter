// VA-ORM DB Pull Command
//
// Introspects a live database and writes va.schema text.

import { SchemaIntrospector } from '../introspect/schema.introspector.js'
import { createDriverFromUrl, requireDatabaseUrl, detectProvider } from './driver.factory.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface PullOptions {
  output?: string
  schemas?: string[]
  provider?: string
}

export async function pullCommand(options: PullOptions): Promise<void> {
  const connectionString = requireDatabaseUrl()
  const detected = detectProvider(connectionString)
  const provider = options.provider === 'sqlite' || detected === 'sqlite' ? 'sqlite' : 'postgres'
  const output = options.output || './va.pulled.schema'

  console.log(`Introspecting database (${provider})...`)

  const driver = await createDriverFromUrl(connectionString)
  try {
    const introspector = new SchemaIntrospector(driver, provider, options.schemas ?? ['public'])
    const tables = await introspector.introspect()
    console.log(`  Found ${tables.length} tables`)

    const schema = introspector.toSchema(
      tables,
      provider === 'sqlite' ? 'sqlite' : 'postgresql'
    )
    await fs.writeFile(path.resolve(output), schema)
    console.log(`  ✓ Schema written to ${output}`)
  } finally {
    await driver.close()
  }
}
