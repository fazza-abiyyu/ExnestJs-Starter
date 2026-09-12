// VA-ORM DB Push Command
//
// Generates DDL from va.schema and applies it directly to the database.

import { SchemaParser } from '../../../schema/src/schema.parser.js'
import { SqlGenerator } from '../generator/sql.generator.js'
import { diffStatements } from '../generator/schema.differ.js'
import { createDriverFromUrl, requireDatabaseUrl, datasourceToProvider, detectProvider } from './driver.factory.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface PushOptions {
  schema?: string
  dryRun?: boolean
}

export async function pushCommand(options: PushOptions): Promise<void> {
  const schemaPath = options.schema || 'va.schema'
  console.log(`Pushing schema to database: ${schemaPath}`)

  const content = await fs.readFile(path.resolve(schemaPath), 'utf-8')
  const ast = new SchemaParser().parse(content)

  const datasourceProvider = ast.datasource[0]?.provider ?? 'postgresql'
  const generator = new SqlGenerator(datasourceToProvider(datasourceProvider))
  const ddl = generator.generateDDL(ast)

  const connectionString = requireDatabaseUrl()
  const driver = await createDriverFromUrl(connectionString)

  try {
    const provider = detectProvider(connectionString)
    const { statements, warnings } = await diffStatements(ddl, driver, provider)

    if (options.dryRun) {
      console.log('-- dry run: statements that would execute --')
      for (const statement of statements) {
        console.log(statement + ';')
      }
    } else {
      for (const statement of statements) {
        await driver.execute(statement)
        const firstLine = statement.split('\n')[0]
        console.log(`  ✓ Executed: ${firstLine.slice(0, 80)}`)
      }
    }
    for (const warning of warnings) {
      console.log(`  ! Warning: ${warning}`)
    }
    console.log(
      options.dryRun
        ? '\x1b[32m✓ Dry run complete (nothing executed)\x1b[0m'
        : '\x1b[32m✓ Schema pushed successfully\x1b[0m',
    )
  } finally {
    await driver.close()
  }
}
