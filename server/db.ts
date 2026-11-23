import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DB_PATH = path.resolve(process.cwd(), process.env.SQLITE_DB_PATH || 'infinity_network.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    created_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    client_ip TEXT NOT NULL,
    actor TEXT NOT NULL,
    integration TEXT NOT NULL,
    request_meta TEXT NOT NULL,
    response_summary TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const defaultSettings: Record<string, string> = {
  rate_limit_per_minute: String(process.env.RATE_LIMIT_PER_MINUTE || '60'),
  session_ttl_minutes: String(process.env.SESSION_TTL_MINUTES || '60'),
  log_redaction_enabled: 'true',
  nagad_mock_mode: process.env.NAGAD_MOCK_MODE === 'false' ? 'false' : 'true',
  nagad_base_url: process.env.NAGAD_BASE_URL || 'https://app.mynagad.com:20002',
  nagad_check_path: process.env.NAGAD_CHECK_PATH || '/api/user/check-user-status-for-log-in',
  nagad_user_asp_id: process.env.NAGAD_USER_ASP_ID || '100012345612345',
  nagad_user_agent: process.env.NAGAD_USER_AGENT || 'ANDROID/2113',
  nagad_accept_language: process.env.NAGAD_ACCEPT_LANGUAGE || 'bn',
  nagad_app_code: process.env.NAGAD_APP_CODE || '01',
  nagad_http_user_agent: process.env.NAGAD_HTTP_USER_AGENT || 'okhttp/5.0.0-alpha.7',
  nagad_timeout_seconds: process.env.NAGAD_TIMEOUT_SECONDS || '8',
  truecaller_mock_mode: process.env.TRUECALLER_MOCK_MODE === 'false' ? 'false' : 'true',
  truecaller_api_url: process.env.TRUECALLER_API_URL || '',
  truecaller_timeout_seconds: process.env.TRUECALLER_TIMEOUT_SECONDS || '8',
};

const insertSettingStmt = db.prepare(
  'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
);
const nowIso = new Date().toISOString();
for (const [k, v] of Object.entries(defaultSettings)) {
  insertSettingStmt.run(k, v, nowIso);
}

// Seed initial request logs only if table is completely empty so live telemetry works cleanly on first boot
const logCountRow = db.prepare('SELECT COUNT(*) as cnt FROM request_logs').get() as { cnt: number };
if (logCountRow.cnt === 0) {
  const seedLogStmt = db.prepare(`
    INSERT INTO request_logs
      (method, path, status_code, latency_ms, client_ip, actor, integration, request_meta, response_summary, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const t0 = new Date(Date.now() - 180000).toISOString();
  const t1 = new Date(Date.now() - 95000).toISOString();
  seedLogStmt.run(
    'GET',
    '/api/v1/health',
    200,
    4,
    '127.0.0.1',
    'system',
    'core',
    JSON.stringify({ check: 'startup_probe' }),
    JSON.stringify({ status: 'healthy', database: 'connected' }),
    t0
  );
  seedLogStmt.run(
    'GET',
    '/api/v1/integrations',
    200,
    7,
    '127.0.0.1',
    'system',
    'core',
    JSON.stringify({ filter: 'all' }),
    JSON.stringify({ count: 2 }),
    t1
  );
}

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? row.value : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(key, value, new Date().toISOString());
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function getMetricsSummary() {
  const totals = db
    .prepare(
      `SELECT
        COUNT(*) as total_requests,
        COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END), 0) as success_requests,
        COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) as failed_requests,
        COALESCE(ROUND(AVG(latency_ms), 1), 0) as avg_latency_ms
      FROM request_logs`
    )
    .get() as {
    total_requests: number;
    success_requests: number;
    failed_requests: number;
    avg_latency_ms: number;
  };

  const recent = db
    .prepare(
      `SELECT id, method, path, status_code, latency_ms, client_ip, actor, integration, request_meta, response_summary, created_at
       FROM request_logs
       ORDER BY id DESC
       LIMIT 25`
    )
    .all() as Array<{
    id: number;
    method: string;
    path: string;
    status_code: number;
    latency_ms: number;
    client_ip: string;
    actor: string;
    integration: string;
    request_meta: string;
    response_summary: string;
    created_at: string;
  }>;

  return {
    total_requests: totals.total_requests,
    success_requests: totals.success_requests,
    failed_requests: totals.failed_requests,
    avg_latency_ms: totals.avg_latency_ms,
    recent_logs: recent,
  };
}

export function ensureEnvAdminUser(): { id: number; username: string; display_name: string; email: string; role: string } | null {
  const envPass = process.env.ADMIN_PASSWORD?.trim();
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  if (!envPass) return null;

  let user = db
    .prepare('SELECT id, username, display_name, email, role FROM users WHERE username = ?')
    .get(username) as { id: number; username: string; display_name: string; email: string; role: string } | undefined;

  if (!user) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(envPass, salt, 64).toString('hex');
    const hash = `scrypt:${salt}:${derived}`;
    db.prepare(
      'INSERT INTO users (username, display_name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, 'Platform Administrator', 'admin@infinity.network', 'admin', hash, new Date().toISOString());
    user = db
      .prepare('SELECT id, username, display_name, email, role FROM users WHERE username = ?')
      .get(username) as { id: number; username: string; display_name: string; email: string; role: string };
  }
  return user;
}
