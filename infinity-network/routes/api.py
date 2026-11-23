import hashlib
import secrets
import time
from datetime import datetime, timezone

from flask import Blueprint, Response, jsonify, request, stream_with_context

from database.database import get_all_settings, get_db, get_metrics_summary, get_setting, set_setting
from routes.auth_helpers import apply_rate_limit, log_and_broadcast, require_api_auth
from services.nagad_service import get_nagad_status
from services.realtime_service import (
    build_telemetry_snapshot,
    get_uptime_seconds,
    sanitize_text,
    sse_event_stream,
)
from services.truecaller_service import get_truecaller_status

api_bp = Blueprint("api", __name__, url_prefix="/api/v1")


@api_bp.route("/health", methods=["GET"])
@apply_rate_limit
def health():
    start = time.perf_counter()
    db_ok = True
    try:
        get_db().execute("SELECT 1").fetchone()
    except Exception:
        db_ok = False

    latency = int((time.perf_counter() - start) * 1000) + 1
    payload = {
        "ok": db_ok,
        "service": "INFINITY NETWORK",
        "status": "healthy" if db_ok else "degraded",
        "database": "connected" if db_ok else "error",
        "uptime_seconds": get_uptime_seconds(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    log_and_broadcast(200 if db_ok else 503, latency, "core", "public", {}, {"status": payload["status"]})
    return jsonify(payload), (200 if db_ok else 503)


@api_bp.route("/status", methods=["GET"])
@apply_rate_limit
def status():
    start = time.perf_counter()
    summary = get_metrics_summary()
    payload = {
        "ok": True,
        "online": True,
        "uptime_seconds": get_uptime_seconds(),
        "metrics": {
            "total_requests": summary["total_requests"],
            "success_requests": summary["success_requests"],
            "failed_requests": summary["failed_requests"],
            "avg_latency_ms": summary["avg_latency_ms"],
        },
        "integrations": {
            "nagad": {"mode": get_nagad_status()["mode"], "status": "ready"},
            "truecaller": {"mode": get_truecaller_status()["mode"], "status": "ready"},
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(200, latency, "core", "public", {}, {"online": True})
    return jsonify(payload), 200


@api_bp.route("/stream", methods=["GET"])
@require_api_auth(admin_session_only=False)
def stream(_actor_label, _user):
    initial = build_telemetry_snapshot()
    return Response(
        stream_with_context(sse_event_stream(initial)),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@api_bp.route("/me", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def me(actor_label, user):
    start = time.perf_counter()
    db = get_db()

    if request.method == "GET":
        keys = db.execute(
            "SELECT id, label, key_prefix, last_used_at, created_at, revoked FROM api_keys WHERE user_id = ? ORDER BY id DESC",
            (user.user_id,),
        ).fetchall()
        latency = int((time.perf_counter() - start) * 1000) + 1
        log_and_broadcast(200, latency, "profile", actor_label, {}, {"keys_count": len(keys)})
        return jsonify(
            {
                "ok": True,
                "profile": {
                    "id": user.user_id,
                    "username": user.username,
                    "displayName": user.display_name,
                    "email": user.email,
                    "role": user.role,
                },
                "api_keys": [dict(k) for k in keys],
            }
        )

    if not actor_label.startswith("admin:"):
        return jsonify({"ok": False, "error": "ADMIN_SESSION_REQUIRED"}), 401

    body = request.get_json(silent=True) or {}
    action = sanitize_text(body.get("action", "update_profile"), 40)

    if action == "create_key":
        label = sanitize_text(body.get("label", "API Client Key"), 60) or "API Client Key"
        raw_key = f"inf_{secrets.token_hex(24)}"
        prefix = raw_key[:12]
        key_hash = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()
        db.execute(
            "INSERT INTO api_keys (user_id, label, key_prefix, key_hash, created_at, revoked) VALUES (?, ?, ?, ?, ?, 0)",
            (user.user_id, label, prefix, key_hash, datetime.now(timezone.utc).isoformat()),
        )
        db.commit()
        latency = int((time.perf_counter() - start) * 1000) + 1
        log_and_broadcast(201, latency, "profile", actor_label, {"action": action}, {"key_prefix": prefix})
        return jsonify({"ok": True, "api_key": raw_key, "key_prefix": prefix, "label": label}), 201

    if action == "revoke_key":
        key_id = body.get("keyId")
        if not isinstance(key_id, int) or key_id <= 0:
            return jsonify({"ok": False, "error": "INVALID_KEY_ID"}), 400
        db.execute("UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?", (key_id, user.user_id))
        db.commit()
        latency = int((time.perf_counter() - start) * 1000) + 1
        log_and_broadcast(200, latency, "profile", actor_label, {"action": action, "keyId": key_id}, {"revoked": True})
        return jsonify({"ok": True, "revoked": True, "keyId": key_id}), 200

    display_name = sanitize_text(body.get("displayName", ""), 80)
    email = sanitize_text(body.get("email", ""), 100)
    if not display_name or "@" not in email:
        return jsonify({"ok": False, "error": "VALIDATION_ERROR", "message": "Valid display name and email required."}), 400

    db.execute("UPDATE users SET display_name = ?, email = ? WHERE id = ?", (display_name, email, user.user_id))
    db.commit()
    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(200, latency, "profile", actor_label, {"action": "update_profile"}, {"updated": True})
    return jsonify({"ok": True, "profile": {"displayName": display_name, "email": email}}), 200


@api_bp.route("/integrations", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def integrations(actor_label, _user):
    start = time.perf_counter()
    if request.method == "GET":
        nagad = get_nagad_status()
        truecaller = get_truecaller_status()
        items = [
            {
                "id": "nagad",
                "name": "Nagad Authorized Gateway",
                "category": "Financial Identity",
                "route": "/Nagat",
                "apiBase": "/api/v1/nagad",
                "mode": nagad["mode"],
                "status": "active",
            },
            {
                "id": "truecaller",
                "name": "Truecaller Caller Lookup",
                "category": "Caller Verification",
                "route": "/Truecaller",
                "apiBase": "/api/v1/truecaller",
                "mode": truecaller["mode"],
                "status": "active",
            },
        ]
        latency = int((time.perf_counter() - start) * 1000) + 1
        log_and_broadcast(200, latency, "core", actor_label, {}, {"count": len(items)})
        return jsonify({"ok": True, "integrations": items}), 200

    body = request.get_json(silent=True) or {}
    target = sanitize_text(body.get("integration", ""), 32)
    mode = "live" if body.get("mode") == "live" else "mock"
    if target == "nagad":
        set_setting("nagad_mock_mode", "true" if mode == "mock" else "false")
    elif target == "truecaller":
        set_setting("truecaller_mock_mode", "true" if mode == "mock" else "false")
    else:
        return jsonify({"ok": False, "error": "UNKNOWN_INTEGRATION"}), 400

    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(200, latency, target, actor_label, {"action": "toggle_mode", "mode": mode}, {"ok": True})
    return jsonify({"ok": True, "integration": target, "mode": mode}), 200


@api_bp.route("/logs", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def logs(actor_label, _user):
    db = get_db()
    if request.method == "GET":
        limit = max(1, min(int(request.args.get("limit", 50)), 200))
        integration_filter = sanitize_text(request.args.get("integration", ""), 32)
        if integration_filter:
            rows = db.execute(
                "SELECT * FROM request_logs WHERE integration = ? ORDER BY id DESC LIMIT ?",
                (integration_filter, limit),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM request_logs ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return jsonify({"ok": True, "logs": [dict(r) for r in rows]}), 200

    body = request.get_json(silent=True) or {}
    if body.get("action") == "clear":
        db.execute("DELETE FROM request_logs")
        db.commit()
        log_and_broadcast(200, 1, "core", actor_label, {"action": "clear_logs"}, {"cleared": True})
        return jsonify({"ok": True, "cleared": True}), 200
    return jsonify({"ok": False, "error": "INVALID_ACTION"}), 400


@api_bp.route("/settings", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=True)
def settings(actor_label, _user):
    if request.method == "GET":
        all_cfg = get_all_settings()
        return jsonify(
            {
                "ok": True,
                "settings": {
                    "rate_limit_per_minute": int(all_cfg.get("rate_limit_per_minute", "60")),
                    "session_ttl_minutes": int(all_cfg.get("session_ttl_minutes", "60")),
                    "log_redaction_enabled": all_cfg.get("log_redaction_enabled", "true") == "true",
                    "nagad_mock_mode": all_cfg.get("nagad_mock_mode", "true") == "true",
                    "truecaller_mock_mode": all_cfg.get("truecaller_mock_mode", "true") == "true",
                },
            }
        )

    body = request.get_json(silent=True) or {}
    if "rate_limit_per_minute" in body:
        rl = int(body["rate_limit_per_minute"])
        if rl < 5 or rl > 5000:
            return jsonify({"ok": False, "error": "VALIDATION_ERROR", "message": "Rate limit must be 5-5000."}), 400
        set_setting("rate_limit_per_minute", str(rl))
    if "session_ttl_minutes" in body:
        ttl = int(body["session_ttl_minutes"])
        if ttl < 5 or ttl > 1440:
            return jsonify({"ok": False, "error": "VALIDATION_ERROR", "message": "Session TTL must be 5-1440."}), 400
        set_setting("session_ttl_minutes", str(ttl))
    if isinstance(body.get("log_redaction_enabled"), bool):
        set_setting("log_redaction_enabled", "true" if body["log_redaction_enabled"] else "false")
    if isinstance(body.get("nagad_mock_mode"), bool):
        set_setting("nagad_mock_mode", "true" if body["nagad_mock_mode"] else "false")
    if isinstance(body.get("truecaller_mock_mode"), bool):
        set_setting("truecaller_mock_mode", "true" if body["truecaller_mock_mode"] else "false")

    log_and_broadcast(200, 2, "settings", actor_label, {"action": "update_settings"}, {"saved": True})
    return jsonify({"ok": True, "message": "Server settings updated."}), 200
