// VA-ORM Schema Mapping
//
// Resolves database table/column names from @map/@@map attributes,
// falling back to model tableName or snake_case.

import type { FieldDefinition, ModelBlock } from './schema.types.js'

export function toSnakeCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

export function tableNameOf(model: ModelBlock): string {
  if (model.tableName) return model.tableName
  const mapAttr = model.attributes.find((a) => a.name === '@@map')
  if (mapAttr) {
    const mapped = firstPositionalArg(mapAttr.args)
    if (mapped !== undefined) return mapped
  }
  return toSnakeCase(model.name)
}

export function columnNameOfField(field: FieldDefinition): string {
  return field.columnName || field.name
}

export function columnNameOf(model: ModelBlock, fieldName: string): string {
  const field = model.fields.find((f) => f.name === fieldName)
  if (!field) return fieldName
  return columnNameOfField(field)
}

function firstPositionalArg(args: Record<string, any>): string | undefined {
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
