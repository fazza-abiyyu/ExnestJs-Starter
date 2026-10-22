// Mini in-memory SQL engine.
//
// "Mini Postgres" - subset SQL yang cukup untuk membuktikan ORM bekerja di
// atas transport HTTP tanpa database sungguhan. Mendukung:
//
//   SELECT 1
//   SELECT * | <cols> | COUNT(*) FROM "t" [WHERE ...] [ORDER BY ...] [LIMIT n] [OFFSET n]
//   INSERT INTO "t" ("a","b") VALUES ($1,$2) [RETURNING *]
//   UPDATE "t" SET "a" = $1, ... WHERE ... [RETURNING *]
//   DELETE FROM "t" WHERE ... [RETURNING *]
//
// WHERE mendukung: = != > >= < <=, IS NULL, IS NOT NULL, LIKE, IN (...).
// Operator AND/OR digabung dengan precedence AND > OR.

import type { QueryResult } from "./protocol.js";
import { MiniPgError } from "./protocol.js";

type Row = Record<string, any>;

interface Condition {
  column: string;
  op: string;
  /** Token mentah (mis. `$1`) - diresolve saat evaluasi agar params ikut terbawa. */
  raw?: string;
  /** Token mentah untuk `IN (...)`. */
  rawValues?: string[];
}

interface ConditionGroup {
  conditions: Condition[];
}

export class MemoryDatabase {
  private tables = new Map<string, Row[]>();
  private sequences = new Map<string, number>();

  /** Buang semua data (dipakai antar test). */
  reset(): void {
    this.tables.clear();
    this.sequences.clear();
  }

  table(name: string): Row[] {
    const key = name.toLowerCase();
    if (!this.tables.has(key)) this.tables.set(key, []);
    return this.tables.get(key)!;
  }

  /** Table yang wajib ada — kalau tidak, error seperti PostgreSQL. */
  requireTable(name: string): Row[] {
    const key = name.toLowerCase();
    const rows = this.tables.get(key);
    if (!rows) {
      throw new MiniPgError(`relation "${name}" does not exist`);
    }
    return rows;
  }

  execute(sql: string, params: any[] = []): QueryResult {
    const trimmed = normalizePlaceholders(sql.trim());
    if (trimmed === "") throw new MiniPgError("empty statement");

    if (/^select\s+1\s*$/i.test(trimmed))
      return { rows: [{ "?column?": 1 }], rowCount: 1 };
    if (/^create\s+table/i.test(trimmed)) {
      const match = trimmed.match(
        /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?("?[A-Za-z_][\w.]*"?)/i,
      );
      if (!match)
        throw new MiniPgError(
          `cannot parse CREATE TABLE: ${trimmed.slice(0, 120)}`,
        );
      this.table(unquote(match[2]));
      return { rows: [], rowCount: 0 };
    }

    if (/^truncate/i.test(trimmed)) {
      const match = trimmed.match(
        /^TRUNCATE\s+(TABLE\s+)?("?[A-Za-z_][\w.]*"?)/i,
      );
      if (!match)
        throw new MiniPgError(
          `cannot parse TRUNCATE: ${trimmed.slice(0, 120)}`,
        );
      this.requireTable(unquote(match[2])).length = 0;
      return { rows: [], rowCount: 0 };
    }

    if (/^drop\s+table/i.test(trimmed)) {
      const match = trimmed.match(
        /^DROP\s+TABLE\s+(IF\s+EXISTS\s+)?("?[A-Za-z_][\w.]*"?)/i,
      );
      if (match) this.tables.delete(unquote(match[2]).toLowerCase());
      return { rows: [], rowCount: 0 };
    }

    if (/^insert/i.test(trimmed)) return this.insert(trimmed, params);
    if (/^update/i.test(trimmed)) return this.update(trimmed, params);
    if (/^delete/i.test(trimmed)) return this.remove(trimmed, params);
    if (/^select/i.test(trimmed)) return this.select(trimmed, params);

    throw new MiniPgError(`unsupported statement: ${trimmed.slice(0, 120)}`);
  }
  // ============ SELECT ============

  private select(sql: string, params: any[]): QueryResult {
    const { selectList, table, where, groupBy, orderBy, limit, offset } =
      this.parseSelect(sql, params);

    let rows = this.requireTable(table).map((row) => ({ ...row }));

    if (where) {
      rows = rows.filter((row) => evalConditions(row, where, params));
    }

    // SELECT dengan agregat (COUNT/SUM/AVG/MIN/MAX).
    const items = splitTopLevel(selectList, ",");
    if (items.some((item) => isAggregate(item))) {
      if (groupBy && groupBy.length > 0) {
        const groups = new Map<string, Row[]>();
        for (const row of rows) {
          const key = groupBy
            .map((column) => String(row[column] ?? ""))
            .join("|");
          const list = groups.get(key) ?? [];
          list.push(row);
          groups.set(key, list);
        }
        const out: Row[] = [];
        for (const group of groups.values()) {
          out.push(this.projectAggregate(items, group));
        }
        return { rows: out, rowCount: out.length };
      }
      return { rows: [this.projectAggregate(items, rows)], rowCount: 1 };
    }

    if (orderBy) {
      const { column, direction } = orderBy;
      rows.sort((a, b) => {
        const av = a[column];
        const bv = b[column];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = av < bv ? -1 : 1;
        return direction === "DESC" ? -cmp : cmp;
      });
    }

    if (offset !== undefined) rows = rows.slice(offset);
    if (limit !== undefined) rows = rows.slice(0, limit);

    if (selectList.trim() !== "*") {
      const columns = items
        .map((c) => unquote(c.trim()).toLowerCase())
        .filter(Boolean);
      rows = rows.map((row) => {
        const projected: Row = {};
        for (const column of columns) projected[column] = row[column] ?? null;
        return projected;
      });
    }

    return { rows, rowCount: rows.length };
  }

  /** Hitung agregat + kolom biasa untuk sekelompok baris. */
  private projectAggregate(items: string[], rows: Row[]): Row {
    const out: Row = {};
    for (const item of items) {
      const text = item.trim();
      const aggregate = text.match(
        /^(count|sum|avg|min|max)\s*\(\s*(\*|"?[\w.]+"?)\s*\)(?:\s+as\s+"?([\w]+)"?)?$/i,
      );
      if (aggregate) {
        const alias = aggregate[3] ?? aggregate[1].toLowerCase();
        out[alias] = computeAggregate(aggregate[1], aggregate[2], rows);
        continue;
      }
      const column = unquote(text).toLowerCase();
      out[column] = rows.length > 0 ? (rows[0][column] ?? null) : null;
    }
    return out;
  }

  private parseSelect(
    sql: string,
    _params: any[],
  ): {
    selectList: string;
    table: string;
    where?: ConditionGroup[];
    groupBy?: string[];
    orderBy?: { column: string; direction: "ASC" | "DESC" };
    limit?: number;
    offset?: number;
  } {
    let rest = sql;
    let limit: number | undefined;
    let offset: number | undefined;
    let orderBy: { column: string; direction: "ASC" | "DESC" } | undefined;
    let groupBy: string[] | undefined;

    // Buang dari belakang: FOR UPDATE -> OFFSET -> LIMIT -> ORDER BY -> GROUP BY.
    rest = rest.replace(/\s+FOR\s+UPDATE\s*$/i, "");

    const offsetMatch = rest.match(/\s+OFFSET\s+(\d+)\s*$/i);
    if (offsetMatch) {
      offset = Number(offsetMatch[1]);
      rest = rest.slice(0, offsetMatch.index);
    }
    const limitMatch = rest.match(/\s+LIMIT\s+(\d+)\s*$/i);
    if (limitMatch) {
      limit = Number(limitMatch[1]);
      rest = rest.slice(0, limitMatch.index);
    }
    const orderMatch = rest.match(/\s+ORDER\s+BY\s+(.+)$/i);
    if (orderMatch) {
      const parts = orderMatch[1].trim().split(/\s+/);
      const column = unquote(parts[0]).toLowerCase();
      const direction =
        (parts[1] ?? "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
      orderBy = { column, direction };
      rest = rest.slice(0, orderMatch.index);
    }
    const groupMatch = rest.match(/\s+GROUP\s+BY\s+(.+)$/i);
    if (groupMatch) {
      groupBy = splitTopLevel(groupMatch[1], ",").map((c) =>
        unquote(c.trim()).toLowerCase(),
      );
      rest = rest.slice(0, groupMatch.index);
    }

    const fromMatch = rest.match(
      /^SELECT\s+(DISTINCT\s+)?(.+?)\s+FROM\s+("?[A-Za-z_][\w.]*"?)(?:\s+AS\s+\w+)?\s*(.*)$/i,
    );
    if (!fromMatch)
      throw new MiniPgError(`cannot parse SELECT: ${sql.slice(0, 120)}`);

    const selectList = fromMatch[2];
    const table = unquote(fromMatch[3]);
    let tail = fromMatch[4] ?? "";

    // Pisahkan klausa WHERE dari sisa ekor.
    const whereIndex = tail.search(/\bWHERE\b/i);
    let whereExpr = "";
    if (whereIndex !== -1) {
      whereExpr = tail.slice(whereIndex + "WHERE".length);
      tail = tail.slice(0, whereIndex);
    }

    const where = whereExpr ? parseWhere(whereExpr) : undefined;
    return { selectList, table, where, groupBy, orderBy, limit, offset };
  }

  // ============ INSERT ============

  private insert(sql: string, params: any[]): QueryResult {
    const match = sql.match(
      /^INSERT\s+INTO\s+("?[A-Za-z_][\w.]*"?)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)(?:\s+ON\s+CONFLICT\s*\(([^)]*)\)\s+DO\s+UPDATE\s+SET\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i,
    );
    if (!match)
      throw new MiniPgError(`cannot parse INSERT: ${sql.slice(0, 120)}`);

    const table = unquote(match[1]);
    const columns = match[2]
      .split(",")
      .map((c) => unquote(c.trim()).toLowerCase())
      .filter(Boolean);
    const placeholders = match[3]
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const conflictColumns = match[4]
      ? match[4].split(",").map((c) => unquote(c.trim()).toLowerCase())
      : null;
    const updateSet = match[5];
    const returning = (match[6] ?? "").trim().toUpperCase() === "*";

    if (placeholders.length !== columns.length) {
      throw new MiniPgError(
        `INSERT column/placeholder mismatch: ${columns.length} columns vs ${placeholders.length} values`,
      );
    }

    const row: Row = {};
    columns.forEach((column, index) => {
      row[column] = resolveValue(placeholders[index], params);
    });

    // ON CONFLICT: kalau baris dengan key konflik sudah ada -> update baris itu.
    if (conflictColumns && conflictColumns.length > 0) {
      const rows = this.requireTable(table);
      const existing = rows.find((candidate) =>
        conflictColumns.every((column) => candidate[column] === row[column]),
      );
      if (existing) {
        if (updateSet) {
          for (const piece of splitTopLevel(updateSet, ",")) {
            const assignment = piece.match(
              /^("?[A-Za-z_][\w.]*"?)\s*=\s*(.+)$/,
            );
            if (!assignment)
              throw new MiniPgError(`cannot parse ON CONFLICT SET: ${piece}`);
            const target = unquote(assignment[1]).toLowerCase();
            const source = assignment[2].trim();
            const excluded = source.match(/^EXCLUDED\.("?[A-Za-z_][\w.]*"?)$/i);
            if (excluded) {
              existing[target] = row[unquote(excluded[1]).toLowerCase()];
            } else {
              existing[target] = resolveValue(source, params);
            }
          }
        }
        return { rows: returning ? [{ ...existing }] : [], rowCount: 1 };
      }
    }

    if (row.id === undefined) {
      const next = (this.sequences.get(table.toLowerCase()) ?? 0) + 1;
      this.sequences.set(table.toLowerCase(), next);
      row.id = next;
    }

    this.table(table).push(row);
    return { rows: returning ? [{ ...row }] : [], rowCount: 1 };
  }

  // ============ UPDATE ============

  private update(sql: string, params: any[]): QueryResult {
    const match = sql.match(
      /^UPDATE\s+("?[A-Za-z_][\w.]*"?)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i,
    );
    if (!match)
      throw new MiniPgError(`cannot parse UPDATE: ${sql.slice(0, 120)}`);

    const table = unquote(match[1]);
    const setPart = match[2];
    const wherePart = match[3];
    const returning = (match[4] ?? "").trim().toUpperCase() === "*";

    const assignments: Array<{ column: string; placeholder: string }> = [];
    for (const piece of splitTopLevel(setPart, ",")) {
      const assignment = piece.match(/^("?[A-Za-z_][\w.]*"?)\s*=\s*(.+)$/);
      if (!assignment)
        throw new MiniPgError(`cannot parse SET clause: ${piece}`);
      assignments.push({
        column: unquote(assignment[1]).toLowerCase(),
        placeholder: assignment[2].trim(),
      });
    }

    const where = wherePart ? parseWhere(wherePart) : undefined;
    const rows = this.requireTable(table);
    const updated: Row[] = [];

    for (const row of rows) {
      if (where && !evalConditions(row, where, params)) continue;
      for (const assignment of assignments) {
        row[assignment.column] = resolveValue(assignment.placeholder, params);
      }
      updated.push({ ...row });
    }

    return { rows: returning ? updated : [], rowCount: updated.length };
  }

  // ============ DELETE ============

  private remove(sql: string, params: any[]): QueryResult {
    const match = sql.match(
      /^DELETE\s+FROM\s+("?[A-Za-z_][\w.]*"?)(?:\s+WHERE\s+(.+?))?(?:\s+RETURNING\s+(.+))?$/i,
    );
    if (!match)
      throw new MiniPgError(`cannot parse DELETE: ${sql.slice(0, 120)}`);

    const table = unquote(match[1]);
    const wherePart = match[2];
    const returning = (match[3] ?? "").trim().toUpperCase() === "*";

    const where = wherePart ? parseWhere(wherePart) : undefined;
    const rows = this.requireTable(table);
    const removed: Row[] = [];
    const kept: Row[] = [];

    for (const row of rows) {
      if (!where || evalConditions(row, where, params))
        removed.push({ ...row });
      else kept.push(row);
    }

    this.tables.set(table.toLowerCase(), kept);
    return { rows: returning ? removed : [], rowCount: removed.length };
  }
}

// ============ HELPER ============

/**
 * Ganti placeholder posisional `?` menjadi `$1, $2, ...` supaya engine ini
 * cukup punya satu gaya placeholder (numbered).
 */
function normalizePlaceholders(sql: string): string {
  if (!sql.includes("?")) return sql;
  let index = 0;
  let inString = false;
  let out = "";
  for (const ch of sql) {
    if (ch === "'") inString = !inString;
    if (ch === "?" && !inString) {
      out += `$${++index}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function unquote(identifier: string): string {
  return identifier.replace(/^"|"$/g, "").replace(/""/g, '"');
}

/** Apakah item select list berupa agregat (COUNT/SUM/AVG/MIN/MAX ...)? */
function isAggregate(item: string): boolean {
  return /^\s*(count|sum|avg|min|max)\s*\(/i.test(item);
}

/** Hitung nilai agregat untuk sekumpulan baris. */
function computeAggregate(
  fn: string,
  target: string,
  rows: Row[],
): number | null {
  const name = fn.toLowerCase();
  const column = target === "*" ? null : unquote(target).toLowerCase();

  if (name === "count") {
    if (column === null) return rows.length;
    return rows.filter(
      (row) => row[column] !== undefined && row[column] !== null,
    ).length;
  }

  const values = rows
    .map((row) => (column === null ? row : row[column]))
    .filter((value): value is number => typeof value === "number");

  if (values.length === 0) return null;
  switch (name) {
    case "sum":
      return values.reduce((acc, value) => acc + value, 0);
    case "avg":
      return values.reduce((acc, value) => acc + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return null;
  }
}

/** Pecah string pada separator, abaikan yang di dalam kutip/tanda kurung. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }
    if (!inString && depth === 0 && ch === separator) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/** Parse WHERE - groups OR (tiap grup = AND dari beberapa kondisi). */
function parseWhere(expr: string): ConditionGroup[] {
  const groups: ConditionGroup[] = [];

  // split OR dulu (precedence lebih rendah), lalu AND di dalam tiap bagian
  const orParts = splitKeyword(expr, "OR");
  for (const orPart of orParts) {
    const andParts = splitKeyword(orPart, "AND");
    const conditions: Condition[] = andParts.map((part) =>
      parseCondition(part),
    );
    groups.push({ conditions });
  }
  return groups;
}

/** Split pada keyword di luar kutip/tanda kurung. */
function splitKeyword(input: string, keyword: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  const upper = input.toUpperCase();
  const kw = keyword.toUpperCase();

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "'") inString = !inString;
    if (!inString) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
    }

    if (
      !inString &&
      depth === 0 &&
      upper.startsWith(kw, i) &&
      (i === 0 || /\s/.test(input[i - 1])) &&
      (i + kw.length >= input.length || /\s/.test(input[i + kw.length]))
    ) {
      parts.push(current.trim());
      current = "";
      i += kw.length - 1;
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

function parseCondition(text: string): Condition {
  const trimmed = text.trim();

  const isNull = trimmed.match(/^("?[A-Za-z_][\w.]*"?)\s+IS\s+(NOT\s+)?NULL$/i);
  if (isNull) {
    return {
      column: unquote(isNull[1]).toLowerCase(),
      op: isNull[2] ? "IS NOT NULL" : "IS NULL",
    };
  }

  const inList = trimmed.match(/^("?[A-Za-z_][\w.]*"?)\s+IN\s*\((.*)\)$/i);
  if (inList) {
    return {
      column: unquote(inList[1]).toLowerCase(),
      op: "IN",
      rawValues: splitTopLevel(inList[2], ","),
    };
  }

  const comparison = trimmed.match(
    /^("?[A-Za-z_][\w.]*"?)\s*(=|!=|<>|>=|<=|>|<|LIKE|ILIKE)\s*(.+)$/i,
  );
  if (!comparison) throw new MiniPgError(`cannot parse condition: ${trimmed}`);

  const op = comparison[2].toUpperCase();
  return {
    column: unquote(comparison[1]).toLowerCase(),
    op: op === "<>" ? "!=" : op,
    raw: comparison[3].trim(),
  };
}

function resolveValue(token: string, params: any[]): any {
  const trimmed = token.trim();
  if (/^\$\d+$/.test(trimmed)) {
    const index = Number(trimmed.slice(1)) - 1;
    return params[index];
  }
  if (/^'.*'$/s.test(trimmed)) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^null$/i.test(trimmed)) return null;
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  return trimmed;
}

function evalConditions(
  row: Row,
  groups: ConditionGroup[],
  params: any[],
): boolean {
  // groups: OR antar grup, AND di dalam grup
  return groups.some((group) =>
    group.conditions.every((condition) =>
      evalCondition(row, condition, params),
    ),
  );
}

function evalCondition(row: Row, condition: Condition, params: any[]): boolean {
  const actual = row[condition.column];
  const expected =
    condition.raw !== undefined
      ? resolveValue(condition.raw, params)
      : undefined;

  switch (condition.op) {
    case "IS NULL":
      return actual === null || actual === undefined;
    case "IS NOT NULL":
      return actual !== null && actual !== undefined;
    case "IN": {
      const values = (condition.rawValues ?? []).map((raw) =>
        resolveValue(raw, params),
      );
      return values.some((value) => value === actual);
    }
    case "=":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
      return actual !== null && actual !== undefined && actual > expected;
    case ">=":
      return actual !== null && actual !== undefined && actual >= expected;
    case "<":
      return actual !== null && actual !== undefined && actual < expected;
    case "<=":
      return actual !== null && actual !== undefined && actual <= expected;
    case "LIKE":
    case "ILIKE": {
      if (typeof actual !== "string" || typeof expected !== "string")
        return false;
      const pattern = new RegExp(
        `^${expected
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/%/g, ".*")
          .replace(/_/g, ".")}$`,
        condition.op === "ILIKE" ? "i" : "",
      );
      return pattern.test(actual);
    }
    default:
      return false;
  }
}
