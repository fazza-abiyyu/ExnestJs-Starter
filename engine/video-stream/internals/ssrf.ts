import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { VideoEngineError } from '../types.js';

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return -1;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n < 0) return true;
  const a = (n >>> 24) & 0xff;
  const b = (n >>> 16) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  const v4mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (v4mapped) return isPrivateIpv4(v4mapped[1]);
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
  if (
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  )
    return true; // fe80::/10 link-local
  if (lower.startsWith('ff')) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 0) return true;
  return kind === 4 ? isPrivateIpv4(ip) : isPrivateIpv6(ip);
}

function assertPublicTarget(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new VideoEngineError('INVALID_URL', 'Invalid URL', 400);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new VideoEngineError('SSRF_BLOCKED', 'Only http(s) URLs are allowed', 400);
  }
  if (url.username || url.password) {
    throw new VideoEngineError('SSRF_BLOCKED', 'URLs with credentials are not allowed', 400);
  }
  return url;
}

export class SsrfGuard {
  constructor(private readonly options: { blockPrivate: boolean } = { blockPrivate: true }) {}

  async assertSafeUrl(rawUrl: string): Promise<URL> {
    const url = assertPublicTarget(rawUrl);
    if (!this.options.blockPrivate) return url;

    let records: { address: string }[];
    try {
      records = await lookup(url.hostname, { all: true });
    } catch {
      throw new VideoEngineError('DNS_FAILED', 'Could not resolve host', 400);
    }
    if (records.length === 0) {
      throw new VideoEngineError('DNS_FAILED', 'Could not resolve host', 400);
    }
    if (records.some((r) => isPrivateAddress(r.address))) {
      throw new VideoEngineError('SSRF_BLOCKED', 'URL resolves to a private address', 400);
    }
    return url;
  }
}
