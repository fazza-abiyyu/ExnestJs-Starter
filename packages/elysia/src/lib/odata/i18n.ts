import type { TranslateFn } from './types.js'

export class ODataI18n {
  private readonly _translations: Record<string, Record<string, string>> = {}

  register(lang: string, translations: Record<string, string>): this {
    this._translations[lang] = {
      ...this._translations[lang],
      ...translations,
    }
    return this
  }

  getTranslator(): TranslateFn {
    return (key: string, lang?: string, args?: unknown): string => {
      const defaultMessage = (args as { defaultMessage?: string })?.defaultMessage || ''

      if (!lang) {
        return defaultMessage
      }

      const langDict = this._translations[lang]
      if (!langDict) {
        return defaultMessage
      }

      return langDict[key] || defaultMessage
    }
  }
}

export const odataI18n = new ODataI18n()