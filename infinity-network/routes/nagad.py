import time

from flask import Blueprint, jsonify, request

from database.database import set_setting
from routes.auth_helpers import apply_rate_limit, log_and_broadcast, require_api_auth
from services.nagad_service import check_nagad_user_status, get_nagad_status
from services.realtime_service import sanitize_text, validate_external_url

nagad_bp = Blueprint("nagad", __name__, url_prefix="/api/v1/nagad")


@nagad_bp.route("/status", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def nagad_status(actor_label, _user):
    start = time.perf_counter()
    if request.method == "GET":
        cfg = get_nagad_status()
        latency = int((time.perf_counter() - start) * 1000) + 1
        log_and_broadcast(200, latency, "nagad", actor_label, {}, {"mode": cfg["mode"]})
        return jsonify({"ok": True, **cfg}), 200

    if not actor_label.startswith("admin:"):
        return jsonify({"ok": False, "error": "ADMIN_SESSION_REQUIRED"}), 401

    body = request.get_json(silent=True) or {}
    if isinstance(body.get("mockMode"), bool):
        set_setting("nagad_mock_mode", "true" if body["mockMode"] else "false")
    if isinstance(body.get("baseUrl"), str) and body["baseUrl"].strip():
        ok, err = validate_external_url(body["baseUrl"])
        if not ok:
            return jsonify({"ok": False, "error": "INVALID_URL", "message": err}), 400
        set_setting("nagad_base_url", body["baseUrl"].strip().rstrip("/"))
    if isinstance(body.get("checkPath"), str) and body["checkPath"].strip():
        p = sanitize_text(body["checkPath"], 160)
        set_setting("nagad_check_path", p if p.startswith("/") else f"/{p}")
    if isinstance(body.get("userAspId"), str) and body["userAspId"].strip():
        set_setting("nagad_user_asp_id", sanitize_text(body["userAspId"], 64))
    if isinstance(body.get("userAgent"), str) and body["userAgent"].strip():
        set_setting("nagad_user_agent", sanitize_text(body["userAgent"], 64))
    if isinstance(body.get("acceptLanguage"), str) and body["acceptLanguage"].strip():
        set_setting("nagad_accept_language", sanitize_text(body["acceptLanguage"], 16))
    if isinstance(body.get("appCode"), str) and body["appCode"].strip():
        set_setting("nagad_app_code", sanitize_text(body["appCode"], 16))
    if isinstance(body.get("httpUserAgent"), str) and body["httpUserAgent"].strip():
        set_setting("nagad_http_user_agent", sanitize_text(body["httpUserAgent"], 120))
    if "timeoutSeconds" in body:
        t = max(1, min(int(body["timeoutSeconds"]), 30))
        set_setting("nagad_timeout_seconds", str(t))

    updated = get_nagad_status()
    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(200, latency, "nagad", actor_label, {"action": "update_config"}, {"mode": updated["mode"]})
    return jsonify({"ok": True, **updated}), 200


@nagad_bp.route("/check", methods=["GET", "POST"])
@apply_rate_limit
@require_api_auth(admin_session_only=False)
def nagad_check(actor_label, _user):
    start = time.perf_counter()
    if request.method == "GET":
        raw_msisdn = request.args.get("msisdn")
    else:
        body = request.get_json(silent=True) or {}
        raw_msisdn = body.get("msisdn")

    status_code, data = check_nagad_user_status(raw_msisdn)
    latency = int((time.perf_counter() - start) * 1000) + 1
    log_and_broadcast(
        status_code,
        latency,
        "nagad",
        actor_label,
        {"msisdn": raw_msisdn if isinstance(raw_msisdn, str) else "invalid"},
        {"ok": data.get("ok"), "mode": data.get("mode")},
    )
    return jsonify(data), status_code
