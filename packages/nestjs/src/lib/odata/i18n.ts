import { TranslateFn } from './types.js';

/**
 * Registry for managing OData translation dictionaries.
 */
export class ODataI18n {
  private readonly _translations: Record<string, Record<string, string>> = {};

  /**
   * Registers a dictionary of key-value translations for a specific language code.
   */
  register(lang: string, translations: Record<string, string>): this {
    this._translations[lang] = {
      ...this._translations[lang],
      ...translations,
    };
    return this;
  }

  /**
   * Returns a translator function configured with the registered translations.
   */
  getTranslator(): TranslateFn {
    return (key: string, lang?: string, args?: unknown): string => {
      const defaultMessage = (args as { defaultMessage?: string })?.defaultMessage || '';

      if (!lang) {
        return defaultMessage;
      }

      const langDict = this._translations[lang];
      if (!langDict) {
        return defaultMessage;
      }

      return langDict[key] || defaultMessage;
    };
  }
}

/**
 * Shared global instance of ODataI18n for simple application setups.
 */
export const odataI18n = new ODataI18n();
