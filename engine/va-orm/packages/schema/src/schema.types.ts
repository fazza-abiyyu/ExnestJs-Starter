// VA-ORM Schema Types

export interface SchemaAST {
  generator: GeneratorBlock[]
  datasource: DatasourceBlock[]
  model: ModelBlock[]
  enum: EnumBlock[]
}

export interface GeneratorBlock {
  name: string
  provider: string
  output?: string
  binaryTargets?: string[]
}

export interface DatasourceBlock {
  name: string
  provider: string
  url: string
}

export interface ModelBlock {
  name: string
  tableName?: string
  fields: FieldDefinition[]
  attributes: ModelAttribute[]
}

export interface FieldDefinition {
  name: string
  type: string
  isArray: boolean
  isOptional: boolean
  attributes: FieldAttribute[]
}

export interface FieldAttribute {
  name: string
  args: Record<string, any>
}

export interface ModelAttribute {
  name: string
  args: Record<string, any>
}

export interface EnumBlock {
  name: string
  values: EnumValue[]
}

export interface EnumValue {
  name: string
  attributes?: FieldAttribute[]
}

// ============ VALIDATION ============

export interface ValidationError {
  line: number
  column: number
  message: string
  severity: 'error' | 'warning' | 'info'
}

export interface ValidationWarning {
  line: number
  column: number
  message: string
}

// ============ SCHEMA INFO ============

export interface SchemaInfo {
  models: ModelInfo[]
  enums: EnumInfo[]
  generator: GeneratorInfo
  datasource: DatasourceInfo
}

export interface ModelInfo {
  name: string
  tableName: string
  fields: FieldInfo[]
  primaryKey?: string
  indexes: IndexInfo[]
}

export interface FieldInfo {
  name: string
  type: string
  isOptional: boolean
  isArray: boolean
  isId: boolean
  isUnique: boolean
  hasDefault: boolean
  defaultValue?: any
  references?: ReferenceInfo
}

export interface ReferenceInfo {
  model: string
  field: string
  onDelete?: string
}

export interface IndexInfo {
  fields: string[]
  isUnique: boolean
}

export interface EnumInfo {
  name: string
  values: string[]
}

export interface GeneratorInfo {
  provider: string
  output: string
}

export interface DatasourceInfo {
  provider: string
  url: string
}
