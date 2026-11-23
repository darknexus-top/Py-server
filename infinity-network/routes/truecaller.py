import time

from flask import Blueprint, jsonify, request

from database.database import set_setting
from routes.auth_helpers import apply_rate_limit, log_and_broadcast, require_api_auth
from services.realtime_service import validate_external_url
from services.truecaller_service import get_truecaller_status, lookup_truecaller_phone

truecaller_bp = Blueprint("truecaller", __name__, url_prefix="/api/v1/truecaller")


@truecaller_bp.route("/status", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def truecaller_status(actor_label, _user):
    start = time.perf_counter()
    if request.method == "GET":
        cfg = get_truecaller_status()
        latency = int((time.perf_counter() - start) * 1000) + 1
        log_and_broadcast(200, latency, "truecaller", actor_label, {}, {"mode": cfg["mode"]})
        return jsonify({"ok": True, **cfg}), 200

    if not actor_label.startswith("admin:"):
        return jsonify({"ok": False, "error": "ADMIN_SESSION_REQUIRED"}), 401

    body = request.get_json(silent=True) or {}
    if isinstance(body.get("mockMode"), bool):
        set_setting("truecaller_mock_mode", "true" if body["mockMode"] else "false")
    if isinstance(body.get("apiUrl"), str):
        cleaned = body["apiUrl"].strip()
        if cleaned:
            ok, err = validate_external_url(cleaned)
            if not ok:
                return jsonify({"ok": False, "error": "INVALID_URL", "message": err}), 400
        set_setting("truecaller_api_url", cleaned)
    if "timeoutSeconds" in body:
        t = max(1, min(int(body["timeoutSeconds"]), 30))
        set_setting("truecaller_timeout_seconds", str(t))

    updated = get_truecaller_status()
    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(200, latency, "truecaller", actor_label, {"action": "update_config"}, {"mode": updated["mode"]})
    return jsonify({"ok": True, **updated}), 200


@truecaller_bp.route("/lookup", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def truecaller_lookup(actor_label, _user):
    start = time.perf_counter()
    if request.method == "GET":
        raw_phone = request.args.get("phone")
    else:
        body = request.get_json(silent=True) or {}
        raw_phone = body.get("phone")

    status_code, data = lookup_truecaller_phone(raw_phone)
    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(
        status_code,
        latency,
        "truecaller",
        actor_label,
        {"phone": raw_phone if isinstance(raw_phone, str) else "invalid"},
        {"ok": data.get("ok"), "mode": data.get("mode")},
    )
    return jsonify(data), status_code
