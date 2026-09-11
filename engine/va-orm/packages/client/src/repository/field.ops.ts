// VA-ORM Field Update Operations
//
// Prisma-style atomic field operations: increment, decrement, set.

import type { QuoteFn } from '../relation/quote.js'
import { ansiQuote } from '../relation/quote.js'

export interface FieldOperation {
  increment?: number
  decrement?: number
  set?: any
}

export function isFieldOperation(value: any): value is FieldOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return 'increment' in value || 'decrement' in value || 'set' in value
}

export function buildSetClause(
  data: Record<string, any>,
  getPlaceholder: (index: number) => string,
  quote: QuoteFn = ansiQuote
): { setParts: string[]; params: any[]; nextIndex: number } {
  const setParts: string[] = []
  const params: any[] = []
  let paramIndex = 1

  for (const [column, value] of Object.entries(data)) {
    // VA-ORM DDL is unquoted → DB folds identifiers to lowercase.
    // Lowercase here so UPDATE matches the folded column names
    // (e.g. updatedAt → "updatedat"), consistent with SELECT/INSERT.
    const col = quote(column.toLowerCase())
    if (isFieldOperation(value)) {
      if (value.set !== undefined) {
        setParts.push(`${col} = ${getPlaceholder(paramIndex++)}`)
        params.push(value.set)
      }
      if (value.increment !== undefined) {
        setParts.push(`${col} = ${col} + ${getPlaceholder(paramIndex++)}`)
        params.push(value.increment)
      }
      if (value.decrement !== undefined) {
        setParts.push(`${col} = ${col} - ${getPlaceholder(paramIndex++)}`)
        params.push(value.decrement)
      }
    } else {
      setParts.push(`${col} = ${getPlaceholder(paramIndex++)}`)
      params.push(value)
    }
  }

  return { setParts, params, nextIndex: paramIndex }
}
