// VA-ORM Client Generator
//
// Generates a typed VaClient subclass with per-model delegates.
// The schema AST is embedded so the runtime relation registry
// works without importing @exnest/va-schema.
// Output follows Exnest style (single quotes, semicolons, trailing commas).

import type { SchemaAST, ModelBlock } from '../../../schema/src/schema.types.js'
import { CodeWriter, toJsLiteral } from './code.writer.js'

export class ClientGenerator {
  private w = new CodeWriter()

  generate(ast: SchemaAST): string {
    this.w = new CodeWriter()

    this.w.line(`import { VaClient } from '@exnest/va-client';`)
    this.w.line(`import { ModelDelegate } from '@exnest/va-client';`)
    this.w.line(`import type { SchemaAST } from '@exnest/va-schema';`)
    this.w.line(`import type {`)
    for (const model of ast.model) {
      this.w.line(`  ${model.name},`)
      this.w.line(`  ${model.name}WhereInput,`)
      this.w.line(`  ${model.name}Select,`)
      this.w.line(`  ${model.name}Include,`)
      this.w.line(`  ${model.name}UniqueWhere,`)
      this.w.line(`  ${model.name}CreateInput,`)
      this.w.line(`  ${model.name}UpdateInput,`)
    }
    this.w.line(`} from './types';`)
    this.w.line()
    this.w.line(`export interface VaClientConfig {`)
    this.w.line(`  connectionString: string;`)
    this.w.line(`  pooling?: boolean;`)
    this.w.line(`}`)
    this.w.line()

    this.w.line(`const schema: SchemaAST = ${toJsLiteral(ast)};`)
    this.w.line()

    for (const model of ast.model) {
      this.generateDelegate(model)
      this.w.line()
    }

    this.w.block(`export class VaClientGenerated extends VaClient {`, () => {
      this.w.block(`constructor(config: VaClientConfig) {`, () => {
        this.w.block(`super({`, () => {
          this.w.line(`driver: 'postgres',`)
          this.w.line(`dsn: config.connectionString,`)
          this.w.line(`pooling: config.pooling ?? true,`)
          this.w.line(`schema,`)
        }, `});`)
      })
      this.w.line()
      ast.model.forEach((model, index) => {
        const accessor = this.toCamelCase(model.name)
        const call = `return this.delegate('${model.name}', ${model.name}Delegate);`
        this.w.block(`get ${accessor}(): ${model.name}Delegate {`, () => {
          if (call.length + 4 <= 100) {
            this.w.line(call)
          } else {
            this.w.line(`return this.delegate(`)
            this.w.line(`  '${model.name}',`)
            this.w.line(`  ${model.name}Delegate,`)
            this.w.line(`);`)
          }
        })
        if (index < ast.model.length - 1) this.w.line()
      })
    })

    return `${this.w.toString().replace(/\n+$/, '')}\n`
  }

  private generateDelegate(model: ModelBlock): void {
    const d = `${model.name}Delegate`
    const t = model.name
    const findArgs = `args?: { where?: ${t}WhereInput; orderBy?: Record<string, 'asc' | 'desc'>; take?: number; skip?: number; select?: ${t}Select; include?: ${t}Include }`
    const uniqueArgs = `args: { where: ${t}WhereInput; select?: ${t}Select; include?: ${t}Include }`
    const aggArgs = `args?: { where?: ${t}WhereInput; _count?: boolean | { _all?: boolean } | string[]; _sum?: string[]; _avg?: string[]; _min?: string[]; _max?: string[] }`
    const groupArgs = `args: { by: string[]; where?: ${t}WhereInput; _count?: boolean | { _all?: boolean } | string[]; _sum?: string[]; _avg?: string[]; _min?: string[]; _max?: string[]; having?: Record<string, any>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number; skip?: number }`
    const createArgs = `args: { data: ${t}CreateInput; include?: ${t}Include }`
    const updateArgs = `args: { where: ${t}UniqueWhere; data: ${t}UpdateInput; include?: ${t}Include }`

    this.w.block(`export class ${d} extends ModelDelegate<${t}> {`, () => {
      this.w.method('findMany', findArgs, `Promise<${t}[]>`, () => {
        this.w.line(`return super.findMany(args ?? {});`)
      })
      this.w.method('findUnique', uniqueArgs, `Promise<${t} | null>`, () => {
        this.w.line(`return super.findUnique(args);`)
      })
      this.w.method('findFirst', findArgs, `Promise<${t} | null>`, () => {
        this.w.line(`return super.findFirst(args ?? {});`)
      })
      this.w.method('count', `where?: ${t}WhereInput`, 'Promise<number>', () => {
        this.w.line(`return super.count(where);`)
      })
      this.w.method('aggregate', aggArgs, 'Promise<Record<string, any>>', () => {
        this.w.line(`return super.aggregate(args);`)
      })
      this.w.method('groupBy', groupArgs, 'Promise<Record<string, any>[]>', () => {
        this.w.line(`return super.groupBy(args);`)
      })
      this.w.method('create', createArgs, `Promise<${t}>`, () => {
        this.w.line(`return super.create(args) as Promise<${t}>;`)
      })
      this.w.method('update', updateArgs, `Promise<${t}[]>`, () => {
        this.w.line(`return super.update(args as any) as Promise<${t}[]>;`)
      })
    })
  }

  private toCamelCase(str: string): string {
    return str.charAt(0).toLowerCase() + str.slice(1)
  }
}
