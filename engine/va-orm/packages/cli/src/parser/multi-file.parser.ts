// VA-ORM Multi-File Schema Parser

import * as fs from 'fs'
import * as path from 'path'
import { SchemaParser } from '../../schema/src/schema.parser.js'
import type { SchemaAST, GeneratorBlock, DatasourceBlock, ModelBlock, EnumBlock } from '../../schema/src/schema.types.js'

export class MultiFileParser {
  private parser = new SchemaParser()

  parse(schemaPath: string): SchemaAST {
    const stat = fs.statSync(schemaPath)

    if (stat.isFile()) {
      return this.parser.parse(fs.readFileSync(schemaPath, 'utf-8'))
    }

    return this.parseDirectory(schemaPath)
  }

  private parseDirectory(dirPath: string): SchemaAST {
    const files = fs.readdirSync(dirPath)
      .filter(f => f.endsWith('.prisma') || f.endsWith('.schema'))
      .sort()

    if (files.length === 0) {
      throw new Error(`No schema files found in ${dirPath}`)
    }

    const merged: SchemaAST = {
      generator: [],
      datasource: [],
      model: [],
      enum: [],
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file)
      const content = fs.readFileSync(filePath, 'utf-8')
      const ast = this.parser.parse(content)

      this.mergeAST(merged, ast)
    }

    this.validateMerged(merged)
    return merged
  }

  private mergeAST(target: SchemaAST, source: SchemaAST): void {
    // Merge generators (only one allowed)
    for (const gen of source.generator) {
      if (target.generator.length > 0) {
        const existing = target.generator[0]
        if (gen.provider && !existing.provider) existing.provider = gen.provider
        if (gen.output && !existing.output) existing.output = gen.output
        if (gen.binaryTargets && !existing.binaryTargets) existing.binaryTargets = gen.binaryTargets
      } else {
        target.generator.push(gen)
      }
    }

    // Merge datasources (only one allowed)
    for (const ds of source.datasource) {
      if (target.datasource.length > 0) {
        const existing = target.datasource[0]
        if (ds.provider && !existing.provider) existing.provider = ds.provider
        if (ds.url && !existing.url) existing.url = ds.url
      } else {
        target.datasource.push(ds)
      }
    }

    // Merge models (no duplicates)
    const existingModels = new Set(target.model.map(m => m.name))
    for (const model of source.model) {
      if (existingModels.has(model.name)) {
        throw new Error(`Duplicate model "${model.name}" found in schema files`)
      }
      target.model.push(model)
      existingModels.add(model.name)
    }

    // Merge enums (no duplicates)
    const existingEnums = new Set(target.enum.map(e => e.name))
    for (const enumBlock of source.enum) {
      if (existingEnums.has(enumBlock.name)) {
        throw new Error(`Duplicate enum "${enumBlock.name}" found in schema files`)
      }
      target.enum.push(enumBlock)
      existingEnums.add(enumBlock.name)
    }
  }

  private validateMerged(ast: SchemaAST): void {
    if (ast.generator.length === 0) {
      throw new Error('No generator block found in schema files')
    }
    if (ast.datasource.length === 0) {
      throw new Error('No datasource block found in schema files')
    }
    if (ast.model.length === 0) {
      throw new Error('No model definitions found in schema files')
    }

    // Validate cross-file relations
    const modelNames = new Set(ast.model.map(m => m.name))
    for (const model of ast.model) {
      for (const field of model.fields) {
        const baseType = field.type.replace('[]', '')
        if (baseType !== field.type && !modelNames.has(baseType)) {
          // It's an array field referencing another model
          if (!modelNames.has(baseType)) {
            throw new Error(`Model "${model.name}" references unknown model "${baseType}" in field "${field.name}"`)
          }
        }
      }
    }
  }
}
