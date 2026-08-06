import {
  ODataCollectionResponse,
  ODataError,
  ODataErrorDetail,
  ODataErrorResponse,
  ODataMetadata,
  ODataSingleResponse,
  TranslateFn,
} from './types.js';

/**
 * Fluent builder for OData V4 collection responses.
 */
export class ODataCollectionBuilder<T> {
  constructor(
    private readonly _value: T[],
    private readonly _metadata: ODataMetadata = {},
  ) {}

  /**
   * Sets the `@odata.context` metadata property.
   */
  context(value: string): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.context': value,
    });
  }

  /**
   * Sets the `@odata.count` metadata property.
   */
  count(value: number): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.count': value,
    });
  }

  /**
   * Sets the `@odata.nextLink` metadata property.
   */
  nextLink(value: string): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.nextLink': value,
    });
  }

  /**
   * Sets the `@odata.deltaLink` metadata property.
   */
  deltaLink(value: string): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(this._value, {
      ...this._metadata,
      '@odata.deltaLink': value,
    });
  }

  /**
   * Builds and returns the final OData collection response payload.
   */
  build(): ODataCollectionResponse<T> {
    const response: ODataCollectionResponse<T> = {
      value: this._value,
    };

    if (this._metadata['@odata.context'] !== undefined) {
      response['@odata.context'] = this._metadata['@odata.context'];
    }
    if (this._metadata['@odata.count'] !== undefined) {
      response['@odata.count'] = this._metadata['@odata.count'];
    }
    if (this._metadata['@odata.nextLink'] !== undefined) {
      response['@odata.nextLink'] = this._metadata['@odata.nextLink'];
    }
    if (this._metadata['@odata.deltaLink'] !== undefined) {
      response['@odata.deltaLink'] = this._metadata['@odata.deltaLink'];
    }

    return response;
  }
}

/**
 * Fluent builder for OData V4 single entity/resource responses.
 */
export class ODataEntityBuilder<T> {
  constructor(
    private readonly _entity: T,
    private readonly _metadata: ODataMetadata = {},
  ) {}

  /**
   * Sets the `@odata.context` metadata property.
   */
  context(value: string): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(this._entity, {
      ...this._metadata,
      '@odata.context': value,
    });
  }

  /**
   * Sets the `@odata.etag` metadata property.
   */
  etag(value: string): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(this._entity, {
      ...this._metadata,
      '@odata.etag': value,
    });
  }

  /**
   * Builds and returns the final OData single entity response payload.
   */
  build(): ODataSingleResponse<T> {
    const response: ODataSingleResponse<T> = { value: this._entity };

    if (this._metadata['@odata.context'] !== undefined) {
      response['@odata.context'] = this._metadata['@odata.context'];
    }
    if (this._metadata['@odata.etag'] !== undefined) {
      response['@odata.etag'] = this._metadata['@odata.etag'];
    }

    return response;
  }
}

/**
 * Fluent builder for OData V4 error responses.
 */
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

  /**
   * Sets the target of the error.
   */
  target(value: string): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      value,
      this._details,
      this._innererror,
      this._translateFn,
      this._lang,
    );
  }

  /**
   * Sets error details.
   */
  details(value: ODataErrorDetail[]): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      this._target,
      value,
      this._innererror,
      this._translateFn,
      this._lang,
    );
  }

  /**
   * Sets inner error details (e.g. stack traces, debug info).
   */
  innerError(value: unknown): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      this._target,
      this._details,
      value,
      this._translateFn,
      this._lang,
    );
  }

  /**
   * Configures a translation function and language target for localized messages.
   */
  translate(translateFn: TranslateFn, lang?: string): ODataErrorBuilder {
    return new ODataErrorBuilder(
      this._code,
      this._message,
      this._target,
      this._details,
      this._innererror,
      translateFn,
      lang,
    );
  }

  /**
   * Builds and returns the final OData error response payload.
   */
  build(): ODataErrorResponse {
    let message = this._message;
    if (this._translateFn) {
      message = this._translateFn(this._code, this._lang, {
        target: this._target,
        defaultMessage: this._message,
      });
    }

    let details = this._details;
    if (this._translateFn && this._details) {
      details = this._details.map((detail) => ({
        ...detail,
        message: this._translateFn!(detail.code, this._lang, {
          target: detail.target,
          defaultMessage: detail.message,
        }),
      }));
    }

    const error: ODataError = {
      code: this._code,
      message,
    };

    if (this._target !== undefined) {
      error.target = this._target;
    }
    if (details !== undefined) {
      error.details = details;
    }
    if (this._innererror !== undefined) {
      error.innererror = this._innererror;
    }

    return { error };
  }
}

/**
 * Entry point for building standard OData V4 response payloads.
 */
export class ODataResponse {
  /**
   * Creates a builder for an OData collection/entity set response.
   */
  static collection<T>(value: T[]): ODataCollectionBuilder<T> {
    return new ODataCollectionBuilder(value);
  }

  /**
   * Creates a builder for an OData single entity/resource response.
   */
  static item<T>(entity: T): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(entity);
  }

  /**
   * Creates a builder for a created OData resource.
   */
  static created<T>(entity: T): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(entity);
  }

  /**
   * Creates a builder for an updated OData resource.
   */
  static updated<T>(entity: T): ODataEntityBuilder<T> {
    return new ODataEntityBuilder(entity);
  }

  /**
   * Returns a representation of a deleted response (null body, 204 status).
   */
  static deleted(): null {
    return null;
  }

  /**
   * Creates a builder for an OData error response.
   */
  static error(code: string, message: string): ODataErrorBuilder {
    return new ODataErrorBuilder(code, message);
  }
}
