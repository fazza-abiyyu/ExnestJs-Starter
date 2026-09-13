// VA-ORM security helpers shared by adapters, filters, migrator.

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.has(key);
}

/** JSON.parse that strips prototype-pollution keys from objects/arrays. */
export function safeJsonParse<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text, function reviver(key, value) {
      if (isDangerousKey(key)) return undefined;
      return value;
    }) as T;
  } catch {
    return undefined;
  }
}

/** Escape LIKE/ILIKE metacharacters in user input (use with ESCAPE '\'). */
export function escapeLike(value: unknown): string {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Split a SQL script into statements without breaking on `;` inside
 * string literals, dollar-quoted bodies, or comments.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      if (end === -1) {
        current += sql.slice(i);
        break;
      }
      current += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    // Block comment
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) {
        current += sql.slice(i);
        break;
      }
      current += sql.slice(i, end + 2);
      i = end + 2;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      current += ch;
      i++;
      while (i < n) {
        current += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            current += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Double-quoted identifier
    if (ch === '"') {
      current += ch;
      i++;
      while (i < n) {
        current += sql[i];
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            current += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Dollar-quoted string ($tag$ ... $tag$)
    if (ch === '$') {
      const tagMatch = /^\$[A-Za-z_]\w*\$|^\$\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end !== -1) {
          current += sql.slice(i, end + tag.length);
          i = end + tag.length;
          continue;
        }
      }
    }

    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  const tail = current.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}
