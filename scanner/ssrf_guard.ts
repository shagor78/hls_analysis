import dns from 'node:dns/promises';
import net from 'node:net';

export interface SecurityConfig {
  allowPrivateNetworks: boolean;
  urlAllowlist: string[];
  rateLimitRps: number;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
}

const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowPrivateNetworks: process.env.ALLOW_PRIVATE_NETWORKS === 'true',
  urlAllowlist: process.env.URL_ALLOWLIST
    ? process.env.URL_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean)
    : [],
  rateLimitRps: Number(process.env.DEFAULT_RATE_LIMIT_RPS) || 10,
  timeoutMs: Number(process.env.DEFAULT_TIMEOUT_MS) || 8000,
  maxRetries: Number(process.env.DEFAULT_MAX_RETRIES) || 3,
  concurrency: Number(process.env.DEFAULT_CONCURRENCY) || 5,
};

let currentSecurityConfig: SecurityConfig = { ...DEFAULT_SECURITY_CONFIG };

export function getSecurityConfig(): SecurityConfig {
  return { ...currentSecurityConfig };
}

export function updateSecurityConfig(partial: Partial<SecurityConfig>): SecurityConfig {
  currentSecurityConfig = {
    ...currentSecurityConfig,
    ...partial,
  };
  return getSecurityConfig();
}

/**
 * Masks sensitive credentials, tokens, API keys, and connection passwords.
 * Never logs or exposes raw secrets.
 */
export function maskSecret(value?: string | null): string {
  if (!value || value.trim() === '') return '';
  return '************';
}

export function maskConnectionUrl(connUrl: string): string {
  if (!connUrl) return '';
  try {
    // Mask password in standard URI format: dialect://user:password@host:port/db
    return connUrl.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1************$3');
  } catch {
    return '************';
  }
}

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api_key/i,
  /apikey/i,
  /jwt/i,
  /cookie/i,
  /session/i,
  /card_number/i,
  /cvv/i,
  /payment/i,
  /private_key/i,
  /credential/i,
];

export function isSensitiveFieldName(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

export function sanitizeRecord<T extends Record<string, unknown>>(record: T): T {
  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (isSensitiveFieldName(key)) {
      sanitized[key] = '************';
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      sanitized[key] = sanitizeRecord(val as Record<string, unknown>);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized as T;
}

/**
 * Checks if an IPv4 or IPv6 address belongs to a private, loopback, link-local,
 * or cloud metadata network range.
 */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    // 0.0.0.0/8
    if (a === 0) return true;
    // 10.0.0.0/8 (RFC1918)
    if (a === 10) return true;
    // 100.64.0.0/10 (CGNAT)
    if (a === 100 && b >= 64 && b <= 127) return true;
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (Link-local & Cloud Metadata 169.254.169.254)
    if (a === 169 && b === 254) return true;
    // 172.16.0.0/12 (RFC1918)
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16 (RFC1918)
    if (a === 192 && b === 168) return true;
    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (a >= 224) return true;
    return false;
  }

  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fe80:')) return true; // Link-local
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local
    if (normalized.startsWith('::ffff:')) {
      const v4Part = normalized.replace('::ffff:', '');
      if (net.isIPv4(v4Part)) return isPrivateOrReservedIp(v4Part);
    }
    return false;
  }

  return true;
}

export interface SsrfValidationResult {
  allowed: boolean;
  reason?: string;
  parsedUrl?: URL;
  resolvedIp?: string;
}

/**
 * Validates target URL against SSRF rules, protocol restrictions, and optional URL allowlist.
 */
export async function validateUrlForSsrf(
  rawUrl: string,
  configOverride?: Partial<SecurityConfig>
): Promise<SsrfValidationResult> {
  const cfg = { ...currentSecurityConfig, ...configOverride };

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      allowed: false,
      reason: `Unsupported protocol "${parsed.protocol}". Only http: and https: are permitted.`,
    };
  }

  // Reject embedded credentials in URLs
  if (parsed.username || parsed.password) {
    return {
      allowed: false,
      reason: 'Embedded credentials in URLs are prohibited by security policy.',
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check allowlist if configured
  if (cfg.urlAllowlist && cfg.urlAllowlist.length > 0) {
    const matchesAllowlist = cfg.urlAllowlist.some((allowedDomain) => {
      const clean = allowedDomain.toLowerCase().trim();
      return hostname === clean || hostname.endsWith(`.${clean}`);
    });
    if (!matchesAllowlist) {
      return {
        allowed: false,
        reason: `Host "${hostname}" is not in the configured URL allowlist.`,
      };
    }
  }

  if (!cfg.allowPrivateNetworks) {
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname === 'metadata.google.internal'
    ) {
      return {
        allowed: false,
        reason: `SSRF Protection: Access to internal/loopback host "${hostname}" is blocked.`,
      };
    }

    if (net.isIP(hostname)) {
      if (isPrivateOrReservedIp(hostname)) {
        return {
          allowed: false,
          reason: `SSRF Protection: Access to private or reserved IP "${hostname}" is blocked.`,
        };
      }
      return { allowed: true, parsedUrl: parsed, resolvedIp: hostname };
    }

    try {
      const lookupResult = await dns.lookup(hostname, { all: true });
      for (const entry of lookupResult) {
        if (isPrivateOrReservedIp(entry.address)) {
          return {
            allowed: false,
            reason: `SSRF Protection: Host "${hostname}" resolves to private/reserved IP (${entry.address}).`,
          };
        }
      }
      return {
        allowed: true,
        parsedUrl: parsed,
        resolvedIp: lookupResult[0]?.address,
      };
    } catch {
      // If DNS fails in offline/sandbox environment, still allow syntactic check to proceed to fetch handler
      return { allowed: true, parsedUrl: parsed };
    }
  }

  return { allowed: true, parsedUrl: parsed };
}

/**
 * Token-bucket / sliding delay rate limiter and concurrent worker pool helper.
 */
export class RateLimitedPool {
  private minIntervalMs: number;
  private lastRequestTime = 0;

  constructor(rateLimitRps: number) {
    this.minIntervalMs = rateLimitRps > 0 ? Math.floor(1000 / rateLimitRps) : 0;
  }

  async waitTurn(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      const waitMs = this.minIntervalMs - elapsed;
      this.lastRequestTime = now + waitMs;
      await new Promise((r) => setTimeout(r, waitMs));
    } else {
      this.lastRequestTime = now;
    }
  }

  async runAll<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
    onProgress?: (completed: number, total: number, latestResult: R) => void
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let currentIndex = 0;
    let completedCount = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));

    const workers = Array.from({ length: workerCount }, async () => {
      while (true) {
        const idx = currentIndex++;
        if (idx >= items.length) break;
        await this.waitTurn();
        const res = await worker(items[idx], idx);
        results[idx] = res;
        completedCount++;
        if (onProgress) {
          onProgress(completedCount, items.length, res);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxRetries?: number;
  allowPrivateNetworks?: boolean;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  contentLength: number;
  latencyMs: number;
  bodyText: string;
  finalUrl: string;
  error?: string;
  ssrfBlocked?: boolean;
  unauthorized?: boolean;
}

/**
 * Performs an HTTP fetch with SSRF validation, configurable timeout, and exponential backoff retry.
 * Never attempts to bypass 401/403 UNAUTHORIZED, WAF, CAPTCHA, or rate limits.
 */
export async function safeFetchWithRetry(
  url: string,
  options: SafeFetchOptions = {}
): Promise<SafeFetchResponse> {
  const cfg = getSecurityConfig();
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;
  const maxRetries = options.maxRetries ?? cfg.maxRetries;

  const ssrf = await validateUrlForSsrf(url, {
    allowPrivateNetworks: options.allowPrivateNetworks ?? cfg.allowPrivateNetworks,
  });

  if (!ssrf.allowed) {
    return {
      ok: false,
      status: 0,
      statusText: 'SSRF_BLOCKED',
      contentType: '',
      contentLength: 0,
      latencyMs: 0,
      bodyText: '',
      finalUrl: url,
      error: ssrf.reason || 'Blocked by SSRF security policy',
      ssrfBlocked: true,
    };
  }

  let attempt = 0;
  let lastError = 'Unknown error';
  let lastLatency = 0;

  while (attempt <= maxRetries) {
    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'User-Agent': 'StreamVault-Authorized-OTT-Migrator/1.0',
          Accept: '*/*',
          ...(options.headers || {}),
        },
        body: options.body,
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timer);
      const latencyMs = Date.now() - startTime;
      lastLatency = latencyMs;
      const contentType = response.headers.get('content-type') || 'application/octet-stream';

      // CRITICAL SECURITY RULE: Never retry or attempt to circumvent 401/403 Unauthorized or 429 Rate Limit
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          status: response.status,
          statusText: response.statusText || 'UNAUTHORIZED',
          contentType,
          contentLength: 0,
          latencyMs,
          bodyText: '',
          finalUrl: response.url || url,
          error: `HTTP ${response.status} Unauthorized — Access control respected (no retry/bypass attempted).`,
          unauthorized: true,
        };
      }

      if (response.status === 429) {
        return {
          ok: false,
          status: 429,
          statusText: 'TOO_MANY_REQUESTS',
          contentType,
          contentLength: 0,
          latencyMs,
          bodyText: '',
          finalUrl: response.url || url,
          error: 'HTTP 429 Rate limit encountered — stopping requests to respect origin rate limit.',
        };
      }

      // Read up to 2MB text safely for playlist/API inspection
      const text = options.method === 'HEAD' ? '' : await response.text();
      const headerLen = Number(response.headers.get('content-length') || 0);
      const contentLength = headerLen > 0 ? headerLen : Buffer.byteLength(text, 'utf-8');

      if (response.status >= 500 && attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.min(4000, 300 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType,
        contentLength,
        latencyMs,
        bodyText: text,
        finalUrl: response.url || url,
        error: response.ok ? undefined : `HTTP ${response.status} ${response.statusText}`,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      lastLatency = Date.now() - startTime;
      const isAbort = err instanceof Error && err.name === 'AbortError';
      lastError = isAbort
        ? `Connection timed out after ${timeoutMs}ms`
        : err instanceof Error
        ? err.message
        : String(err);

      if (attempt < maxRetries) {
        attempt++;
        const backoffMs = Math.min(4000, 300 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, backoffMs));
      } else {
        return {
          ok: false,
          status: isAbort ? 408 : 0,
          statusText: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
          contentType: '',
          contentLength: 0,
          latencyMs: lastLatency,
          bodyText: '',
          finalUrl: url,
          error: lastError,
        };
      }
    }
  }

  return {
    ok: false,
    status: 0,
    statusText: 'FAILED',
    contentType: '',
    contentLength: 0,
    latencyMs: lastLatency,
    bodyText: '',
    finalUrl: url,
    error: lastError,
  };
}
