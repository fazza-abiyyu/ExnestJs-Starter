// VA-ORM Validate Command

import { SchemaParser } from '../../../schema/src/schema.parser.js'
import { SchemaValidator } from '../../../schema/src/schema.validator.js'
import * as fs from 'fs/promises'
import * as path from 'path'

export interface ValidateOptions {
  schema?: string
  watch?: boolean
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const schemaPath = options.schema || 'va.schema'

  console.log(`Validating schema: ${schemaPath}`)

  try {
    // Read schema file
    const content = await fs.readFile(path.resolve(schemaPath), 'utf-8')

    // Parse schema
    const parser = new SchemaParser()
    const ast = parser.parse(content)

    // Validate schema
    const validator = new SchemaValidator()
    const { errors, warnings } = validator.validate(ast)

    // Display results
    if (errors.length > 0) {
      console.log('\x1b[31mErrors:\x1b[0m')
      for (const error of errors) {
        console.log(`  - ${error.message}`)
      }
    }

    if (warnings.length > 0) {
      console.log('\x1b[33mWarnings:\x1b[0m')
      for (const warning of warnings) {
        console.log(`  - ${warning.message}`)
      }
    }

    if (errors.length === 0 && warnings.length === 0) {
      console.log('\x1b[32m✓ Schema is valid\x1b[0m')
    } else if (errors.length === 0) {
      console.log('\x1b[33m✓ Schema is valid with warnings\x1b[0m')
    } else {
      console.log('\x1b[31m✗ Schema has errors\x1b[0m')
      process.exit(1)
    }
  } catch (error) {
    console.error('\x1b[31mError reading schema:\x1b[0m', error)
    process.exit(1)
  }
}
