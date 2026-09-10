// VA-ORM Client Extensions

import type { DatabaseDriver, ModelMeta } from './types.js'
import type { VaClient } from './va.client.js'
import type { QuoteFn } from '../relation/quote.js'

export interface ExtensionQueryParams {
  model: string
  action: string
  args: Record<string, any>
}

export interface ExtensionQueryHook {
  (params: ExtensionQueryParams, query: (args: Record<string, any>) => Promise<any>): Promise<any>
}

export interface ExtensionConfig {
  query?: {
    [action: string]: ExtensionQueryHook
  }
}

export class ExtendedClient {
  private baseClient: VaClient
  private extension: ExtensionConfig

  constructor(baseClient: VaClient, extension: ExtensionConfig) {
    this.baseClient = baseClient
    this.extension = extension
  }

  async executeWithExtension(
    model: string,
    action: string,
    args: Record<string, any>,
    originalQuery: (args: Record<string, any>) => Promise<any>
  ): Promise<any> {
    const hook = this.extension.query?.[action]
    if (hook) {
      return hook({ model, action, args }, originalQuery)
    }
    return originalQuery(args)
  }

  getBaseClient(): VaClient {
    return this.baseClient
  }
}

export function createExtension(config: ExtensionConfig): ExtensionConfig {
  return config
}

export function composeExtensions(...extensions: ExtensionConfig[]): ExtensionConfig {
  const composed: ExtensionConfig = { query: {} }

  for (const ext of extensions) {
    if (ext.query) {
      for (const [action, hook] of Object.entries(ext.query)) {
        const existing = composed.query?.[action]
        if (existing) {
          composed.query![action] = async (params, query) => {
            return existing(params, (args) => hook(params, () => query(args)))
          }
        } else {
          composed.query![action] = hook
        }
      }
    }
  }

  return composed
}
