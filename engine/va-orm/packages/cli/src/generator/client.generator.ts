// VA-ORM Client Generator

import type { SchemaAST, ModelBlock } from '../../../schema/src/schema.types.js'

export class ClientGenerator {
  generate(ast: SchemaAST): string {
    const lines: string[] = []

    // Imports
    lines.push(`import { VaClient, Repository } from '@exnest/va-client'`)
    lines.push('')
    lines.push(`export interface VaClientConfig {`)
    lines.push(`  connectionString: string`)
    lines.push(`  pooling?: boolean`)
    lines.push(`}`)
    lines.push('')

    // VaClient class
    lines.push(`export class VaClientGenerated extends VaClient {`)
    lines.push(`  constructor(config: VaClientConfig) {`)
    lines.push(`    super({`)
    lines.push(`      driver: 'postgres',`)
    lines.push(`      dsn: config.connectionString,`)
    lines.push(`      pooling: config.pooling ?? true,`)
    lines.push(`      models: {`)

    for (const model of ast.model) {
      lines.push(`        ${model.name}: {`)
      lines.push(`          tableName: '${model.tableName || this.toSnakeCase(model.name)}',`)
      lines.push(`        },`)
    }

    lines.push(`      },`)
    lines.push(`    })`)
    lines.push(`  }`)

    // Generate repository accessors
    for (const model of ast.model) {
      lines.push('')
      lines.push(`  get ${this.toCamelCase(model.name)}(): Repository<${model.name}> {`)
      lines.push(`    return this.repository('${model.name}')`)
      lines.push(`  }`)
    }

    lines.push(`}`)

    return lines.join('\n')
  }

  private toSnakeCase(str: string): string {
    return str
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '')
  }

  private toCamelCase(str: string): string {
    // Keep PascalCase as is for repository accessors
    return str
  }
}
