import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from flask import g
from flask_login import UserMixin
from werkzeug.security import generate_password_hash

from config import Config


class AdminUser(UserMixin):
    """Flask-Login user model backed by SQLite."""

    def __init__(
        self,
        user_id: int,
        username: str,
        display_name: str,
        email: str,
        role: str,
        password_hash: str,
    ) -> None:
        self.id = str(user_id)
        self.user_id = user_id
        self.username = username
        self.display_name = display_name
        self.email = email
        self.role = role
        self.password_hash = password_hash


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(Config.DATABASE_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def close_db(_error: Optional[BaseException] = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    conn = sqlite3.connect(Config.DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
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
        """
    )

    defaults = {
        "rate_limit_per_minute": str(Config.DEFAULT_RATE_LIMIT_PER_MINUTE),
        "session_ttl_minutes": str(int(Config.PERMANENT_SESSION_LIFETIME.total_seconds() // 60)),
        "log_redaction_enabled": "true",
        "nagad_mock_mode": "true" if Config.NAGAD_MOCK_MODE else "false",
        "nagad_base_url": Config.NAGAD_BASE_URL,
        "nagad_check_path": Config.NAGAD_CHECK_PATH,
        "nagad_user_asp_id": Config.NAGAD_USER_ASP_ID,
        "nagad_user_agent": Config.NAGAD_USER_AGENT,
        "nagad_accept_language": Config.NAGAD_ACCEPT_LANGUAGE,
        "nagad_app_code": Config.NAGAD_APP_CODE,
        "nagad_http_user_agent": Config.NAGAD_HTTP_USER_AGENT,
        "nagad_timeout_seconds": str(Config.NAGAD_TIMEOUT_SECONDS),
        "truecaller_mock_mode": "true" if Config.TRUECALLER_MOCK_MODE else "false",
        "truecaller_api_url": Config.TRUECALLER_API_URL,
        "truecaller_timeout_seconds": str(Config.TRUECALLER_TIMEOUT_SECONDS),
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    for k, v in defaults.items():
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
            (k, v, now_iso),
        )

    if Config.ADMIN_PASSWORD:
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (Config.ADMIN_USERNAME,)
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO users (username, display_name, email, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    Config.ADMIN_USERNAME,
                    "Platform Administrator",
                    "admin@infinity.network",
                    "admin",
                    generate_password_hash(Config.ADMIN_PASSWORD),
                    now_iso,
                ),
            )

    conn.commit()
    conn.close()


def get_setting(key: str, fallback: str = "") -> str:
    row = get_db().execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else fallback


def set_setting(key: str, value: str) -> None:
    db = get_db()
    db.execute(
        """
        INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value, datetime.now(timezone.utc).isoformat()),
    )
    db.commit()


def get_all_settings() -> Dict[str, str]:
    rows = get_db().execute("SELECT key, value FROM settings").fetchall()
    return {row["key"]: row["value"] for row in rows}


def get_user_by_id(user_id: int) -> Optional[AdminUser]:
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return None
    return AdminUser(
        user_id=row["id"],
        username=row["username"],
        display_name=row["display_name"],
        email=row["email"],
        role=row["role"],
        password_hash=row["password_hash"],
    )


def get_user_by_username(username: str) -> Optional[AdminUser]:
    row = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return None
    return AdminUser(
        user_id=row["id"],
        username=row["username"],
        display_name=row["display_name"],
        email=row["email"],
        role=row["role"],
        password_hash=row["password_hash"],
    )


def needs_admin_setup() -> bool:
    if Config.ADMIN_PASSWORD:
        return False
    row = get_db().execute("SELECT COUNT(*) AS cnt FROM users").fetchone()
    return row["cnt"] == 0


def verify_api_key(raw_key: str) -> Optional[AdminUser]:
    if not raw_key:
        return None
    key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
    row = get_db().execute(
        """
        SELECT ak.id AS key_id, u.*
        FROM api_keys ak
        JOIN users u ON u.id = ak.user_id
        WHERE ak.key_hash = ? AND ak.revoked = 0
        """,
        (key_hash,),
    ).fetchone()
    if not row:
        return None
    get_db().execute(
        "UPDATE api_keys SET last_used_at = ? WHERE id = ?",
        (datetime.now(timezone.utc).isoformat(), row["key_id"]),
    )
    get_db().commit()
    return AdminUser(
        user_id=row["id"],
        username=row["username"],
        display_name=row["display_name"],
        email=row["email"],
        role=row["role"],
        password_hash=row["password_hash"],
    )


def insert_request_log(
    method: str,
    path: str,
    status_code: int,
    latency_ms: int,
    client_ip: str,
    actor: str,
    integration: str,
    request_meta: Any,
    response_summary: Any,
) -> int:
    db = get_db()
    cur = db.execute(
        """
        INSERT INTO request_logs
          (method, path, status_code, latency_ms, client_ip, actor, integration, request_meta, response_summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            method,
            path,
            status_code,
            max(1, latency_ms),
            client_ip,
            actor,
            integration,
            json.dumps(request_meta),
            json.dumps(response_summary),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    db.commit()
    return int(cur.lastrowid)


def get_metrics_summary(limit: int = 25) -> Dict[str, Any]:
    db = get_db()
    totals = db.execute(
        """
        SELECT
          COUNT(*) AS total_requests,
          COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END), 0) AS success_requests,
          COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END), 0) AS failed_requests,
          COALESCE(ROUND(AVG(latency_ms), 1), 0) AS avg_latency_ms
        FROM request_logs
        """
    ).fetchone()
    rows = db.execute(
        """
        SELECT id, method, path, status_code, latency_ms, client_ip, actor, integration,
               request_meta, response_summary, created_at
        FROM request_logs
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    recent_logs: List[Dict[str, Any]] = [dict(r) for r in rows]
    return {
        "total_requests": totals["total_requests"],
        "success_requests": totals["success_requests"],
        "failed_requests": totals["failed_requests"],
        "avg_latency_ms": totals["avg_latency_ms"],
        "recent_logs": recent_logs,
    }
