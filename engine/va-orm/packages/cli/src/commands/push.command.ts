// VA-ORM DB Push Command
//
// Generates DDL from va.schema and applies it directly to the database.

import { SchemaParser } from '../../../schema/src/schema.parser.js'
import { SqlGenerator } from '../generator/sql.generator.js'
import { createDriverFromUrl, requireDatabaseUrl, datasourceToProvider } from './driver.factory.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface PushOptions {
  schema?: string
}

export async function pushCommand(options: PushOptions): Promise<void> {
  const schemaPath = options.schema || 'va.schema'
  console.log(`Pushing schema to database: ${schemaPath}`)

  const content = await fs.readFile(path.resolve(schemaPath), 'utf-8')
  const ast = new SchemaParser().parse(content)

  const datasourceProvider = ast.datasource[0]?.provider ?? 'postgresql'
  const generator = new SqlGenerator(datasourceToProvider(datasourceProvider))
  const ddl = generator.generateDDL(ast)

  const statements = ddl
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))

  const connectionString = requireDatabaseUrl()
  const driver = await createDriverFromUrl(connectionString)

  try {
    for (const statement of statements) {
      await driver.execute(statement)
      const firstLine = statement.split('\n')[0]
      console.log(`  ✓ Executed: ${firstLine.slice(0, 80)}`)
    }
    console.log('\x1b[32m✓ Schema pushed successfully\x1b[0m')
  } finally {
    await driver.close()
  }
}
