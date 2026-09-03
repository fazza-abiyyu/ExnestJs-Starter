// VA-ORM Type Generator

import type { SchemaAST, ModelBlock, FieldDefinition, EnumBlock } from '../../../schema/src/schema.types.js'

export class TypeGenerator {
  generate(ast: SchemaAST): string {
    const lines: string[] = []

    // Generate enum types
    for (const enumBlock of ast.enum) {
      lines.push(this.generateEnum(enumBlock))
      lines.push('')
    }

    // Generate model types
    for (const model of ast.model) {
      lines.push(this.generateModelType(model))
      lines.push('')
      lines.push(this.generateCreateInput(model))
      lines.push('')
      lines.push(this.generateUpdateInput(model))
      lines.push('')
      lines.push(this.generateWhereInput(model))
      lines.push('')
    }

    return lines.join('\n')
  }

  private generateEnum(enumBlock: EnumBlock): string {
    const values = enumBlock.values.map(v => `  ${v.name} = '${v.name}'`).join(',\n')
    return `export enum ${enumBlock.name} {\n${values}\n}`
  }

  private generateModelType(model: ModelBlock): string {
    const fields = model.fields.map(f => {
      const type = this.mapType(f.type, f.isArray)
      const optional = f.isOptional ? '?' : ''
      return `  ${f.name}${optional}: ${type}`
    }).join('\n')

    return `export interface ${model.name} {\n${fields}\n}`
  }

  private generateCreateInput(model: ModelBlock): string {
    const fields = model.fields
      .filter(f => !f.attributes.some(a => a.name === '@default'))
      .map(f => {
        const type = this.mapType(f.type, f.isArray)
        const optional = f.isOptional || f.attributes.some(a => a.name === '@default') ? '?' : ''
        return `  ${f.name}${optional}: ${type}`
      })
      .join('\n')

    return `export interface ${model.name}CreateInput {\n${fields}\n}`
  }

  private generateUpdateInput(model: ModelBlock): string {
    const fields = model.fields.map(f => {
      const type = this.mapType(f.type, f.isArray)
      return `  ${f.name}?: ${type} | { increment: number } | { decrement: number } | { multiply: number } | { divide: number }`
    }).join('\n')

    return `export interface ${model.name}UpdateInput {\n${fields}\n}`
  }

  private generateWhereInput(model: ModelBlock): string {
    const fields = model.fields.flatMap(f => {
      const type = this.mapType(f.type, f.isArray)
      return [
        `  ${f.name}?: ${type} | { equals: ${type} } | { not: ${type} } | { in: ${type}[] } | { notIn: ${type}[] } | { contains: string } | { startsWith: string } | { endsWith: string }`,
      ]
    }).join('\n')

    return `export interface ${model.name}WhereInput {\n  AND?: ${model.name}WhereInput[]\n  OR?: ${model.name}WhereInput[]\n  NOT?: ${model.name}WhereInput[]\n${fields}\n}`
  }

  private mapType(type: string, isArray: boolean = false): string {
    const typeMap: Record<string, string> = {
      'String': 'string',
      'Text': 'string',
      'Int': 'number',
      'BigInt': 'bigint',
      'Float': 'number',
      'Decimal': 'number',
      'Boolean': 'boolean',
      'DateTime': 'Date',
      'Uuid': 'string',
      'Json': 'any',
      'Bytes': 'Buffer',
    }

    const baseType = type.replace('[]', '')
    const mapped = typeMap[baseType] ?? baseType

    if (isArray) {
      return `${mapped}[]`
    }

    return mapped
  }
}
