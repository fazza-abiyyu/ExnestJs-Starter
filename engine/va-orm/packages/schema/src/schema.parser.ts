// VA-ORM Schema Parser

import type {
  SchemaAST,
  GeneratorBlock,
  DatasourceBlock,
  ModelBlock,
  FieldDefinition,
  FieldAttribute,
  ModelAttribute,
  EnumBlock,
  EnumValue,
  ViewBlock,
} from './schema.types.js'

export class SchemaParser {
  private tokens: string[] = []
  private position = 0
  private current: string = ''

  parse(schema: string): SchemaAST {
    this.tokenize(schema)
    this.position = 0
    this.current = this.tokens[0] ?? ''

    const ast: SchemaAST = {
      generator: [],
      datasource: [],
      model: [],
      enum: [],
      view: [],
    }

    while (this.position < this.tokens.length) {
      const token = this.current

      if (token === 'generator') {
        ast.generator.push(this.parseGenerator())
      } else if (token === 'datasource') {
        ast.datasource.push(this.parseDatasource())
      } else if (token === 'model') {
        ast.model.push(this.parseModel())
      } else if (token === 'enum') {
        ast.enum.push(this.parseEnum())
      } else if (token === 'view') {
        ast.view!.push(this.parseView())
      } else {
        this.advance()
      }
    }

    return ast
  }

  private tokenize(schema: string): void {
    // Remove comments
    const cleaned = schema
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()

    const tokens: string[] = []
    let i = 0

    while (i < cleaned.length) {
      // Skip whitespace
      if (/\s/.test(cleaned[i])) {
        i++
        continue
      }

      // Special characters (but not @ which is part of identifiers)
      if ('{}()[]=:,;|&<>!?.'.includes(cleaned[i])) {
        tokens.push(cleaned[i])
        i++
        continue
      }

      // Strings
      if (cleaned[i] === '"') {
        let str = ''
        i++ // skip opening quote
        while (i < cleaned.length && cleaned[i] !== '"') {
          str += cleaned[i]
          i++
        }
        i++ // skip closing quote
        tokens.push(`"${str}"`)
        continue
      }

      // Numbers
      if (/\d/.test(cleaned[i])) {
        let num = ''
        while (i < cleaned.length && /[\d.]/.test(cleaned[i])) {
          num += cleaned[i]
          i++
        }
        tokens.push(num)
        continue
      }

      // Identifiers, keywords, and @attributes
      if (/[a-zA-Z_@]/.test(cleaned[i])) {
        let ident = ''
        while (i < cleaned.length && /[a-zA-Z0-9_@]/.test(cleaned[i])) {
          ident += cleaned[i]
          i++
        }
        tokens.push(ident)
        continue
      }

      // Skip unknown characters
      i++
    }

    this.tokens = tokens
  }

  private advance(): string {
    this.current = this.tokens[++this.position] ?? ''
    return this.current
  }

  private peek(): string {
    return this.tokens[this.position + 1] ?? ''
  }

  /** Token predicates (methods, so strict narrowing can't misfire on the mutable cursor). */
  private eof(): boolean {
    return this.current === ''
  }

  private at(token: string): boolean {
    return this.current === token
  }

  private expect(expected: string): void {
    if (this.current !== expected) {
      throw new Error(`Expected "${expected}", got "${this.current}" at position ${this.position}`)
    }
    this.advance()
  }

  private parseGenerator(): GeneratorBlock {
    this.advance() // skip 'generator'
    const name = this.current
    this.advance()
    this.expect('{')

    const generator: GeneratorBlock = {
      name,
      provider: '',
    }

    while (this.current !== '}') {
      const key = this.current
      this.advance()
      this.expect('=')
      const value = this.parseValue()

      if (key === 'provider') {
        generator.provider = value as string
      } else if (key === 'output') {
        generator.output = value as string
      } else if (key === 'binaryTargets') {
        generator.binaryTargets = value as string[]
      }
    }

    this.advance()
    return generator
  }

  private parseDatasource(): DatasourceBlock {
    this.advance() // skip 'datasource'
    const name = this.current
    this.advance()
    this.expect('{')

    const datasource: DatasourceBlock = {
      name,
      provider: '',
      url: '',
    }

    while (this.current !== '}') {
      const key = this.current
      this.advance()
      this.expect('=')
      const value = this.parseValue()

      if (key === 'provider') {
        datasource.provider = value as string
      } else if (key === 'url') {
        datasource.url = value as string
      }
    }

    this.advance()
    return datasource
  }

  private parseModel(): ModelBlock {
    this.advance() // skip 'model'
    const name = this.current
    this.advance()
    this.expect('{')

    const model: ModelBlock = {
      name,
      fields: [],
      attributes: [],
    }

    while (this.current !== '}') {
      if (this.current.startsWith('@@')) {
        model.attributes.push(this.parseModelAttribute())
      } else if (this.current.startsWith('@')) {
        // Skip inline attribute, it's part of previous field
        this.advance()
      } else {
        model.fields.push(this.parseField())
      }
    }

    this.advance()

    const mapAttr = model.attributes.find((a) => a.name === '@@map')
    if (mapAttr) {
      const mapped = firstPositionalArg(mapAttr.args)
      if (mapped !== undefined) model.tableName = mapped
    }

    if (model.attributes.some((a) => a.name === '@@ignore')) {
      model.isIgnored = true
    }

    return model
  }

  private parseField(): FieldDefinition {
    const name = this.current
    this.advance()

    let type = this.current
    this.advance()

    let isArray = false
    if (this.current === '[' && this.peek() === ']') {
      isArray = true
      this.advance()
      this.advance()
    }

    const isOptional = this.current === '?'
    if (isOptional) {
      this.advance()
    }

    const attributes: FieldAttribute[] = []
    while (this.current.startsWith('@') && !this.current.startsWith('@@')) {
      attributes.push(this.parseFieldAttribute())
    }

    const field: FieldDefinition = {
      name,
      type,
      isArray,
      isOptional,
      attributes,
    }

    const mapAttr = attributes.find((a) => a.name === '@map')
    if (mapAttr) {
      const mapped = firstPositionalArg(mapAttr.args)
      if (mapped !== undefined) field.columnName = mapped
    }

    if (attributes.some((a) => a.name === '@ignore')) {
      field.isIgnored = true
    }

    return field
  }

  private parseFieldAttribute(): FieldAttribute {
    let name: string = this.current
    this.advance()

    // Dotted native type: @db.Text, @db.VarChar(255). Without this the
    // '.' becomes a phantom field in the model loop.
    if (this.current === '.') {
      this.advance()
      name += '.' + this.current
      this.advance()
    }

    const args: Record<string, any> = {}

    if (this.current === '(') {
      this.advance()
      let depth = 1
      while (depth > 0 && !this.eof()) {
        if (this.current === '(') {
          depth++
          this.advance()
        } else if (this.current === ')') {
          depth--
          this.advance()
        } else if (this.current === '=') {
          this.advance()
          const key = Object.keys(args).pop() || 'value'
          args[key] = this.parseValue()
        } else if (this.at(',')) {
          this.advance()
        } else if (this.current === '[') {
          this.advance()
          const list: string[] = Array.isArray(args['fields']) ? args['fields'] : []
          while (this.current !== ']' && this.current !== '') {
            if (this.at(',')) {
              this.advance()
              continue
            }
            list.push(this.current)
            this.advance()
          }
          this.expect(']')
          args['fields'] = list
        } else {
          const value = this.current
          this.advance()
          if (this.current === '=' || this.current === ':') {
            this.advance()
            args[value] = this.parseValue()
          } else {
            args[value] = true
          }
        }
      }
      if (depth > 0) throw new Error(`Unclosed parenthesis in attribute ${name}`)
    }

    return { name, args }
  }

  private parseModelAttribute(): ModelAttribute {
    const name = this.current
    this.advance()

    const args: Record<string, any> = {}

    if (this.current === '(') {
      this.advance()
      let depth = 1
      while (depth > 0 && !this.eof()) {
        if (this.current === '(') {
          depth++
          this.advance()
        } else if (this.current === ')') {
          depth--
          this.advance()
        } else if (this.current === '=') {
          this.advance()
          const key = Object.keys(args).pop() || 'value'
          args[key] = this.parseValue()
        } else if (this.at(',')) {
          this.advance()
        } else if (this.current === '[') {
          this.advance()
          const list: string[] = Array.isArray(args['fields']) ? args['fields'] : []
          while (this.current !== ']' && this.current !== '') {
            if (this.at(',')) {
              this.advance()
              continue
            }
            list.push(this.current)
            this.advance()
          }
          this.expect(']')
          args['fields'] = list
        } else {
          const value = this.current
          this.advance()
          if (this.current === '=') {
            this.advance()
            args[value] = this.parseValue()
          } else {
            args[value] = true
          }
        }
      }
      if (depth > 0) throw new Error(`Unclosed parenthesis in attribute ${name}`)
    }

    return { name, args }
  }

  private parseEnum(): EnumBlock {
    this.advance() // skip 'enum'
    const name = this.current
    this.advance()
    this.expect('{')

    const enumBlock: EnumBlock = {
      name,
      values: [],
    }

    while (this.current !== '}') {
      const value: EnumValue = {
        name: this.current,
      }
      this.advance()

      // Check for attributes
      if (this.current.startsWith('@')) {
        value.attributes = []
        while (this.current.startsWith('@')) {
          value.attributes.push(this.parseFieldAttribute())
        }
      }

      enumBlock.values.push(value)
    }

    this.advance()
    return enumBlock
  }

  private parseView(): ViewBlock {
    this.advance() // skip 'view'
    const name = this.current
    this.advance()
    this.expect('{')

    const view: ViewBlock = {
      name,
      fields: [],
      attributes: [],
    }

    while (this.current !== '}') {
      if (this.current.startsWith('@@')) {
        view.attributes.push(this.parseModelAttribute())
      } else if (this.current.startsWith('@')) {
        this.advance()
      } else if (this.current === 'query') {
        // Parse query block
        this.advance() // skip 'query'
        this.expect('=')
        if (this.current.startsWith('"')) {
          view.query = this.current.slice(1, -1)
          this.advance()
        }
      } else {
        // Parse field
        const fieldName = this.current
        this.advance()
        const fieldType = this.current
        this.advance()

        const isOptional = this.current === '?'
        if (isOptional) this.advance()

        view.fields.push({
          name: fieldName,
          type: fieldType,
          isOptional,
        })
      }
    }

    this.advance()

    const mapAttr = view.attributes.find((a) => a.name === '@@map')
    if (mapAttr) {
      const mapped = firstPositionalArg(mapAttr.args)
      if (mapped !== undefined) view.tableName = mapped
    }

    return view
  }

  private parseValue(): any {
    if (this.current.startsWith('"') && this.current.endsWith('"')) {
      // String with quotes already included from tokenizer
      const value = this.current.slice(1, -1)
      this.advance()
      return value
    }

    if (this.current === '[') {
      // Array
      this.advance()
      const values: any[] = []
      while (!this.at(']')) {
        values.push(this.parseValue())
        if (this.at(',')) {
          this.advance()
        }
      }
      this.advance()
      return values
    }

    if (this.current === 'true') {
      this.advance()
      return true
    }

    if (this.current === 'false') {
      this.advance()
      return false
    }

    if (/^\d+$/.test(this.current)) {
      const value = parseInt(this.current, 10)
      this.advance()
      return value
    }

    if (/^\d+\.\d+$/.test(this.current)) {
      const value = parseFloat(this.current)
      this.advance()
      return value
    }

    // env() or other function calls
    if (this.peek() === '(') {
      const funcName = this.current
      this.advance()
      this.advance() // skip '('
      let argStr = ''
      while (this.current !== ')') {
        argStr += this.current
        this.advance()
        if (this.current === ',' || this.current === ')') break
      }
      this.expect(')')
      return `${funcName}(${argStr})`
    }

    // Identifier
    const value = this.current
    this.advance()
    return value
  }
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
