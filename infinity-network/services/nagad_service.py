import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import httpx

from config import Config
from database.database import get_setting
from services.realtime_service import mask_secret, validate_external_url


def normalize_nagad_msisdn(raw: Any) -> Tuple[bool, Optional[str], Optional[str]]:
    if not isinstance(raw, str):
        return False, None, "Phone number (msisdn) must be a string."
    cleaned = re.sub(r"[\s\-()]", "", raw)
    if cleaned.startswith("+880"):
        cleaned = "0" + cleaned[4:]
    elif cleaned.startswith("880"):
        cleaned = "0" + cleaned[3:]

    if not re.match(r"^01[3-9]\d{8}$", cleaned):
        return (
            False,
            None,
            "Invalid Bangladesh MSISDN. Expected 11 digits starting with 013-019 (e.g. 01625116266).",
        )
    return True, cleaned, None


def get_nagad_status() -> Dict[str, Any]:
    is_mock = get_setting("nagad_mock_mode", "true") == "true"
    base_url = get_setting("nagad_base_url", Config.NAGAD_BASE_URL)
    check_path = get_setting("nagad_check_path", Config.NAGAD_CHECK_PATH)
    timeout_sec = int(get_setting("nagad_timeout_seconds", str(Config.NAGAD_TIMEOUT_SECONDS)) or 8)

    return {
        "integration": "nagad",
        "enabled": True,
        "mode": "mock" if is_mock else "live",
        "base_url": base_url,
        "check_path": check_path,
        "headers_preview": {
            "X-KM-User-AspId": get_setting("nagad_user_asp_id", Config.NAGAD_USER_ASP_ID),
            "X-KM-User-Agent": get_setting("nagad_user_agent", Config.NAGAD_USER_AGENT),
            "X-KM-DEVICE-FGP": mask_secret(Config.NAGAD_DEVICE_FGP),
            "X-KM-Accept-language": get_setting("nagad_accept_language", Config.NAGAD_ACCEPT_LANGUAGE),
            "X-KM-AppCode": get_setting("nagad_app_code", Config.NAGAD_APP_CODE),
            "Accept-Encoding": "gzip",
            "User-Agent": get_setting("nagad_http_user_agent", Config.NAGAD_HTTP_USER_AGENT),
        },
        "credentials_configured": {
            "device_fingerprint": mask_secret(Config.NAGAD_DEVICE_FGP),
            "api_key": mask_secret(Config.NAGAD_API_KEY),
        },
        "timeout_seconds": timeout_sec,
    }


def check_nagad_user_status(raw_msisdn: Any) -> Tuple[int, Dict[str, Any]]:
    valid, msisdn, err = normalize_nagad_msisdn(raw_msisdn)
    if not valid or not msisdn:
        return 400, {
            "ok": False,
            "error": "VALIDATION_ERROR",
            "message": err or "Invalid MSISDN.",
        }

    is_mock = get_setting("nagad_mock_mode", "true") == "true"
    base_url = get_setting("nagad_base_url", Config.NAGAD_BASE_URL).rstrip("/")
    check_path = get_setting("nagad_check_path", Config.NAGAD_CHECK_PATH)
    if not check_path.startswith("/"):
        check_path = "/" + check_path
    timeout_sec = max(1, min(int(get_setting("nagad_timeout_seconds", "8") or 8), 30))

    headers = {
        "X-KM-User-AspId": get_setting("nagad_user_asp_id", Config.NAGAD_USER_ASP_ID),
        "X-KM-User-Agent": get_setting("nagad_user_agent", Config.NAGAD_USER_AGENT),
        "X-KM-DEVICE-FGP": Config.NAGAD_DEVICE_FGP or "DEV_SANDBOX_FGP_UNSET",
        "X-KM-Accept-language": get_setting("nagad_accept_language", Config.NAGAD_ACCEPT_LANGUAGE),
        "X-KM-AppCode": get_setting("nagad_app_code", Config.NAGAD_APP_CODE),
        "Accept-Encoding": "gzip",
        "User-Agent": get_setting("nagad_http_user_agent", Config.NAGAD_HTTP_USER_AGENT),
    }
    if Config.NAGAD_API_KEY:
        headers["Authorization"] = f"Bearer {Config.NAGAD_API_KEY}"

    if is_mock:
        time.sleep(0.05)
        last_digit = int(msisdn[-1])
        account_exists = (last_digit % 2 == 0) or (msisdn == "01625116266")
        safe_headers = dict(headers)
        safe_headers["X-KM-DEVICE-FGP"] = "[REDACTED]"
        if "Authorization" in safe_headers:
            safe_headers["Authorization"] = "[REDACTED]"

        return 200, {
            "ok": True,
            "mode": "mock",
            "msisdn": msisdn,
            "request_reference": {
                "method": "GET",
                "url": f"{base_url}{check_path}?msisdn={msisdn}",
                "headers": safe_headers,
            },
            "upstream_response": {
                "status": "ACTIVE" if account_exists else "NOT_REGISTERED",
                "userStatus": "REGISTERED_ACTIVE" if account_exists else "UNREGISTERED",
                "msisdn": msisdn,
                "acceptLanguage": headers["X-KM-Accept-language"],
                "eligibleForAuthorizedCheck": True,
                "checkedAt": datetime.now(timezone.utc).isoformat(),
            },
        }

    target_url = f"{base_url}{check_path}"
    url_ok, url_err = validate_external_url(target_url)
    if not url_ok:
        return 400, {
            "ok": False,
            "mode": "live",
            "error": "INVALID_UPSTREAM_URL",
            "message": url_err,
        }

    if not Config.NAGAD_DEVICE_FGP:
        return 503, {
            "ok": False,
            "mode": "live",
            "error": "MISSING_CREDENTIALS",
            "message": "Live Nagad mode requires NAGAD_DEVICE_FGP environment variable.",
        }

    try:
        with httpx.Client(timeout=timeout_sec) as client:
            resp = client.get(target_url, params={"msisdn": msisdn}, headers=headers)
            try:
                body: Any = resp.json()
            except ValueError:
                body = resp.text[:1024]
            return (200 if resp.is_success else 502), {
                "ok": resp.is_success,
                "mode": "live",
                "msisdn": msisdn,
                "upstream_status": resp.status_code,
                "upstream_response": body,
            }
    except httpx.TimeoutException:
        return 504, {
            "ok": False,
            "mode": "live",
            "error": "UPSTREAM_TIMEOUT",
            "message": f"Nagad authorized endpoint timed out after {timeout_sec}s.",
        }
    except httpx.HTTPError:
        return 502, {
            "ok": False,
            "mode": "live",
            "error": "UPSTREAM_CONNECTION_ERROR",
            "message": "Failed to connect to configured Nagad authorized endpoint.",
        }
