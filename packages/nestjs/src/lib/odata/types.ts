/**
 * Common OData V4 metadata properties.
 */
export interface ODataMetadata {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
  '@odata.etag'?: string;
}

/**
 * Standard OData V4 collection/entity set response.
 */
export type ODataCollectionResponse<T> = ODataMetadata & {
  value: T[];
};

/**
 * Standard OData V4 single entity/resource response.
 */
export type ODataSingleResponse<T> = ODataMetadata & { value: T };

/**
 * Detailed error object within an OData error.
 */
export interface ODataErrorDetail {
  code: string;
  message: string;
  target?: string;
}

/**
 * Standard OData V4 error payload structure.
 */
export interface ODataError {
  code: string;
  message: string;
  target?: string;
  details?: ODataErrorDetail[];
  innererror?: unknown;
}

/**
 * Standard OData V4 error response wrapper.
 */
export interface ODataErrorResponse {
  error: ODataError;
}

/**
 * Interface/Type for custom i18n translation functions.
 */
export type TranslateFn = (key: string, lang?: string, args?: unknown) => string;
