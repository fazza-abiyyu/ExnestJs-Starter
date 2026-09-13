// VA-ORM Code Writer
//
// Minimal indentation-aware emitter so generated TypeScript already
// follows Exnest style (single quotes, semicolons, trailing commas,
// 2-space indent, max ~100 cols) without requiring prettier.

export class CodeWriter {
  private lines: string[] = []
  protected indentLevel = 0

  line(code = ''): this {
    if (code === '') {
      this.lines.push('')
    } else {
      this.lines.push(`${'  '.repeat(this.indentLevel)}${code}`)
    }
    return this
  }

  block(header: string, fn: () => void, footer = '}'): this {
    const start = this.lines.length
    this.line(header)
    this.indentLevel++
    fn()
    this.indentLevel--
    if (this.lines.length === start + 1 && header.trimEnd().endsWith('{')) {
      this.lines[start] = `${'  '.repeat(this.indentLevel)}${header.trimEnd().slice(0, -1).trimEnd()} {};`
    } else {
      this.line(footer)
    }
    return this
  }

  method(name: string, params: string, returnType: string, fn: () => void): this {
    const singleLine = `${name}(${params}): ${returnType} {`
    if (singleLine.length + this.indentLevel * 2 <= 100) {
      return this.block(singleLine, fn)
    }
    const match = /^([^:]+?:\s*)\{([\s\S]*)\}$/.exec(params.trim())
    if (!match) {
      return this.block(singleLine, fn)
    }
    this.line(`${name}(${match[1].trim()} {`)
    this.indentLevel++
    for (const member of splitTopLevel(match[2], ';')) {
      const trimmed = member.trim()
      if (trimmed) this.line(`${trimmed};`)
    }
    this.indentLevel--
    this.block(`}): ${returnType} {`, fn)
    return this
  }

  toString(): string {
    return this.lines.join('\n')
  }
}

function splitProp(member: string): [string, string] | null {
  const match = /^([^:]+?)(\?)?:\s*([\s\S]*)$/.exec(member.trim())
  if (!match) return null
  return [match[1].trim(), match[3].trim()]
}

export function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (quote) {
      current += char
      if (char === quote && input[i - 1] !== '\\') quote = null
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === '{' || char === '[' || char === '(') depth++
    if (char === '}' || char === ']' || char === ')') depth--
    if (char === separator && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim() !== '') parts.push(current)
  return parts
}

function splitUnion(type: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  let i = 0
  while (i < type.length) {
    const char = type[i]
    if (quote) {
      current += char
      if (char === quote && type[i - 1] !== '\\') quote = null
      i++
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      i++
      continue
    }
    if (char === '{' || char === '[' || char === '(') depth++
    if (char === '}' || char === ']' || char === ')') depth--
    if (char === '|' && depth === 0) {
      parts.push(current.trim())
      current = ''
      i++
      continue
    }
    current += char
    i++
  }
  if (current.trim() !== '') parts.push(current.trim())
  return parts
}

export class TypeWriter extends CodeWriter {
  prop(name: string, type: string, indent = ''): void {
    const singleLine = `${indent}${name}?: ${type};`
    if (singleLine.length + this.indentLevel * 2 <= 100) {
      this.line(`${indent}${name}?: ${type};`)
      return
    }
    const members = splitUnion(type)
    if (members.length > 1) {
      const filled = members.join(' | ')
      const continuation = `${indent}  ${filled};`
      if (continuation.length + this.indentLevel * 2 <= 100) {
        this.line(`${indent}${name}?:`)
        this.line(`${indent}  ${filled};`)
        return
      }
      this.line(`${indent}${name}?:`)
      for (let i = 0; i < members.length; i++) {
        this.propUnionMember(members[i], indent, i === members.length - 1)
      }
      return
    }
    if (type.startsWith('{') && type.endsWith('}')) {
      this.line(`${indent}${name}?: {`)
      for (const member of splitTopLevel(type.slice(1, -1), ';')) {
        const parsed = splitProp(member)
        if (!parsed) continue
        this.prop(parsed[0], parsed[1], `${indent}  `)
      }
      this.line(`${indent}};`)
      return
    }
    this.line(`${indent}${name}?: ${type};`)
  }

  private propUnionMember(member: string, indent: string, isLast: boolean): void {
    const singleLine = `${indent}  | ${member}`
    if (singleLine.length + this.indentLevel * 2 <= 100) {
      this.line(`${indent}  | ${member}${isLast ? ';' : ''}`)
      return
    }
    if (member.startsWith('{') && member.endsWith('}')) {
      this.line(`${indent}  | {`)
      for (const sub of splitTopLevel(member.slice(1, -1), ';')) {
        const parsed = splitProp(sub)
        if (!parsed) continue
        this.prop(parsed[0], parsed[1], `${indent}      `)
      }
      this.line(`${indent}    }${isLast ? ';' : ''}`)
      return
    }
    const parts = splitUnion(member)
    if (parts.length > 1) {
      for (let i = 0; i < parts.length; i++) {
        this.propUnionMember(parts[i], `${indent}  `, isLast && i === parts.length - 1)
      }
      return
    }
    const arrayMatch = /^Array<\{([\s\S]*)\}>$/.exec(member)
    if (arrayMatch) {
      const base = `${indent}  `
      this.line(`${base}| Array<{`)
      for (const sub of splitTopLevel(arrayMatch[1], ';')) {
        const parsed = splitProp(sub)
        if (!parsed) continue
        this.prop(parsed[0], parsed[1], `${base}    `)
      }
      this.line(`${base}  }>;`)
      return
    }
    this.line(`${indent}  | ${member}${isLast ? ';' : ''}`)
  }
}

function isValidIdentifier(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
}

function quoteString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function toJsLiteral(value: any, indentLevel = 0): string {
  const pad = '  '.repeat(indentLevel)
  const innerPad = '  '.repeat(indentLevel + 1)

  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return quoteString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return fillScalarArray(value, innerPad, pad)
    }
    const items = value.map((item) => {
      const single = toJsLiteralSingle(item)
      const oneLine = `${innerPad}${single},`
      if (single !== null && oneLine.length <= 100) return oneLine
      return `${innerPad}${toJsLiteral(item, indentLevel + 1)},`
    })
    return `[\n${items.join('\n')}\n${pad}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const items = entries.map(([key, itemValue]) => {
      const renderedKey = isValidIdentifier(key) ? key : quoteString(key)
      const single = toJsLiteralSingle(itemValue)
      const oneLine = `${innerPad}${renderedKey}: ${single},`
      if (single !== null && oneLine.length <= 100) return oneLine
      return `${innerPad}${renderedKey}: ${toJsLiteral(itemValue, indentLevel + 1)},`
    })
    return `{\n${items.join('\n')}\n${pad}}`
  }

  return quoteString(String(value))
}

function fillScalarArray(value: any[], innerPad: string, pad: string): string {
  const singles = value.map((item) => toJsLiteralSingle(item) ?? 'null')
  const flat = `[${singles.join(', ')}]`
  if (innerPad.length + flat.length + 1 <= 100) return flat
  const lines: string[] = []
  let current = innerPad
  for (const single of singles) {
    const candidate = current === innerPad ? `${current}${single}` : `${current} ${single}`
    if (`${candidate},`.length > 100 && current !== innerPad) {
      lines.push(`${current},`)
      current = `${innerPad}${single}`
    } else {
      current = candidate
    }
  }
  lines.push(`${current},`)
  return `[\n${lines.join('\n')}\n${pad}]`
}

function toJsLiteralSingle(value: any): string | null {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return quoteString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    if (
      value.length > 1 &&
      value.some(
        (item) =>
          typeof item === 'object' && item !== null && !Array.isArray(item) && Object.keys(item).length > 1
      )
    ) {
      return null
    }
    const items: string[] = []
    for (const item of value) {
      const rendered = toJsLiteralSingle(item)
      if (rendered === null) return null
      items.push(rendered)
    }
    return `[${items.join(', ')}]`
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const items: string[] = []
    for (const [key, itemValue] of entries) {
      const rendered = toJsLiteralSingle(itemValue)
      if (rendered === null) return null
      const renderedKey = isValidIdentifier(key) ? key : quoteString(key)
      items.push(`${renderedKey}: ${rendered}`)
    }
    return `{ ${items.join(', ')} }`
  }
  return null
}
