// VA-ORM Type Generator
//
// Generates relation-aware TypeScript types from a SchemaAST:
// model interfaces, WhereInput with relation filters, Select/Include args,
// nested Create/Update data, and UniqueWhere inputs.
// Output follows Exnest style (single quotes, semicolons, trailing commas).

import type { SchemaAST, ModelBlock, FieldDefinition, EnumBlock } from '../../../schema/src/schema.types.js'
import { resolveRelations } from '../../../schema/src/schema.relations.js'
import type { RelationFieldInfo } from '../../../schema/src/schema.types.js'
import { TypeWriter } from './code.writer.js'

export class TypeGenerator {
  private modelNames = new Set<string>()
  private enumNames = new Set<string>()
  private relations = new Map<string, RelationFieldInfo>()
  private w = new TypeWriter()

  generate(ast: SchemaAST): string {
    this.modelNames = new Set(ast.model.map((m) => m.name))
    this.enumNames = new Set(ast.enum.map((e) => e.name))
    this.relations = resolveRelations(ast.model)
    this.w = new TypeWriter()

    for (const enumBlock of ast.enum) {
      this.generateEnum(enumBlock)
      this.w.line()
    }

    for (const model of ast.model) {
      this.generateModelType(model)
      this.w.line()
      this.generateWhereInput(model)
      this.w.line()
      this.generateSelect(model)
      this.w.line()
      this.generateInclude(model)
      this.w.line()
      this.generateUniqueWhere(model)
      this.w.line()
      this.generateCreateInput(model)
      this.w.line()
      for (const name of this.createWithoutNames(model)) {
        this.generateCreateWithout(model, name)
        this.w.line()
      }
      this.generateUpdateInput(model)
      this.w.line()
    }

    return `${this.w.toString().replace(/\n+$/, '')}\n`
  }

  private generateEnum(enumBlock: EnumBlock): void {
    this.w.block(`export enum ${enumBlock.name} {`, () => {
      for (const v of enumBlock.values) {
        this.w.line(`${v.name} = '${v.name}',`)
      }
    }, '}')
  }

  private isRelation(field: FieldDefinition): boolean {
    return this.modelNames.has(field.type.replace('[]', ''))
  }

  private isList(field: FieldDefinition): boolean {
    return field.isArray || field.type.endsWith('[]')
  }

  private relationInfo(modelName: string, fieldName: string): RelationFieldInfo | undefined {
    return this.relations.get(`${modelName}.${fieldName}`)
  }

  private capitalize(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1)
  }

  private withoutVariantName(target: string, field: string): string {
    return `${target}CreateWithout${this.capitalize(field)}Input`
  }

  private generateModelType(model: ModelBlock): void {
    this.w.block(`export interface ${model.name} {`, () => {
      for (const f of model.fields) {
        const type = this.mapType(f.type, f.isArray)
        const optional = f.isOptional ? '?' : ''
        const nullable = f.isOptional && this.isRelation(f) && !this.isList(f) ? ' | null' : ''
        this.w.line(`${f.name}${optional}: ${type}${nullable};`)
      }
    })
  }

  private scalarFilterLines(tsType: string): string[] {
    return [
      `equals?: ${tsType};`,
      `not?: ${tsType};`,
      `in?: ${tsType}[];`,
      `notIn?: ${tsType}[];`,
      `lt?: ${tsType};`,
      `lte?: ${tsType};`,
      `gt?: ${tsType};`,
      `gte?: ${tsType};`,
      `contains?: string;`,
      `startsWith?: string;`,
      `endsWith?: string;`,
      `mode?: 'default' | 'insensitive';`,
    ]
  }

  private unionScalarProp(prop: string, tsType: string): void {
    this.w.line(`${prop}?:`)
    this.w.line(`  | ${tsType}`)
    this.w.line(`  | {`)
    for (const line of this.scalarFilterLines(tsType)) {
      this.w.line(`      ${line}`)
    }
    this.w.line(`    }`)
    this.w.line(`  | null;`)
  }

  private generateWhereInput(model: ModelBlock): void {
    this.w.block(`export type ${model.name}WhereInput = {`, () => {
      this.w.line(`AND?: ${model.name}WhereInput[];`)
      this.w.line(`OR?: ${model.name}WhereInput[];`)
      this.w.line(`NOT?: ${model.name}WhereInput | ${model.name}WhereInput[];`)
      for (const f of model.fields) {
        if (this.isRelation(f)) {
          const target = f.type.replace('[]', '')
          if (this.isList(f)) {
            this.w.block(`${f.name}?: {`, () => {
              this.w.line(`some?: ${target}WhereInput;`)
              this.w.line(`every?: ${target}WhereInput;`)
              this.w.line(`none?: ${target}WhereInput;`)
            }, '};')
          } else {
            this.w.block(`${f.name}?: {`, () => {
              this.w.line(`is?: ${target}WhereInput;`)
              this.w.line(`isNot?: ${target}WhereInput;`)
            }, '} | null;')
          }
          continue
        }
        const type = this.mapType(f.type, false)
        this.unionScalarProp(f.name, type)
      }
    }, '};')
  }

  private generateSelect(model: ModelBlock): void {
    this.w.block(`export type ${model.name}Select = {`, () => {
      for (const f of model.fields) {
        if (this.isRelation(f)) continue
        this.w.line(`${f.name}?: boolean;`)
      }
    }, '};')
  }

  private generateInclude(model: ModelBlock): void {
    this.w.block(`export type ${model.name}Include = {`, () => {
      for (const f of model.fields) {
        if (!this.isRelation(f)) continue
        const target = f.type.replace('[]', '')
        this.w.prop(f.name, `boolean | { where?: ${target}WhereInput; orderBy?: Record<string, 'asc' | 'desc'>; take?: number; skip?: number; select?: ${target}Select; include?: ${target}Include }`)
      }
    }, '};')
  }

  private generateUniqueWhere(model: ModelBlock): void {
    this.w.block(`export type ${model.name}UniqueWhere = {`, () => {
      for (const f of model.fields) {
        if (this.isRelation(f)) continue
        if (!f.attributes.some((a) => a.name === '@id' || a.name === '@unique')) continue
        this.w.line(`${f.name}?: ${this.mapType(f.type, false)};`)
      }
    }, '};')
  }

  private nestedCreateType(model: ModelBlock, f: FieldDefinition): string {
    const target = f.type.replace('[]', '')
    const info = this.relationInfo(model.name, f.name)
    const item = this.resolveNestedCreate(target, info)
    if (this.isList(f)) {
      return `{ create?: ${item} | ${item}[]; connect?: ${target}UniqueWhere | ${target}UniqueWhere[]; connectOrCreate?: { where: ${target}UniqueWhere; create: ${item} } | Array<{ where: ${target}UniqueWhere; create: ${item} }> }`
    }
    return `{ create?: ${item}; connect?: ${target}UniqueWhere; connectOrCreate?: { where: ${target}UniqueWhere; create: ${item} } }`
  }

  private resolveNestedCreate(target: string, info: RelationFieldInfo | undefined): string {
    if (!info?.backField) return `${target}CreateInput`
    const targetInfo = this.relations.get(`${target}.${info.backField}`)
    if (
      targetInfo?.isFkHolder &&
      targetInfo.fkModel === target &&
      targetInfo.kind !== 'many-to-many-implicit'
    ) {
      return this.withoutVariantName(target, targetInfo.field)
    }
    return `${target}CreateInput`
  }

  private createWithoutNames(model: ModelBlock): string[] {
    const names: string[] = []
    const seen = new Set<string>()
    for (const info of this.relations.values()) {
      if (info.fkModel !== model.name || info.fkFields.length === 0) continue
      if (info.kind === 'many-to-many-implicit') continue
      const name = this.withoutVariantName(model.name, info.field)
      if (seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
    return names
  }

  private generateCreateWithout(model: ModelBlock, name: string): void {
    const info = [...this.relations.values()].find(
      (r) => r.fkModel === model.name && this.withoutVariantName(model.name, r.field) === name,
    )
    const omit = new Set(info?.fkFields ?? [])
    this.w.block(`export type ${name} = {`, () => {
      for (const f of model.fields) {
        if (omit.has(f.name)) continue
        if (this.isRelation(f)) {
          this.w.prop(f.name, this.nestedCreateType(model, f))
          continue
        }
        const type = this.mapType(f.type, f.isArray)
        const required = !f.isOptional && !f.attributes.some((a) => a.name === '@default')
        this.w.line(`${f.name}${required ? '' : '?'}: ${type};`)
      }
    }, '};')
  }

  private generateCreateInput(model: ModelBlock): void {
    this.w.block(`export type ${model.name}CreateInput = {`, () => {
      for (const f of model.fields) {
        if (this.isRelation(f)) {
          this.w.prop(f.name, this.nestedCreateType(model, f))
          continue
        }
        const type = this.mapType(f.type, f.isArray)
        const required = !f.isOptional && !f.attributes.some((a) => a.name === '@default')
        this.w.line(`${f.name}${required ? '' : '?'}: ${type};`)
      }
    }, '};')
  }

  private nestedUpdateType(model: ModelBlock, f: FieldDefinition): string {
    const target = f.type.replace('[]', '')
    if (this.isList(f)) {
      return `{ create?: ${target}CreateInput | ${target}CreateInput[]; connect?: ${target}UniqueWhere | ${target}UniqueWhere[]; disconnect?: ${target}UniqueWhere | ${target}UniqueWhere[]; set?: ${target}UniqueWhere | ${target}UniqueWhere[]; update?: { where: ${target}UniqueWhere; data: ${target}UpdateInput } | Array<{ where: ${target}UniqueWhere; data: ${target}UpdateInput }>; connectOrCreate?: { where: ${target}UniqueWhere; create: ${target}CreateInput } | Array<{ where: ${target}UniqueWhere; create: ${target}CreateInput }> }`
    }
    return `{ create?: ${target}CreateInput; connect?: ${target}UniqueWhere; disconnect?: boolean; connectOrCreate?: { where: ${target}UniqueWhere; create: ${target}CreateInput } }`
  }

  private generateUpdateInput(model: ModelBlock): void {
    this.w.block(`export type ${model.name}UpdateInput = {`, () => {
      for (const f of model.fields) {
        if (this.isRelation(f)) {
          this.w.prop(f.name, this.nestedUpdateType(model, f))
          continue
        }
        const type = this.mapType(f.type, f.isArray)
        const numeric = ['Int', 'BigInt', 'Float', 'Decimal'].includes(f.type.replace('[]', ''))
        const ops = numeric
          ? ` | { set?: ${type}; increment?: number; decrement?: number }`
          : ` | { set?: ${type} }`
        this.w.line(`${f.name}?: ${type}${ops};`)
      }
    }, '};')
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
