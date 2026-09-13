// VA-ORM typed errors + secret redaction

export class VaError extends Error {
  readonly code: string;
  override readonly cause?: unknown;

  constructor(message: string, options: { code?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'VaError';
    this.code = options.code ?? 'VA_ERROR';
    this.cause = options.cause;
  }

  /** Wrap a driver/ORM error without leaking full DSNs. */
  static wrap(err: unknown, context: string, code = 'DRIVER_ERROR'): VaError {
    if (err instanceof VaError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new VaError(`${context}: ${VaError.redactSecrets(message)}`, { code, cause: err });
  }

  static redactSecrets(text: string): string {
    return text
      .replace(/(password|passwd|pwd)=([^\s&'"]+)/gi, '$1=***')
      .replace(
        /(api[_-]?key|apikey|secret|token|access[_-]?key|private[_-]?key)(["']?\s*[:=]\s*["']?)([^\s&'"]+)/gi,
        '$1$2***',
      )
      .replace(/\b(bearer|basic)\s+[a-z0-9._\-+/=]+/gi, '$1 ***')
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '***')
      .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, (m) => VaError.redactDsn(m))
      .replace(/mysql:\/\/[^\s]+/gi, (m) => VaError.redactDsn(m))
      .replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, (m) => VaError.redactDsn(m))
      .replace(/rediss?:\/\/[^\s]+/gi, (m) => VaError.redactDsn(m))
      .replace(/amqps?:\/\/[^\s]+/gi, (m) => VaError.redactDsn(m))
      .replace(/([a-z][a-z0-9+.-]*):\/\/([^/\s:@]+):([^@\s]+)@/gi, '$1://$2:***@');
  }

  static redactDsn(dsn: string): string {
    try {
      const u = new URL(dsn);
      if (u.password) u.password = '***';
      return u.toString();
    } catch {
      return dsn.replace(/:\/\/([^:/@]+)(:[^@]*)?@/, '://$1:***@');
    }
  }
}
