import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import {
  db,
  ensureEnvAdminUser,
  getAllSettings,
  getMetricsSummary,
  getSetting,
  setSetting,
} from './server/db.ts';
import {
  getNagadStatus,
  getTruecallerStatus,
  runNagadCheck,
  runTruecallerLookup,
} from './server/integrations.ts';
import {
  broadcastTelemetryUpdate,
  buildTelemetrySnapshot,
  getUptimeSeconds,
  registerSseClient,
} from './server/realtime.ts';
import {
  checkRateLimit,
  constantTimeEqual,
  hashPassword,
  redactSensitiveData,
  sanitizeText,
  sha256Hex,
  validateExternalUrl,
  verifyPassword,
} from './server/security.ts';

dotenv.config();

const PORT = 3000;
const SESSION_COOKIE_NAME = 'infinity_session';
const SESSION_SIGNING_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

interface AuthenticatedActor {
  type: 'session' | 'api_key';
  userId: number;
  username: string;
  displayName: string;
  email: string;
  role: string;
  csrfToken?: string;
  sessionTokenHash?: string;
  apiKeyPrefix?: string;
}

interface AuthedRequest extends Request {
  actor?: AuthenticatedActor;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

function setSessionCookie(req: Request, res: Response, rawToken: string, ttlMinutes: number): void {
  const maxAgeSec = Math.max(60, ttlMinutes * 60);
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
  ];
  if (isHttps) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getNeedsAdminSetup(): boolean {
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim().length > 0) {
    return false;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  return row.cnt === 0;
}

function resolveActor(req: AuthedRequest): AuthenticatedActor | null {
  // 1. Check API Key header (X-API-Key or Authorization: Bearer inf_...)
  const apiKeyHeader =
    (typeof req.headers['x-api-key'] === 'string' && req.headers['x-api-key'].trim()) ||
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : '');

  if (apiKeyHeader) {
    const keyHash = sha256Hex(apiKeyHeader);
    const keyRow = db
      .prepare(
        `SELECT ak.id, ak.key_prefix, ak.key_hash, u.id as user_id, u.username, u.display_name, u.email, u.role
         FROM api_keys ak
         JOIN users u ON u.id = ak.user_id
         WHERE ak.key_hash = ? AND ak.revoked = 0`
      )
      .get(keyHash) as
      | {
          id: number;
          key_prefix: string;
          key_hash: string;
          user_id: number;
          username: string;
          display_name: string;
          email: string;
          role: string;
        }
      | undefined;

    if (keyRow && constantTimeEqual(keyRow.key_hash, keyHash)) {
      db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), keyRow.id);
      return {
        type: 'api_key',
        userId: keyRow.user_id,
        username: keyRow.username,
        displayName: keyRow.display_name,
        email: keyRow.email,
        role: keyRow.role,
        apiKeyPrefix: keyRow.key_prefix,
      };
    }
    return null;
  }

  // 2. Check HttpOnly session cookie
  const cookies = parseCookies(req);
  const rawSessionToken = cookies[SESSION_COOKIE_NAME];
  if (!rawSessionToken) return null;

  const tokenHash = sha256Hex(`${SESSION_SIGNING_SECRET}:${rawSessionToken}`);
  const nowMs = Date.now();
  const sessionRow = db
    .prepare(
      `SELECT s.token_hash, s.csrf_token, s.expires_at, u.id as user_id, u.username, u.display_name, u.email, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as
    | {
        token_hash: string;
        csrf_token: string;
        expires_at: number;
        user_id: number;
        username: string;
        display_name: string;
        email: string;
        role: string;
      }
    | undefined;

  if (!sessionRow) return null;
  if (sessionRow.expires_at <= nowMs) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }

  return {
    type: 'session',
    userId: sessionRow.user_id,
    username: sessionRow.username,
    displayName: sessionRow.display_name,
    email: sessionRow.email,
    role: sessionRow.role,
    csrfToken: sessionRow.csrf_token,
    sessionTokenHash: sessionRow.token_hash,
  };
}

function recordApiLog(
  req: AuthedRequest,
  statusCode: number,
  latencyMs: number,
  integration: string,
  requestMeta: unknown,
  responseSummary: unknown
) {
  const redactionEnabled = getSetting('log_redaction_enabled', 'true') === 'true';
  const safeReqMeta = redactionEnabled ? redactSensitiveData(requestMeta) : requestMeta;
  const safeResSummary = redactionEnabled ? redactSensitiveData(responseSummary) : responseSummary;
  const actorLabel = req.actor
    ? req.actor.type === 'api_key'
      ? `api_key:${req.actor.apiKeyPrefix}`
      : `admin:${req.actor.username}`
    : 'anonymous';
  const clientIp = req.ip || req.socket.remoteAddress || '0.0.0.0';
  const createdAt = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO request_logs
        (method, path, status_code, latency_ms, client_ip, actor, integration, request_meta, response_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.method,
      req.path,
      statusCode,
      Math.max(1, Math.round(latencyMs)),
      clientIp,
      actorLabel,
      integration,
      JSON.stringify(safeReqMeta ?? {}),
      JSON.stringify(safeResSummary ?? {}),
      createdAt
    );

  broadcastTelemetryUpdate({
    id: Number(info.lastInsertRowid),
    method: req.method,
    path: req.path,
    status_code: statusCode,
    latency_ms: Math.max(1, Math.round(latencyMs)),
    actor: actorLabel,
    integration,
    created_at: createdAt,
  });
}

function verifyCsrfAndOrigin(req: AuthedRequest, res: Response): boolean {
  if (!req.actor || req.actor.type !== 'session') return true;
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;

  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== host) {
        res.status(403).json({ ok: false, error: 'ORIGIN_MISMATCH', message: 'Request origin mismatch.' });
        return false;
      }
    } catch {
      res.status(403).json({ ok: false, error: 'INVALID_ORIGIN', message: 'Invalid request origin.' });
      return false;
    }
  }

  const csrfHeader = req.headers['x-csrf-token'];
  if (typeof csrfHeader !== 'string' || !req.actor.csrfToken || !constantTimeEqual(csrfHeader, req.actor.csrfToken)) {
    res.status(403).json({ ok: false, error: 'CSRF_INVALID', message: 'Missing or invalid CSRF token.' });
    return false;
  }
  return true;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const actor = resolveActor(req);
  if (!actor) {
    recordApiLog(req, 401, 2, 'auth', { query: req.query }, { error: 'UNAUTHORIZED' });
    res.status(401).json({
      ok: false,
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Sign in as admin or supply a valid X-API-Key header.',
    });
    return;
  }
  req.actor = actor;
  if (!verifyCsrfAndOrigin(req, res)) {
    recordApiLog(req, 403, 2, 'security', {}, { error: 'CSRF_OR_ORIGIN_BLOCKED' });
    return;
  }
  next();
}

function requireAdminSession(req: AuthedRequest, res: Response, next: NextFunction) {
  const actor = resolveActor(req);
  if (!actor || actor.type !== 'session') {
    res.status(401).json({
      ok: false,
      error: 'ADMIN_SESSION_REQUIRED',
      message: 'Admin browser session is required for this action.',
    });
    return;
  }
  req.actor = actor;
  if (!verifyCsrfAndOrigin(req, res)) return;
  next();
}

function rateLimitMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.path === '/api/v1/stream' || req.path === '/api/v1/auth/status') {
    next();
    return;
  }
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const result = checkRateLimit(`${clientIp}:api`);
  res.setHeader('X-RateLimit-Limit', String(result.limit));
  res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  res.setHeader('X-RateLimit-Reset', String(result.resetEpochSeconds));

  if (!result.allowed) {
    res.setHeader('Retry-After', '60');
    recordApiLog(req, 429, 1, 'rate_limiter', { path: req.path }, { error: 'RATE_LIMIT_EXCEEDED' });
    res.status(429).json({
      ok: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded (${result.limit} requests/minute). Please retry shortly.`,
    });
    return;
  }
  next();
}

async function startServer() {
  ensureEnvAdminUser();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  app.use('/api/v1', rateLimitMiddleware);

  // --- Auth & Session Routes ---
  app.get('/api/v1/auth/status', (req: AuthedRequest, res: Response) => {
    const actor = resolveActor(req);
    const needsSetup = getNeedsAdminSetup();
    res.json({
      ok: true,
      authenticated: Boolean(actor),
      needsSetup,
      user: actor
        ? {
            id: actor.userId,
            username: actor.username,
            displayName: actor.displayName,
            email: actor.email,
            role: actor.role,
          }
        : null,
      csrfToken: actor?.csrfToken || null,
    });
  });

  app.post('/api/v1/auth/setup', (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    if (!getNeedsAdminSetup()) {
      res.status(409).json({
        ok: false,
        error: 'SETUP_ALREADY_COMPLETED',
        message: 'Admin account is already configured.',
      });
      return;
    }

    const username = sanitizeText(req.body?.username || 'admin', 40) || 'admin';
    const displayName = sanitizeText(req.body?.displayName || 'Platform Administrator', 80) || 'Platform Administrator';
    const email = sanitizeText(req.body?.email || 'admin@infinity.network', 100) || 'admin@infinity.network';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (password.length < 8) {
      res.status(400).json({
        ok: false,
        error: 'WEAK_PASSWORD',
        message: 'Admin password must be at least 8 characters long.',
      });
      return;
    }

    const passwordHash = hashPassword(password);
    const nowIso = new Date().toISOString();

    const insertUser = db.prepare(
      'INSERT INTO users (username, display_name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const info = insertUser.run(username, displayName, email, 'admin', passwordHash, nowIso);
    const userId = Number(info.lastInsertRowid);

    // Issue first session automatically
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(`${SESSION_SIGNING_SECRET}:${rawToken}`);
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const ttlMinutes = Number.parseInt(getSetting('session_ttl_minutes', '60'), 10) || 60;
    const expiresAt = Date.now() + ttlMinutes * 60_000;

    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(tokenHash, userId, csrfToken, expiresAt, nowIso);

    // Create a starter API key for testing
    const rawApiKey = `inf_${crypto.randomBytes(24).toString('hex')}`;
    db.prepare(
      'INSERT INTO api_keys (user_id, label, key_prefix, key_hash, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)'
    ).run(userId, 'Default Admin Key', rawApiKey.slice(0, 12), sha256Hex(rawApiKey), nowIso);

    setSessionCookie(req, res, rawToken, ttlMinutes);
    recordApiLog(req, 201, performance.now() - start, 'auth', { username }, { event: 'admin_claimed' });

    res.status(201).json({
      ok: true,
      user: { id: userId, username, displayName, email, role: 'admin' },
      csrfToken,
      initialApiKey: rawApiKey,
    });
  });

  app.post('/api/v1/auth/login', (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    if (getNeedsAdminSetup()) {
      res.status(409).json({
        ok: false,
        error: 'SETUP_REQUIRED',
        message: 'Complete first-run admin setup before signing in.',
      });
      return;
    }

    const username = sanitizeText(req.body?.username || 'admin', 40) || 'admin';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      res.status(400).json({ ok: false, error: 'MISSING_PASSWORD', message: 'Password is required.' });
      return;
    }

    const envAdminPass = process.env.ADMIN_PASSWORD?.trim();
    const envAdminUser = (process.env.ADMIN_USERNAME || 'admin').trim();

    let authenticatedUser: {
      id: number;
      username: string;
      display_name: string;
      email: string;
      role: string;
    } | null = null;

    if (envAdminPass && username === envAdminUser) {
      if (constantTimeEqual(password, envAdminPass)) {
        authenticatedUser = ensureEnvAdminUser();
      }
    } else {
      const userRow = db
        .prepare('SELECT id, username, display_name, email, role, password_hash FROM users WHERE username = ?')
        .get(username) as
        | {
            id: number;
            username: string;
            display_name: string;
            email: string;
            role: string;
            password_hash: string;
          }
        | undefined;
      if (userRow && verifyPassword(password, userRow.password_hash)) {
        authenticatedUser = userRow;
      }
    }

    if (!authenticatedUser) {
      recordApiLog(req, 401, performance.now() - start, 'auth', { username }, { error: 'INVALID_CREDENTIALS' });
      res.status(401).json({
        ok: false,
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid username or password.',
      });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(`${SESSION_SIGNING_SECRET}:${rawToken}`);
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const ttlMinutes = Number.parseInt(getSetting('session_ttl_minutes', '60'), 10) || 60;
    const expiresAt = Date.now() + ttlMinutes * 60_000;
    const nowIso = new Date().toISOString();

    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(tokenHash, authenticatedUser.id, csrfToken, expiresAt, nowIso);

    setSessionCookie(req, res, rawToken, ttlMinutes);
    recordApiLog(req, 200, performance.now() - start, 'auth', { username }, { event: 'login_success' });

    res.json({
      ok: true,
      user: {
        id: authenticatedUser.id,
        username: authenticatedUser.username,
        displayName: authenticatedUser.display_name,
        email: authenticatedUser.email,
        role: authenticatedUser.role,
      },
      csrfToken,
    });
  });

  app.post('/api/v1/auth/logout', (req: AuthedRequest, res: Response) => {
    const actor = resolveActor(req);
    if (actor?.type === 'session') {
      if (!verifyCsrfAndOrigin({ ...req, actor } as AuthedRequest, res)) return;
      if (actor.sessionTokenHash) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(actor.sessionTokenHash);
      }
    }
    clearSessionCookie(req, res);
    res.json({ ok: true, message: 'Signed out cleanly.' });
  });

  // --- Public Health & Status Endpoints ---
  app.get('/api/v1/health', (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    let dbOk = false;
    try {
      db.prepare('SELECT 1').get();
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const payload = {
      ok: dbOk,
      service: 'INFINITY NETWORK',
      status: dbOk ? 'healthy' : 'degraded',
      database: dbOk ? 'connected' : 'error',
      uptime_seconds: getUptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
    recordApiLog(req, dbOk ? 200 : 503, performance.now() - start, 'core', {}, { status: payload.status });
    res.status(dbOk ? 200 : 503).json(payload);
  });

  app.get('/api/v1/status', (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const summary = getMetricsSummary();
    const payload = {
      ok: true,
      online: true,
      uptime_seconds: getUptimeSeconds(),
      metrics: {
        total_requests: summary.total_requests,
        success_requests: summary.success_requests,
        failed_requests: summary.failed_requests,
        avg_latency_ms: summary.avg_latency_ms,
      },
      integrations: {
        nagad: {
          mode: getSetting('nagad_mock_mode', 'true') === 'true' ? 'mock' : 'live',
          status: 'ready',
        },
        truecaller: {
          mode: getSetting('truecaller_mock_mode', 'true') === 'true' ? 'mock' : 'live',
          status: 'ready',
        },
      },
      timestamp: new Date().toISOString(),
    };
    recordApiLog(req, 200, performance.now() - start, 'core', {}, { online: true });
    res.json(payload);
  });

  // --- SSE Real-Time Stream (Admin Session Required) ---
  app.get('/api/v1/stream', (req: AuthedRequest, res: Response) => {
    const actor = resolveActor(req);
    if (!actor) {
      res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Sign in to subscribe to live telemetry.' });
      return;
    }
    registerSseClient(res);
  });

  // --- Protected /api/v1/me ---
  app.get('/api/v1/me', requireAuth, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const actor = req.actor!;
    const keys = db
      .prepare(
        'SELECT id, label, key_prefix, last_used_at, created_at, revoked FROM api_keys WHERE user_id = ? ORDER BY id DESC'
      )
      .all(actor.userId);

    const payload = {
      ok: true,
      profile: {
        id: actor.userId,
        username: actor.username,
        displayName: actor.displayName,
        email: actor.email,
        role: actor.role,
        authMethod: actor.type,
      },
      api_keys: keys,
    };
    recordApiLog(req, 200, performance.now() - start, 'profile', {}, { keys_count: keys.length });
    res.json(payload);
  });

  app.post('/api/v1/me', requireAdminSession, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const actor = req.actor!;
    const action = sanitizeText(req.body?.action || 'update_profile', 40);

    if (action === 'create_key') {
      const label = sanitizeText(req.body?.label || 'API Client Key', 60) || 'API Client Key';
      const rawKey = `inf_${crypto.randomBytes(24).toString('hex')}`;
      const prefix = rawKey.slice(0, 12);
      const nowIso = new Date().toISOString();
      db.prepare(
        'INSERT INTO api_keys (user_id, label, key_prefix, key_hash, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)'
      ).run(actor.userId, label, prefix, sha256Hex(rawKey), nowIso);

      recordApiLog(req, 201, performance.now() - start, 'profile', { action, label }, { key_prefix: prefix });
      res.status(201).json({
        ok: true,
        api_key: rawKey,
        key_prefix: prefix,
        label,
        message: 'Store this API key safely; it will only be displayed once.',
      });
      return;
    }

    if (action === 'revoke_key') {
      const keyId = Number(req.body?.keyId);
      if (!Number.isInteger(keyId) || keyId <= 0) {
        res.status(400).json({ ok: false, error: 'INVALID_KEY_ID', message: 'Valid keyId is required.' });
        return;
      }
      db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?').run(keyId, actor.userId);
      recordApiLog(req, 200, performance.now() - start, 'profile', { action, keyId }, { revoked: true });
      res.json({ ok: true, revoked: true, keyId });
      return;
    }

    const displayName = sanitizeText(req.body?.displayName, 80);
    const email = sanitizeText(req.body?.email, 100);
    if (!displayName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'Valid display name and email required.' });
      return;
    }

    db.prepare('UPDATE users SET display_name = ?, email = ? WHERE id = ?').run(displayName, email, actor.userId);
    recordApiLog(req, 200, performance.now() - start, 'profile', { action: 'update_profile' }, { updated: true });
    res.json({ ok: true, profile: { displayName, email } });
  });

  // --- Nagad API Routes ---
  app.get('/api/v1/nagad/status', requireAuth, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const status = getNagadStatus();
    recordApiLog(req, 200, performance.now() - start, 'nagad', {}, { mode: status.mode });
    res.json({ ok: true, ...status });
  });

  app.post('/api/v1/nagad/status', requireAdminSession, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const body = req.body || {};

    if (typeof body.mockMode === 'boolean') {
      setSetting('nagad_mock_mode', body.mockMode ? 'true' : 'false');
    }
    if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
      const check = validateExternalUrl(body.baseUrl);
      if (!check.valid) {
        res.status(400).json({ ok: false, error: 'INVALID_URL', message: check.error });
        return;
      }
      setSetting('nagad_base_url', body.baseUrl.trim().replace(/\/+$/, ''));
    }
    if (typeof body.checkPath === 'string' && body.checkPath.trim()) {
      const p = sanitizeText(body.checkPath, 160);
      setSetting('nagad_check_path', p.startsWith('/') ? p : `/${p}`);
    }
    if (typeof body.userAspId === 'string' && body.userAspId.trim()) {
      setSetting('nagad_user_asp_id', sanitizeText(body.userAspId, 64));
    }
    if (typeof body.userAgent === 'string' && body.userAgent.trim()) {
      setSetting('nagad_user_agent', sanitizeText(body.userAgent, 64));
    }
    if (typeof body.acceptLanguage === 'string' && body.acceptLanguage.trim()) {
      setSetting('nagad_accept_language', sanitizeText(body.acceptLanguage, 16));
    }
    if (typeof body.appCode === 'string' && body.appCode.trim()) {
      setSetting('nagad_app_code', sanitizeText(body.appCode, 16));
    }
    if (typeof body.httpUserAgent === 'string' && body.httpUserAgent.trim()) {
      setSetting('nagad_http_user_agent', sanitizeText(body.httpUserAgent, 120));
    }
    if (body.timeoutSeconds !== undefined) {
      const t = Number.parseInt(String(body.timeoutSeconds), 10);
      if (Number.isFinite(t) && t >= 1 && t <= 30) {
        setSetting('nagad_timeout_seconds', String(t));
      }
    }

    const updated = getNagadStatus();
    recordApiLog(req, 200, performance.now() - start, 'nagad', { action: 'update_config' }, { mode: updated.mode });
    res.json({ ok: true, ...updated });
  });

  app.all('/api/v1/nagad/check', requireAuth, async (req: AuthedRequest, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST.' });
      return;
    }
    const start = performance.now();
    const rawMsisdn = req.method === 'GET' ? req.query.msisdn : req.body?.msisdn;
    const result = await runNagadCheck(rawMsisdn);
    recordApiLog(
      req,
      result.status,
      performance.now() - start,
      'nagad',
      { msisdn: typeof rawMsisdn === 'string' ? rawMsisdn : 'invalid' },
      { ok: result.data.ok, mode: result.data.mode }
    );
    res.status(result.status).json(result.data);
  });

  // --- Truecaller API Routes ---
  app.get('/api/v1/truecaller/status', requireAuth, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const status = getTruecallerStatus();
    recordApiLog(req, 200, performance.now() - start, 'truecaller', {}, { mode: status.mode });
    res.json({ ok: true, ...status });
  });

  app.post('/api/v1/truecaller/status', requireAdminSession, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const body = req.body || {};
    if (typeof body.mockMode === 'boolean') {
      setSetting('truecaller_mock_mode', body.mockMode ? 'true' : 'false');
    }
    if (typeof body.apiUrl === 'string') {
      const trimmed = body.apiUrl.trim();
      if (trimmed) {
        const check = validateExternalUrl(trimmed);
        if (!check.valid) {
          res.status(400).json({ ok: false, error: 'INVALID_URL', message: check.error });
          return;
        }
      }
      setSetting('truecaller_api_url', trimmed);
    }
    if (body.timeoutSeconds !== undefined) {
      const t = Number.parseInt(String(body.timeoutSeconds), 10);
      if (Number.isFinite(t) && t >= 1 && t <= 30) {
        setSetting('truecaller_timeout_seconds', String(t));
      }
    }
    const updated = getTruecallerStatus();
    recordApiLog(req, 200, performance.now() - start, 'truecaller', { action: 'update_config' }, { mode: updated.mode });
    res.json({ ok: true, ...updated });
  });

  app.all('/api/v1/truecaller/lookup', requireAuth, async (req: AuthedRequest, res: Response) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Use GET or POST.' });
      return;
    }
    const start = performance.now();
    const rawPhone = req.method === 'GET' ? req.query.phone : req.body?.phone;
    const result = await runTruecallerLookup(rawPhone);
    recordApiLog(
      req,
      result.status,
      performance.now() - start,
      'truecaller',
      { phone: typeof rawPhone === 'string' ? rawPhone : 'invalid' },
      { ok: result.data.ok, mode: result.data.mode }
    );
    res.status(result.status).json(result.data);
  });

  // --- Integrations Catalog ---
  app.get('/api/v1/integrations', requireAuth, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const nagad = getNagadStatus();
    const truecaller = getTruecallerStatus();
    const integrations = [
      {
        id: 'nagad',
        name: 'Nagad Authorized Gateway',
        category: 'Financial Identity',
        route: '/Nagat',
        apiBase: '/api/v1/nagad',
        mode: nagad.mode,
        status: 'active',
        description: 'Authorized MSISDN login-eligibility check with configurable gateway headers and mock sandbox.',
        endpoints: [
          { method: 'GET', path: '/api/v1/nagad/status', auth: 'Required' },
          { method: 'GET / POST', path: '/api/v1/nagad/check', auth: 'Required' },
        ],
      },
      {
        id: 'truecaller',
        name: 'Truecaller Caller Lookup',
        category: 'Caller Verification',
        route: '/Truecaller',
        apiBase: '/api/v1/truecaller',
        mode: truecaller.mode,
        status: 'active',
        description: 'Authorized E.164 phone directory lookup with validation, timeout protection, and mock mode.',
        endpoints: [
          { method: 'GET', path: '/api/v1/truecaller/status', auth: 'Required' },
          { method: 'GET / POST', path: '/api/v1/truecaller/lookup', auth: 'Required' },
        ],
      },
    ];
    recordApiLog(req, 200, performance.now() - start, 'core', {}, { count: integrations.length });
    res.json({ ok: true, integrations });
  });

  app.post('/api/v1/integrations', requireAdminSession, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const integration = sanitizeText(req.body?.integration, 32);
    const mode = req.body?.mode === 'live' ? 'live' : 'mock';
    if (integration === 'nagad') {
      setSetting('nagad_mock_mode', mode === 'mock' ? 'true' : 'false');
    } else if (integration === 'truecaller') {
      setSetting('truecaller_mock_mode', mode === 'mock' ? 'true' : 'false');
    } else {
      res.status(400).json({ ok: false, error: 'UNKNOWN_INTEGRATION', message: 'Supported: nagad, truecaller.' });
      return;
    }
    recordApiLog(req, 200, performance.now() - start, integration, { action: 'toggle_mode', mode }, { ok: true });
    broadcastTelemetryUpdate();
    res.json({ ok: true, integration, mode });
  });

  // --- Logs ---
  app.get('/api/v1/logs', requireAuth, (req: AuthedRequest, res: Response) => {
    const limit = Math.min(Math.max(Number.parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    const integrationFilter = typeof req.query.integration === 'string' ? sanitizeText(req.query.integration, 32) : '';
    const rows = integrationFilter
      ? db
          .prepare(
            `SELECT id, method, path, status_code, latency_ms, client_ip, actor, integration, request_meta, response_summary, created_at
             FROM request_logs WHERE integration = ? ORDER BY id DESC LIMIT ?`
          )
          .all(integrationFilter, limit)
      : db
          .prepare(
            `SELECT id, method, path, status_code, latency_ms, client_ip, actor, integration, request_meta, response_summary, created_at
             FROM request_logs ORDER BY id DESC LIMIT ?`
          )
          .all(limit);

    res.json({ ok: true, logs: rows });
  });

  app.post('/api/v1/logs', requireAdminSession, (req: AuthedRequest, res: Response) => {
    const action = sanitizeText(req.body?.action, 32);
    if (action === 'clear') {
      db.prepare('DELETE FROM request_logs').run();
      recordApiLog(req, 200, 2, 'core', { action: 'clear_logs' }, { cleared: true });
      res.json({ ok: true, cleared: true });
      return;
    }
    res.status(400).json({ ok: false, error: 'INVALID_ACTION', message: 'Supported action: clear.' });
  });

  // --- Server Settings ---
  app.get('/api/v1/settings', requireAdminSession, (_req: AuthedRequest, res: Response) => {
    const settings = getAllSettings();
    res.json({
      ok: true,
      settings: {
        rate_limit_per_minute: Number.parseInt(settings.rate_limit_per_minute || '60', 10),
        session_ttl_minutes: Number.parseInt(settings.session_ttl_minutes || '60', 10),
        log_redaction_enabled: settings.log_redaction_enabled === 'true',
        nagad_mock_mode: settings.nagad_mock_mode === 'true',
        truecaller_mock_mode: settings.truecaller_mock_mode === 'true',
      },
    });
  });

  app.post('/api/v1/settings', requireAdminSession, (req: AuthedRequest, res: Response) => {
    const start = performance.now();
    const body = req.body || {};
    if (body.rate_limit_per_minute !== undefined) {
      const rl = Number.parseInt(String(body.rate_limit_per_minute), 10);
      if (!Number.isFinite(rl) || rl < 5 || rl > 5000) {
        res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'Rate limit must be between 5 and 5000.' });
        return;
      }
      setSetting('rate_limit_per_minute', String(rl));
    }
    if (body.session_ttl_minutes !== undefined) {
      const ttl = Number.parseInt(String(body.session_ttl_minutes), 10);
      if (!Number.isFinite(ttl) || ttl < 5 || ttl > 1440) {
        res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', message: 'Session TTL must be 5–1440 minutes.' });
        return;
      }
      setSetting('session_ttl_minutes', String(ttl));
    }
    if (typeof body.log_redaction_enabled === 'boolean') {
      setSetting('log_redaction_enabled', body.log_redaction_enabled ? 'true' : 'false');
    }
    if (typeof body.nagad_mock_mode === 'boolean') {
      setSetting('nagad_mock_mode', body.nagad_mock_mode ? 'true' : 'false');
    }
    if (typeof body.truecaller_mock_mode === 'boolean') {
      setSetting('truecaller_mock_mode', body.truecaller_mock_mode ? 'true' : 'false');
    }

    recordApiLog(req, 200, performance.now() - start, 'settings', { action: 'update_settings' }, { saved: true });
    res.json({ ok: true, message: 'Server settings updated.' });
  });

  // --- Read-only Flask Source Explorer for /infinity-network export ---
  app.get('/api/v1/flask-project', requireAuth, (req: AuthedRequest, res: Response) => {
    const baseDir = path.resolve(process.cwd(), 'infinity-network');
    if (!fs.existsSync(baseDir)) {
      res.json({ ok: true, files: [] });
      return;
    }

    const fileList: Array<{ path: string; size: number }> = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('__pycache__') || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else {
          const rel = path.relative(baseDir, full).replace(/\\/g, '/');
          fileList.push({ path: rel, size: fs.statSync(full).size });
        }
      }
    };
    walk(baseDir);
    fileList.sort((a, b) => a.path.localeCompare(b.path));

    const requestedFile = typeof req.query.file === 'string' ? req.query.file : '';
    if (requestedFile) {
      const resolved = path.resolve(baseDir, requestedFile);
      if (!resolved.startsWith(baseDir + path.sep) || !fs.existsSync(resolved)) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND', message: 'File not found.' });
        return;
      }
      const content = fs.readFileSync(resolved, 'utf8');
      res.json({ ok: true, file: requestedFile, content });
      return;
    }

    res.json({ ok: true, files: fileList });
  });

  // --- Initial snapshot endpoint for authenticated dashboard ---
  app.get('/api/v1/dashboard/snapshot', requireAuth, (_req: AuthedRequest, res: Response) => {
    res.json({ ok: true, ...buildTelemetrySnapshot() });
  });

  // Fallback 404 for unknown /api/v1/* routes
  app.use('/api/v1', (req: AuthedRequest, res: Response) => {
    res.status(404).json({
      ok: false,
      error: 'ENDPOINT_NOT_FOUND',
      message: `No API route registered for ${req.method} ${req.originalUrl}`,
    });
  });

  // --- Vite / Static Frontend Serving ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`INFINITY NETWORK listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
