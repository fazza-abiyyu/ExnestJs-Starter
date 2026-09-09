// VA-ORM Schema Relations Resolver
//
// Derives relation metadata from a parsed SchemaAST:
// - FK-holder side (@relation with fields/references)
// - Back-reference side (list or single without @relation args)
// - Named relations (@relation("Name", ...))
// - Self-relations
// - Implicit many-to-many (list <-> list, no @relation args)

import type {
  ModelBlock,
  RelationFieldInfo,
  RelationKind,
} from './schema.types.js'

const SCALAR_TYPES = new Set([
  'String', 'Text', 'Int', 'BigInt', 'Float', 'Decimal',
  'Boolean', 'DateTime', 'Uuid', 'Json', 'Bytes',
])

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  return value
}

function asStringArray(value: any): string[] {
  if (Array.isArray(value)) return value.map((v) => stripQuotes(String(v)))
  if (value === undefined || value === null) return []
  return [stripQuotes(String(value))]
}

function isModelType(type: string, modelNames: Set<string>): boolean {
  return modelNames.has(type.replace('[]', ''))
}

export function resolveRelations(
  models: ModelBlock[],
  tableNames: Map<string, string> = new Map()
): Map<string, RelationFieldInfo> {
  const modelNames = new Set(models.map((m) => m.name))
  const byName = new Map(models.map((m) => [m.name, m]))
  const result = new Map<string, RelationFieldInfo>()

  for (const model of models) {
    for (const field of model.fields) {
      const baseType = field.type.replace('[]', '')
      if (SCALAR_TYPES.has(baseType) || !modelNames.has(baseType)) continue

      const targetModel = baseType
      const isList = field.isArray || field.type.endsWith('[]')
      const relationAttr = field.attributes.find((a) => a.name === '@relation')
      const args = relationAttr?.args ?? {}

      const relationName = extractRelationName(args, field.name)
      const fkFields = asStringArray(args['fields'])
      const pkFields = asStringArray(args['references'])
      const onDelete = args['onDelete'] !== undefined ? stripQuotes(String(args['onDelete'])) : undefined

      if (fkFields.length > 0) {
        const fkFieldDef = model.fields.find((f) => f.name === fkFields[0])
        const uniqueFk = fkFieldDef?.attributes.some((a) => a.name === '@unique') ?? false
        const kind: RelationKind = uniqueFk && !isList ? 'one-to-one' : 'many-to-one'
        result.set(`${model.name}.${field.name}`, {
          field: field.name,
          targetModel,
          isList,
          kind,
          fkModel: model.name,
          fkFields,
          pkModel: targetModel,
          pkFields: pkFields.length > 0 ? pkFields : ['id'],
          onDelete,
          relationName,
          backField: findBackField(byName.get(targetModel), model.name, relationName, field.name),
          isFkHolder: true,
        })
      } else {
        result.set(`${model.name}.${field.name}`, {
          field: field.name,
          targetModel,
          isList,
          kind: 'one-to-many',
          fkModel: targetModel,
          fkFields: [],
          pkModel: model.name,
          pkFields: [],
          onDelete,
          relationName,
          backField: findBackField(byName.get(targetModel), model.name, relationName, field.name),
          isFkHolder: false,
        })
      }
    }
  }

  linkBackReferences(result)
  detectImplicitManyToMany(result)

  return result
}

function extractRelationName(args: Record<string, any>, fieldName: string): string | undefined {
  for (const [key, value] of Object.entries(args)) {
    if (value === true && key !== fieldName) {
      return stripQuotes(key)
    }
  }
  return undefined
}

function findBackField(
  targetModel: ModelBlock | undefined,
  sourceModel: string,
  relationName: string | undefined,
  sourceField: string
): string | undefined {
  if (!targetModel) return undefined
  const candidates = targetModel.fields.filter((f) => f.type.replace('[]', '') === sourceModel)
  if (candidates.length === 0) return undefined
  if (relationName) {
    const named = candidates.find((f) =>
      f.attributes.some((a) =>
        a.name === '@relation' &&
        Object.entries(a.args).some(([k, v]) => v === true && stripQuotes(k) === relationName)
      )
    )
    if (named) return named.name
  }
  const unnamed = candidates.find((f) => {
    const rel = f.attributes.find((a) => a.name === '@relation')
    if (!rel) return true
    return !Object.entries(rel.args).some(([k, v]) => v === true && k !== f.name)
  })
  return (unnamed ?? candidates[0]).name
}

function linkBackReferences(
  relations: Map<string, RelationFieldInfo>
): void {
  for (const info of relations.values()) {
    if (info.kind !== 'one-to-many' || info.fkFields.length > 0) continue
    const fkSide = [...relations.values()].find(
      (r) =>
        r.fkModel === info.targetModel &&
        r.targetModel === info.pkModel &&
        r.fkFields.length > 0 &&
        (info.relationName === undefined || r.relationName === info.relationName)
    )
    if (fkSide) {
      info.fkFields = fkSide.fkFields
      info.pkFields = fkSide.pkFields
      info.onDelete = info.onDelete ?? fkSide.onDelete
      if (fkSide.kind === 'one-to-one') info.kind = 'one-to-one'
    }
  }
}

function detectImplicitManyToMany(
  relations: Map<string, RelationFieldInfo>
): void {
  for (const info of relations.values()) {
    if (!info.isList || info.kind !== 'one-to-many') continue
    const counterpart = info.backField
      ? relations.get(`${info.targetModel}.${info.backField}`)
      : undefined
    if (counterpart && counterpart.isList && counterpart.kind === 'one-to-many') {
      const joinTable = implicitJoinTable(info.pkModel, info.targetModel)
      info.kind = 'many-to-many-implicit'
      info.joinTable = joinTable
      counterpart.kind = 'many-to-many-implicit'
      counterpart.joinTable = joinTable
    }
  }
}

export function implicitJoinTable(a: string, b: string): string {
  const [first, second] = [a, b].sort()
  return `_${first}To${second}`
}

export function isScalarType(type: string, enumNames: Set<string> = new Set()): boolean {
  const base = type.replace('[]', '')
  return SCALAR_TYPES.has(base) || enumNames.has(base)
}
