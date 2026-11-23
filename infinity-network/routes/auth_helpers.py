import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, Optional, Tuple

from flask import Request, jsonify, request, session
from flask_login import current_user

from database.database import get_setting, insert_request_log, verify_api_key
from services.realtime_service import (
    broadcast_telemetry_update,
    build_telemetry_snapshot,
    check_rate_limit,
    redact_sensitive_data,
)


def get_or_create_csrf_token() -> str:
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


def verify_csrf(req: Request) -> bool:
    if req.method in ("GET", "HEAD", "OPTIONS"):
        return True
    session_token = session.get("_csrf_token", "")
    supplied = req.headers.get("X-CSRF-Token") or req.form.get("csrf_token") or ""
    if not session_token or not supplied:
        return False
    return hmac.compare_digest(session_token, supplied)


def resolve_api_actor() -> Tuple[Optional[str], Optional[Any]]:
    api_key = request.headers.get("X-API-Key", "").strip()
    if not api_key:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            api_key = auth_header[7:].strip()

    if api_key:
        user = verify_api_key(api_key)
        if user:
            return f"api_key:{api_key[:12]}", user
        return None, None

    if current_user.is_authenticated:
        return f"admin:{current_user.username}", current_user

    return None, None


def log_and_broadcast(
    status_code: int,
    latency_ms: int,
    integration: str,
    actor: str,
    request_meta: Any,
    response_summary: Any,
) -> None:
    redact = get_setting("log_redaction_enabled", "true") == "true"
    safe_req = redact_sensitive_data(request_meta) if redact else request_meta
    safe_res = redact_sensitive_data(response_summary) if redact else response_summary
    insert_request_log(
        method=request.method,
        path=request.path,
        status_code=status_code,
        latency_ms=latency_ms,
        client_ip=request.remote_addr or "127.0.0.1",
        actor=actor,
        integration=integration,
        request_meta=safe_req,
        response_summary=safe_res,
    )
    broadcast_telemetry_update(build_telemetry_snapshot())


def require_api_auth(admin_session_only: bool = False) -> Callable:
    def decorator(fn: Callable) -> Callable:
        @wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            actor_label, user = resolve_api_actor()
            if not user or not actor_label:
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "UNAUTHORIZED",
                            "message": "Authentication required. Sign in or supply X-API-Key.",
                        }
                    ),
                    401,
                )

            if admin_session_only and not actor_label.startswith("admin:"):
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "ADMIN_SESSION_REQUIRED",
                            "message": "Administrator browser session required.",
                        }
                    ),
                    401,
                )

            if actor_label.startswith("admin:") and not verify_csrf(request):
                return (
                    jsonify(
                        {
                            "ok": False,
                            "error": "CSRF_INVALID",
                            "message": "Missing or invalid CSRF token.",
                        }
                    ),
                    403,
                )

            return fn(actor_label, user, *args, **kwargs)

        return wrapper

    return decorator


def apply_rate_limit(fn: Callable) -> Callable:
    @wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        client_ip = request.remote_addr or "unknown"
        allowed, limit, remaining, reset_ts = check_rate_limit(f"{client_ip}:api")
        if not allowed:
            resp = jsonify(
                {
                    "ok": False,
                    "error": "RATE_LIMIT_EXCEEDED",
                    "message": f"Rate limit exceeded ({limit} requests/minute).",
                }
            )
            resp.status_code = 429
            resp.headers["Retry-After"] = "60"
            resp.headers["X-RateLimit-Limit"] = str(limit)
            resp.headers["X-RateLimit-Remaining"] = "0"
            resp.headers["X-RateLimit-Reset"] = str(reset_ts)
            return resp

        result = fn(*args, **kwargs)
        response = result if hasattr(result, "headers") else None
        return result

    return wrapper
