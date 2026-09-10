// VA-ORM Query Middleware

import type { DatabaseDriver } from '../core/types.js'

export interface MiddlewareParams {
  model: string
  action: string
  args: Record<string, any>
  driver: DatabaseDriver
}

export type NextFunction = (params: MiddlewareParams) => Promise<any>
export type MiddlewareFn = (params: MiddlewareParams, next: NextFunction) => Promise<any>

export class QueryMiddleware {
  private middlewares: MiddlewareFn[] = []

  use(middleware: MiddlewareFn): void {
    this.middlewares.push(middleware)
  }

  remove(middleware: MiddlewareFn): void {
    const index = this.middlewares.indexOf(middleware)
    if (index > -1) {
      this.middlewares.splice(index, 1)
    }
  }

  clear(): void {
    this.middlewares = []
  }

  async execute(
    params: MiddlewareParams,
    handler: (params: MiddlewareParams) => Promise<any>
  ): Promise<any> {
    if (this.middlewares.length === 0) {
      return handler(params)
    }

    let index = 0

    const next: NextFunction = async (currentParams) => {
      if (index >= this.middlewares.length) {
        return handler(currentParams)
      }
      const middleware = this.middlewares[index++]
      return middleware(currentParams, next)
    }

    return next(params)
  }
}
