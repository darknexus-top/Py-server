import crypto from 'node:crypto';
import net from 'node:net';
import { getSetting } from './db.ts';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, hexDigest] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const target = Buffer.from(hexDigest, 'hex');
  if (derived.length !== target.length) return false;
  return crypto.timingSafeEqual(derived, target);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const SENSITIVE_KEY_PATTERN = /(password|passcode|otp|token|secret|api[-_]?key|authorization|x-api-key|device[-_]?fgp|fingerprint|cookie|csrf)/i;

export function redactSensitiveData(input: unknown, depth = 0): unknown {
  if (depth > 6 || input === null || input === undefined) return input;
  if (typeof input === 'string') {
    if (/^Bearer\s+/i.test(input)) return 'Bearer [REDACTED]';
    return input.length > 512 ? `${input.slice(0, 512)}…` : input;
  }
  if (Array.isArray(input)) {
    return input.slice(0, 25).map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[REDACTED]';
      } else {
        out[key] = redactSensitiveData(val, depth + 1);
      }
    }
    return out;
  }
  return input;
}

export function maskSecret(secret: string | undefined): string {
  if (!secret || !secret.trim()) return 'Not configured';
  const trimmed = secret.trim();
  if (trimmed.length <= 6) return 'Configured (••••••)';
  return `Configured (••••${trimmed.slice(-4)})`;
}

export function sanitizeText(value: unknown, maxLen = 120): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, maxLen);
}

export function normalizeNagadMsisdn(raw: unknown): { valid: boolean; normalized?: string; error?: string } {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Phone number (msisdn) must be a string.' };
  }
  const cleaned = raw.replace(/[\s\-()]/g, '');
  let msisdn = cleaned;
  if (msisdn.startsWith('+880')) {
    msisdn = `0${msisdn.slice(4)}`;
  } else if (msisdn.startsWith('880')) {
    msisdn = `0${msisdn.slice(3)}`;
  }
  if (!/^01[3-9]\d{8}$/.test(msisdn)) {
    return {
      valid: false,
      error: 'Invalid Bangladesh MSISDN. Expected 11 digits starting with 013–019 (e.g. 01625116266).',
    };
  }
  return { valid: true, normalized: msisdn };
}

export function normalizeTruecallerPhone(raw: unknown): { valid: boolean; normalized?: string; countryCode?: string; error?: string } {
  if (typeof raw !== 'string') {
    return { valid: false, error: 'Phone number must be a string.' };
  }
  const cleaned = raw.replace(/[\s\-()]/g, '');
  let normalized = cleaned;
  if (/^01[3-9]\d{8}$/.test(cleaned)) {
    normalized = `+880${cleaned.slice(1)}`;
  } else if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    return {
      valid: false,
      error: 'Invalid phone format. Provide E.164 (e.g. +8801625116266) or 11-digit BD number.',
    };
  }
  const countryCode = normalized.startsWith('+880') ? 'BD' : normalized.startsWith('+1') ? 'US' : 'INTL';
  return { valid: true, normalized, countryCode };
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

export function validateExternalUrl(rawUrl: string): { valid: boolean; url?: URL; error?: string } {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Only http:// and https:// endpoints are permitted.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || isPrivateIp(host)) {
      return { valid: false, error: 'Loopback, link-local, and private network hosts are blocked.' };
    }
    return { valid: true, url: parsed };
  } catch {
    return { valid: false, error: 'Invalid URL format.' };
  }
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function checkRateLimit(key: string): {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetEpochSeconds: number;
} {
  const limitRaw = Number.parseInt(getSetting('rate_limit_per_minute', '60'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 5000) : 60;
  const now = Date.now();
  const windowMs = 60_000;

  let bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    rateBuckets.set(key, bucket);
  }

  bucket.count += 1;
  const allowed = bucket.count <= limit;
  const remaining = Math.max(0, limit - bucket.count);
  return {
    allowed,
    limit,
    remaining,
    resetEpochSeconds: Math.ceil(bucket.resetAt / 1000),
  };
}
