// VA-ORM Schema Validator

import type {
  SchemaAST,
  ValidationError,
  ValidationWarning,
  ModelBlock,
  FieldDefinition,
  GeneratorBlock,
  DatasourceBlock,
} from './schema.types.js'
import { isScalarType } from './schema.relations.js'

export class SchemaValidator {
  private errors: ValidationError[] = []
  private warnings: ValidationWarning[] = []

  validate(ast: SchemaAST): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    this.errors = []
    this.warnings = []

    this.validateGenerator(ast.generator)
    this.validateDatasource(ast.datasource)
    this.validateModels(ast.model, ast.enum)
    this.validateEnums(ast.enum)
    this.validateRelations(ast.model)

    return { errors: this.errors, warnings: this.warnings }
  }

  private validateGenerator(generators: GeneratorBlock[]): void {
    if (generators.length === 0) {
      this.errors.push({
        line: 0,
        column: 0,
        message: 'No generator block defined',
        severity: 'error',
      })
      return
    }

    for (const gen of generators) {
      if (!gen.provider) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Generator "${gen.name}" must have a provider`,
          severity: 'error',
        })
      }
    }
  }

  private validateDatasource(datasources: DatasourceBlock[]): void {
    if (datasources.length === 0) {
      this.errors.push({
        line: 0,
        column: 0,
        message: 'No datasource block defined',
        severity: 'error',
      })
      return
    }

    for (const ds of datasources) {
      if (!ds.provider) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Datasource "${ds.name}" must have a provider`,
          severity: 'error',
        })
      }

      if (!ds.url) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Datasource "${ds.name}" must have a url`,
          severity: 'error',
        })
      }
    }
  }

  private validateModels(models: ModelBlock[], enums: any[]): void {
    const modelNames = new Set<string>(models.map((m) => m.name))
    const enumNames = new Set<string>(enums.map((e) => e.name))
    const seen = new Set<string>()

    for (const model of models) {
      if (seen.has(model.name)) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Duplicate model name: "${model.name}"`,
          severity: 'error',
        })
      }
      seen.add(model.name)

      // Check for fields
      if (model.fields.length === 0) {
        this.warnings.push({
          line: 0,
          column: 0,
          message: `Model "${model.name}" has no fields`,
        })
      }

      // Check for primary key
      const hasId = model.fields.some(f =>
        f.attributes.some(a => a.name === '@id')
      )
      if (!hasId) {
        this.warnings.push({
          line: 0,
          column: 0,
          message: `Model "${model.name}" has no @id field`,
        })
      }

      // Check @@map has a string argument
      const mapAttr = model.attributes.find((a) => a.name === '@@map')
      if (mapAttr && firstStringArg(mapAttr.args) === undefined) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `@@map on model "${model.name}" requires a table name string`,
          severity: 'error',
        })
      }

      // Validate fields
      for (const field of model.fields) {
        this.validateField(model.name, field, modelNames, enumNames)
      }
    }
  }

  private validateField(
    modelName: string,
    field: FieldDefinition,
    modelNames: Set<string>,
    enumNames: Set<string>
  ): void {
    // Check field type (scalar, enum, or relation to another model)
    const baseType = field.type.replace('[]', '')
    const isRelation = modelNames.has(baseType)
    if (!isScalarType(field.type, enumNames) && !isRelation) {
      this.errors.push({
        line: 0,
        column: 0,
        message: `Invalid type "${field.type}" for field "${field.name}" in model "${modelName}"`,
        severity: 'error',
      })
    }

    // Check for multiple @id
    const idCount = field.attributes.filter(a => a.name === '@id').length
    if (idCount > 1) {
      this.errors.push({
        line: 0,
        column: 0,
        message: `Field "${field.name}" in model "${modelName}" has multiple @id attributes`,
        severity: 'error',
      })
    }

    // Check for conflicting attributes
    const hasUnique = field.attributes.some(a => a.name === '@unique')
    const hasId = field.attributes.some(a => a.name === '@id')
    if (hasUnique && hasId) {
      this.warnings.push({
        line: 0,
        column: 0,
        message: `Field "${field.name}" in model "${modelName}" has both @id and @unique (redundant)`,
      })
    }

    // Check @map has a string argument
    const mapAttr = field.attributes.find((a) => a.name === '@map')
    if (mapAttr && firstStringArg(mapAttr.args) === undefined) {
      this.errors.push({
        line: 0,
        column: 0,
        message: `@map on field "${field.name}" in model "${modelName}" requires a column name string`,
        severity: 'error',
      })
    }
  }

  private validateEnums(enums: any[]): void {
    const enumNames = new Set<string>()

    for (const enumBlock of enums) {
      // Check for duplicate enum names
      if (enumNames.has(enumBlock.name)) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Duplicate enum name: "${enumBlock.name}"`,
          severity: 'error',
        })
      }
      enumNames.add(enumBlock.name)

      // Check for empty enum
      if (enumBlock.values.length === 0) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Enum "${enumBlock.name}" has no values`,
          severity: 'error',
        })
      }

      // Check for duplicate values
      const values = new Set<string>()
      for (const value of enumBlock.values) {
        if (values.has(value.name)) {
          this.errors.push({
            line: 0,
            column: 0,
            message: `Duplicate value "${value.name}" in enum "${enumBlock.name}"`,
            severity: 'error',
          })
        }
        values.add(value.name)
      }
    }
  }

  private validateRelations(models: ModelBlock[]): void {
    const byName = new Map(models.map((m) => [m.name, m]))

    for (const model of models) {
      const unnamedTargets = new Map<string, string[]>()
      for (const field of model.fields) {
        const targetModel = field.type.replace('[]', '')
        if (!byName.has(targetModel)) continue
        const relationAttr = field.attributes.find((a) => a.name === '@relation')
        const args = relationAttr?.args ?? {}
        const relationName = Object.entries(args).find(
          ([k, v]) => v === true && k !== field.name
        )?.[0]

        if (!relationName) {
          const list = unnamedTargets.get(targetModel) ?? []
          list.push(field.name)
          unnamedTargets.set(targetModel, list)
        }

        const fkFields = toStringArray(args['fields'])
        const references = toStringArray(args['references'])

        for (const fk of fkFields) {
          if (!model.fields.some((f) => f.name === fk)) {
            this.errors.push({
              line: 0,
              column: 0,
              message: `Relation field "${fk}" does not exist in model "${model.name}" (field "${field.name}")`,
              severity: 'error',
            })
          }
        }

        const target = byName.get(targetModel)
        for (const ref of references) {
          if (target && !target.fields.some((f) => f.name === ref)) {
            this.errors.push({
              line: 0,
              column: 0,
              message: `Relation references non-existent field "${ref}" in model "${targetModel}" (field "${field.name}" of model "${model.name}")`,
              severity: 'error',
            })
          }
        }

        if (references.length > 0 && fkFields.length === 0) {
          this.errors.push({
            line: 0,
            column: 0,
            message: `Relation on field "${field.name}" of model "${model.name}" has references without fields`,
            severity: 'error',
          })
        }

        // Check @relation onDelete
        const onDelete = args['onDelete'] !== undefined ? stripArgQuotes(String(args['onDelete'])) : undefined
        if (onDelete && !['Cascade', 'Restrict', 'SetNull', 'NoAction', 'SetDefault'].includes(onDelete)) {
          this.errors.push({
            line: 0,
            column: 0,
            message: `Invalid onDelete strategy "${onDelete}" in field "${field.name}" of model "${model.name}"`,
            severity: 'error',
          })
        }
      }

      for (const [target, fields] of unnamedTargets) {
        if (fields.length > 1) {
          this.errors.push({
            line: 0,
            column: 0,
            message: `Multiple relations to model "${target}" in model "${model.name}" (${fields.join(', ')}) require a relation name: @relation("Name", ...)`,
            severity: 'error',
          })
        }
      }
    }
  }

}
function toStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => stripArgQuotes(String(v)))
  if (value === undefined || value === null) return []
  return [stripArgQuotes(String(value))]
}

function firstStringArg(args: Record<string, any>): string | undefined {
  if (typeof args.value === 'string') return stripArgQuotes(args.value)
  for (const [key, value] of Object.entries(args)) {
    if (value === true) return stripArgQuotes(key)
  }
  return undefined
}

function stripArgQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}
