// VA-ORM Generate Command

import { SchemaParser } from '../../../schema/src/schema.parser.js'
import { TypeGenerator } from '../generator/type.generator.js'
import { ClientGenerator } from '../generator/client.generator.js'
import { SqlGenerator } from '../generator/sql.generator.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface GenerateOptions {
  schema?: string
  output?: string
  provider?: string
  sql?: boolean
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const schemaPath = options.schema || 'va.schema'
  const outputDir = options.output || './generated'
  const provider = options.provider || 'postgres'

  console.log(`Generating from schema: ${schemaPath}`)

  try {
    // Read schema file
    const content = await fs.readFile(path.resolve(schemaPath), 'utf-8')

    // Parse schema
    const parser = new SchemaParser()
    const ast = parser.parse(content)

    // Create output directory
    await fs.mkdir(path.resolve(outputDir), { recursive: true })

    // Generate types
    const typeGenerator = new TypeGenerator()
    const types = typeGenerator.generate(ast)
    await fs.writeFile(path.resolve(outputDir, 'types.ts'), types)
    console.log(`  Generated types.ts`)

    // Generate client
    const clientGenerator = new ClientGenerator()
    const client = clientGenerator.generate(ast)
    await fs.writeFile(path.resolve(outputDir, 'client.ts'), client)
    console.log(`  Generated client.ts`)

    // Generate SQL if requested
    if (options.sql) {
      const sqlGenerator = new SqlGenerator(provider)
      const sql = sqlGenerator.generateDDL(ast)
      await fs.writeFile(path.resolve(outputDir, 'schema.sql'), sql)
      console.log(`  Generated schema.sql`)
    }

    console.log('\x1b[32m✓ Generation complete\x1b[0m')
  } catch (error) {
    console.error('\x1b[31mError generating code:\x1b[0m', error)
    process.exit(1)
  }
}
