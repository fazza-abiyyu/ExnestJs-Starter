export interface ODataMetadata {
  '@odata.context'?: string;
  '@odata.count'?: number;
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
  '@odata.etag'?: string;
}

export type ODataCollectionResponse<T> = ODataMetadata & {
  value: T[];
};

export type ODataSingleResponse<T> = ODataMetadata & { value: T };

export interface ODataErrorDetail {
  code: string;
  message: string;
  target?: string;
}

export interface ODataError {
  code: string;
  message: string;
  target?: string;
  details?: ODataErrorDetail[];
  innererror?: unknown;
}

export interface ODataErrorResponse {
  error: ODataError;
}

export type TranslateFn = (key: string, lang?: string, args?: unknown) => string;
