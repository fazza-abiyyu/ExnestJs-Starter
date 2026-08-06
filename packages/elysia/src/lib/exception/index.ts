export class ODataError extends Error {
  readonly code: string;
  readonly status: number;
  readonly lang?: string;

  constructor(code: string, message: string, status: number, lang?: string) {
    super(message);
    this.name = 'ODataError';
    this.code = code;
    this.status = status;
    this.lang = lang;
  }
}

export class ValidationError extends ODataError {
  constructor(message: string, lang?: string) {
    super('VALIDATION_ERROR', message, 400, lang);
  }
}
