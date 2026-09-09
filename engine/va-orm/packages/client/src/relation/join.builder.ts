// VA-ORM Join Builder
//
// Builds JOIN clauses and join conditions for relation hops.
// One hop = one relation field from a parent model to a target model.

import type { JoinType, RelationMeta } from '../core/types.js'
import { ansiQuote } from './quote.js'
import type { QuoteFn } from './quote.js'

export interface JoinSpec {
  meta: RelationMeta
  parentTable: string
  parentAlias: string
  parentModel: string
  childTable: string
  childAlias: string
  childModel: string
  type?: JoinType
  quote?: QuoteFn
}

export class JoinBuilder {
  static joinCondition(
    meta: RelationMeta,
    parentAlias: string,
    childAlias: string,
    quote: QuoteFn = ansiQuote
  ): string {
    const parts: string[] = []
    if (meta.kind === 'many-to-one' || (meta.kind === 'one-to-one' && meta.isFkHolder)) {
      for (let i = 0; i < meta.fkFields.length; i++) {
        parts.push(`${quote(`${parentAlias}.${meta.fkFields[i]}`)} = ${quote(`${childAlias}.${meta.pkFields[i] ?? meta.pkFields[0]}`)}`)
      }
    } else {
      for (let i = 0; i < meta.fkFields.length; i++) {
        parts.push(`${quote(`${childAlias}.${meta.fkFields[i]}`)} = ${quote(`${parentAlias}.${meta.pkFields[i] ?? meta.pkFields[0]}`)}`)
      }
    }
    return parts.join(' AND ')
  }

  static joinClause(spec: JoinSpec): string[] {
    const { meta, parentAlias, childTable, childAlias, parentModel, childModel } = spec
    const joinKeyword = `${(spec.type ?? 'left').toUpperCase()} JOIN`
    const quote = spec.quote ?? ansiQuote

    if (meta.kind === 'many-to-many-implicit' && meta.joinTable) {
      const jt = meta.joinTable
      const parentIsA = parentModel < childModel
      const parentCol = parentIsA ? 'A' : 'B'
      const childCol = parentIsA ? 'B' : 'A'
      return [
        `${joinKeyword} ${quote(jt)} AS ${jt}__j ON ${quote(`${jt}__j.${parentCol}`)} = ${quote(`${parentAlias}.${meta.pkFields[0] ?? 'id'}`)}`,
        `${joinKeyword} ${quote(childTable)} AS ${childAlias} ON ${quote(`${childAlias}.${meta.pkFields[0] ?? 'id'}`)} = ${quote(`${jt}__j.${childCol}`)}`,
      ]
    }

    return [`${joinKeyword} ${quote(childTable)} AS ${childAlias} ON ${this.joinCondition(meta, parentAlias, childAlias, quote)}`]
  }

  static manyToManyJoinClauses(
    joinTable: string,
    parentModel: string,
    parentPk: string,
    parentAlias: string,
    childModel: string,
    childPk: string,
    childTable: string,
    childAlias: string,
    type: JoinType = 'left',
    quote: QuoteFn = ansiQuote
  ): string[] {
    const joinKeyword = `${type.toUpperCase()} JOIN`
    const parentIsA = parentModel < childModel
    const parentCol = parentIsA ? 'A' : 'B'
    const childCol = parentIsA ? 'B' : 'A'
    return [
      `${joinKeyword} ${quote(joinTable)} AS ${joinTable}__j ON ${quote(`${joinTable}__j.${parentCol}`)} = ${quote(`${parentAlias}.${parentPk}`)}`,
      `${joinKeyword} ${quote(childTable)} AS ${childAlias} ON ${quote(`${childAlias}.${childPk}`)} = ${quote(`${joinTable}__j.${childCol}`)}`,
    ]
  }
}
