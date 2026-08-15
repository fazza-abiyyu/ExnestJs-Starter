import { createHmac, timingSafeEqual } from 'node:crypto';

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export class TokenSigner {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = 1800,
  ) {}

  sign(resource: string): { exp: number; sig: string } {
    const exp = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    return { exp, sig: hmac(this.secret, `${resource}:${exp}`) };
  }

  verify(
    resource: string,
    exp: number,
    sig: string,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): boolean {
    if (!Number.isFinite(exp) || exp < nowSeconds) return false;
    if (typeof sig !== 'string' || sig.length === 0) return false;
    const expected = hmac(this.secret, `${resource}:${exp}`);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  cookieValue(resource: string): string {
    const { exp, sig } = this.sign(resource);
    return `${sig}.${exp}`;
  }

  parseCookieValue(value: string | undefined): { sig: string; exp: number } | null {
    if (!value) return null;
    const sep = value.indexOf('.');
    if (sep <= 0) return null;
    const sig = value.slice(0, sep);
    const exp = Number(value.slice(sep + 1));
    if (!Number.isFinite(exp)) return null;
    return { sig, exp };
  }

  verifyCookie(resource: string, raw: string | undefined): boolean {
    const parsed = this.parseCookieValue(raw);
    if (!parsed) return false;
    return this.verify(resource, parsed.exp, parsed.sig);
  }

  querySignature(resource: string): string {
    const { exp, sig } = this.sign(resource);
    return `exp=${exp}&sig=${sig}`;
  }
}
