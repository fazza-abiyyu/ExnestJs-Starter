import { createHmac, timingSafeEqual } from 'node:crypto';

function hmac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export class TokenSigner {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = 300,
  ) {}

  sign(resource: string, ttlSeconds = this.ttlSeconds): { exp: number; sig: string } {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
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
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  querySignature(resource: string, ttlSeconds = this.ttlSeconds): string {
    const { exp, sig } = this.sign(resource, ttlSeconds);
    return `exp=${exp}&sig=${sig}`;
  }
}
