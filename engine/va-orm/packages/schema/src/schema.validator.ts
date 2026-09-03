// VA-ORM Schema Validator

import type {
  SchemaAST,
  ValidationError,
  ValidationWarning,
  ModelBlock,
  FieldDefinition,
} from './schema.types.js'

export class SchemaValidator {
  private errors: ValidationError[] = []
  private warnings: ValidationWarning[] = []

  validate(ast: SchemaAST): { errors: ValidationError[]; warnings: ValidationWarning[] } {
    this.errors = []
    this.warnings = []

    this.validateGenerator(ast.generator)
    this.validateDatasource(ast.datasource)
    this.validateModels(ast.model)
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

  private validateModels(models: ModelBlock[]): void {
    const modelNames = new Set<string>()

    for (const model of models) {
      // Check for duplicate model names
      if (modelNames.has(model.name)) {
        this.errors.push({
          line: 0,
          column: 0,
          message: `Duplicate model name: "${model.name}"`,
          severity: 'error',
        })
      }
      modelNames.add(model.name)

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

      // Validate fields
      for (const field of model.fields) {
        this.validateField(model.name, field)
      }
    }
  }

  private validateField(modelName: string, field: FieldDefinition): void {
    // Check field type
    const validTypes = [
      'String', 'Text', 'Int', 'BigInt', 'Float', 'Decimal',
      'Boolean', 'DateTime', 'Uuid', 'Json', 'Bytes',
    ]

    const baseType = field.type.replace('[]', '')
    if (!validTypes.includes(baseType) && !this.isEnumType(baseType)) {
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
    const modelNames = new Set(models.map(m => m.name))

    for (const model of models) {
      for (const field of model.fields) {
        // Check @relation references
        const relationAttr = field.attributes.find(a => a.name === '@relation')
        if (relationAttr && relationAttr.args) {
          const references = relationAttr.args['references'] as string[]
          if (references) {
            for (const ref of references) {
              const [refModel, refField] = ref.split('.')
              if (!modelNames.has(refModel)) {
                this.errors.push({
                  line: 0,
                  column: 0,
                  message: `Relation references non-existent model "${refModel}" in field "${field.name}" of model "${model.name}"`,
                  severity: 'error',
                })
              }
            }
          }
        }

        // Check @relation onDelete
        if (relationAttr && relationAttr.args) {
          const onDelete = relationAttr.args['onDelete'] as string
          if (onDelete && !['Cascade', 'Restrict', 'SetNull', 'NoAction'].includes(onDelete)) {
            this.errors.push({
              line: 0,
              column: 0,
              message: `Invalid onDelete strategy "${onDelete}" in field "${field.name}" of model "${model.name}"`,
              severity: 'error',
            })
          }
        }
      }
    }
  }

  private isEnumType(type: string): boolean {
    // This would need to be checked against the actual schema
    // For now, return false
    return false
  }
}
