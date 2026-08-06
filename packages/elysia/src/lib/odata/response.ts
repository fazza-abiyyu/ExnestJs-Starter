import type {
  ODataCollectionResponse,
  ODataError,
  ODataErrorDetail,
  ODataErrorResponse,
  ODataMetadata,
  ODataSingleResponse,
  TranslateFn,
} from './types.js'

export class ODataCollectionBuilder<T> {
  constructor(
    private readonly _value: T[],
    private readonly _metadata: ODataMetadata = {},
  ) {}

  context(value: string): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.context': value,
    })
  }

  count(value: number): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.count': value,
    })
  }

  nextLink(value: string): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.nextLink': value,
    })
  }

  deltaLink(value: string): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.deltaLink': value,
    })
  }

  build(): ODataCollectionResponse<T> {
    const response: ODataCollectionResponse<T> = { value: this._value }

    if (this._metadata['@odata.context'] !== undefined) {
      response['@odata.context'] = this._metadata['@odata.context']
    }
    if (this._metadata['@odata.count'] !== undefined) {
      response['@odata.count'] = this._metadata['@odata.count']
    }
    if (this._metadata['@odata.nextLink'] !== undefined) {
      response['@odata.nextLink'] = this._metadata['@odata.nextLink']
    }
    if (this._metadata['@odata.deltaLink'] !== undefined) {
      response['@odata.deltaLink'] = this._metadata['@odata.deltaLink']
    }

    return response
  }
}

export class ODataEntityBuilder<T> {
  constructor(
    private readonly _entity: T,
    private readonly _metadata: ODataMetadata = {},
  ) {}

  context(value: string): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(this._entity, {
      ...this._metadata,
      '@odata.context': value,
    })
  }

  etag(value: string): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(this._entity, {
      ...this._metadata,
      '@odata.etag': value,
    })
  }

  build(): ODataSingleResponse<T> {
    const response: ODataSingleResponse<T> = { value: this._entity }

    if (this._metadata['@odata.context'] !== undefined) {
      response['@odata.context'] = this._metadata['@odata.context']
    }
    if (this._metadata['@odata.etag'] !== undefined) {
      response['@odata.etag'] = this._metadata['@odata.etag']
    }

    return response
  }
}

export class ODataErrorBuilder {
  constructor(
    private readonly _code: string,
    private readonly _message: string,
    private readonly _target?: string,
    private readonly _details?: ODataErrorDetail[],
    private readonly _innererror?: unknown,
    private readonly _translateFn?: TranslateFn,
    private readonly _lang?: string,
  ) {}

  target(value: string): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      value,
      this._details,
      this._innererror,
      this._translateFn,
      this._lang,
    )
  }

  details(value: ODataErrorDetail[]): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      this._target,
      value,
      this._innererror,
      this._translateFn,
      this._lang,
    )
  }

  innerError(value: unknown): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      this._target,
      this._details,
      value,
      this._translateFn,
      this._lang,
    )
  }

  translate(translateFn: TranslateFn, lang?: string): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      this._target,
      this._details,
      this._innererror,
      translateFn,
      lang,
    )
  }

  build(): ODataErrorResponse {
    let message = this._message
    if (this._translateFn) {
      message = this._translateFn(this._code, this._lang, {
        target: this._target,
        defaultMessage: this._message,
      })
    }

    let details = this._details
    if (this._translateFn && this._details) {
      details = this._details.map((detail) => ({
        ...detail,
        message: this._translateFn!(detail.code, this._lang, {
          target: detail.target,
          defaultMessage: detail.message,
        }),
      }))
    }

    const error: ODataError = {
      code: this._code,
      message,
    }

    if (this._target !== undefined) {
      error.target = this._target
    }
    if (details !== undefined) {
      error.details = details
    }
    if (this._innererror !== undefined) {
      error.innererror = this._innererror
    }

    return { error }
  }
}

export const ODataResponse = {
  collection: <T>(value: T[]) => new ODataCollectionBuilder<T>(value),
  item: <T>(entity: T) => new ODataEntityBuilder<T>(entity),
  created: <T>(entity: T) => new ODataEntityBuilder<T>(entity),
  updated: <T>(entity: T) => new ODataEntityBuilder<T>(entity),
  deleted: (): null => null,
  error: (code: string, message: string) => new ODataErrorBuilder(code, message),
}