import { ODataError } from './index.js';
import { ODataResponse, odataI18n } from '../odata/index.js';

export function errorHandler(context: { error: unknown; set: { status?: number | string } }) {
  const { error, set } = context;

  if (error instanceof ODataError) {
    set.status = error.status;
    return ODataResponse.error(error.code, error.message)
      .translate(odataI18n.getTranslator(), error.lang)
      .build();
  }

  console.error('Unhandled Server Error:', error);
  set.status = 500;
  const message = error instanceof Error ? error.message : 'Internal Server Error';
  return ODataResponse.error('INTERNAL_ERROR', message).build();
}
