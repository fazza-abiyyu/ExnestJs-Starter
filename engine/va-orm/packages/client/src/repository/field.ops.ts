// VA-ORM Field Update Operations
//
// Prisma-style atomic field operations: increment, decrement, set.
//
// Detection is `instanceof FieldOp`, never shape/duck-typing — a plain
// object from an HTTP body (`{"set":"admin"}`) can never be an instance.
// That closes mass-assignment via atomic ops when apps pass untrusted
// input into update(). Prefer the fieldOps helpers.

import type { QuoteFn } from '../relation/quote.js';
import { ansiQuote } from '../relation/quote.js';

export interface FieldOperation {
  increment?: number;
  decrement?: number;
  set?: any;
}

/**
 * Library-constructed field op. Only instances are treated as atomic ops.
 * JSON.parse / Object.assign from user input cannot produce an instance.
 */
export class FieldOp {
  private readonly __vaFieldOp = true as const;

  constructor(
    readonly increment?: number,
    readonly decrement?: number,
    readonly set?: any,
  ) {}
}

export function isFieldOp(value: unknown): value is FieldOp {
  return value instanceof FieldOp;
}

/** Legacy shape check for hand-built objects that are already trusted. */
export function isTrustedFieldOperationShape(value: any): value is FieldOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  if (!keys.every((k) => k === 'increment' || k === 'decrement' || k === 'set')) return false;
  if (value.increment !== undefined && !Number.isFinite(value.increment)) return false;
  if (value.decrement !== undefined && !Number.isFinite(value.decrement)) return false;
  return value.increment !== undefined || value.decrement !== undefined || value.set !== undefined;
}

/**
 * True only for branded {@link FieldOp} instances.
 * Plain JSON objects — even perfect-looking `{ set: "x" }` — are NOT ops.
 */
export function isFieldOperation(value: any): value is FieldOp {
  return isFieldOp(value);
}

/** Explicit builders — the only safe way to create atomic field ops. */
export const fieldOps = {
  increment(amount: number): FieldOp {
    return new FieldOp(amount, undefined, undefined);
  },
  decrement(amount: number): FieldOp {
    return new FieldOp(undefined, amount, undefined);
  },
  set(value: any): FieldOp {
    return new FieldOp(undefined, undefined, value);
  },
};

export function buildSetClause(
  data: Record<string, any>,
  getPlaceholder: (index: number) => string,
  quote: QuoteFn = ansiQuote,
): { setParts: string[]; params: any[]; nextIndex: number } {
  const setParts: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  for (const [column, value] of Object.entries(data)) {
    // VA-ORM DDL is unquoted → DB folds identifiers to lowercase.
    // Lowercase here so UPDATE matches the folded column names
    // (e.g. updatedAt → "updatedat"), consistent with SELECT/INSERT.
    const col = quote(column.toLowerCase());
    if (isFieldOp(value)) {
      if (value.set !== undefined) {
        setParts.push(`${col} = ${getPlaceholder(paramIndex++)}`);
        params.push(value.set);
      }
      if (value.increment !== undefined) {
        setParts.push(`${col} = ${col} + ${getPlaceholder(paramIndex++)}`);
        params.push(value.increment);
      }
      if (value.decrement !== undefined) {
        setParts.push(`${col} = ${col} - ${getPlaceholder(paramIndex++)}`);
        params.push(value.decrement);
      }
    } else {
      setParts.push(`${col} = ${getPlaceholder(paramIndex++)}`);
      params.push(value);
    }
  }

  return { setParts, params, nextIndex: paramIndex };
}
