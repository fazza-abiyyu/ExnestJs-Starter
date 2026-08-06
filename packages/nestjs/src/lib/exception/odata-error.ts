export class ODataError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly lang?: string,
  ) {
    super(message);
    this.name = 'ODataError';
  }
}
