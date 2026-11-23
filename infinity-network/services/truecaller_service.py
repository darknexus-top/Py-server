import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import requests

from config import Config
from database.database import get_setting
from services.realtime_service import mask_secret, validate_external_url


def normalize_truecaller_phone(raw: Any) -> Tuple[bool, Optional[str], Optional[str], Optional[str]]:
    if not isinstance(raw, str):
        return False, None, None, "Phone number must be a string."
    cleaned = re.sub(r"[\s\-()]", "", raw)
    if re.match(r"^01[3-9]\d{8}$", cleaned):
        normalized = "+880" + cleaned[1:]
    elif re.match(r"^\+[1-9]\d{6,14}$", cleaned):
        normalized = cleaned
    else:
        return (
            False,
            None,
            None,
            "Invalid phone format. Provide E.164 (e.g. +8801625116266) or 11-digit BD mobile.",
        )

    country = "BD" if normalized.startswith("+880") else ("US" if normalized.startswith("+1") else "INTL")
    return True, normalized, country, None


def get_truecaller_status() -> Dict[str, Any]:
    is_mock = get_setting("truecaller_mock_mode", "true") == "true"
    api_url = get_setting("truecaller_api_url", Config.TRUECALLER_API_URL)
    timeout_sec = int(get_setting("truecaller_timeout_seconds", str(Config.TRUECALLER_TIMEOUT_SECONDS)) or 8)

    return {
        "integration": "truecaller",
        "enabled": True,
        "mode": "mock" if is_mock else "live",
        "api_url": api_url or "Mock Directory Provider (Authorized API URL unset)",
        "credentials_configured": {
            "api_key": mask_secret(Config.TRUECALLER_API_KEY),
        },
        "timeout_seconds": timeout_sec,
    }


def lookup_truecaller_phone(raw_phone: Any) -> Tuple[int, Dict[str, Any]]:
    valid, phone, country, err = normalize_truecaller_phone(raw_phone)
    if not valid or not phone:
        return 400, {
            "ok": False,
            "error": "VALIDATION_ERROR",
            "message": err or "Invalid phone number.",
        }

    is_mock = get_setting("truecaller_mock_mode", "true") == "true"
    api_url = get_setting("truecaller_api_url", Config.TRUECALLER_API_URL)
    timeout_sec = max(1, min(int(get_setting("truecaller_timeout_seconds", "8") or 8), 30))

    if is_mock:
        time.sleep(0.05)
        suffix = phone[-4:]
        carriers = ["Grameenphone", "Robi Axiata", "Banglalink", "Airtel Bangladesh", "Teletalk"]
        carrier = carriers[int(phone[-1]) % len(carriers)]
        is_business = int(phone[-2]) % 3 == 0

        return 200, {
            "ok": True,
            "mode": "mock",
            "query": phone,
            "country_code": country,
            "result": {
                "e164": phone,
                "display_name": f"Apex Logistics Support ({suffix})" if is_business else f"Verified Subscriber #{suffix}",
                "carrier": carrier,
                "line_type": "mobile",
                "spam_score": 0,
                "spam_type": None,
                "verified_badge": is_business,
                "checked_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    url_ok, url_err = validate_external_url(api_url)
    if not url_ok:
        return 400, {
            "ok": False,
            "mode": "live",
            "error": "INVALID_UPSTREAM_URL",
            "message": url_err or "Authorized Truecaller API URL is not configured.",
        }

    if not Config.TRUECALLER_API_KEY:
        return 503, {
            "ok": False,
            "mode": "live",
            "error": "MISSING_CREDENTIALS",
            "message": "Live Truecaller mode requires TRUECALLER_API_KEY environment variable.",
        }

    try:
        resp = requests.get(
            api_url,
            params={"q": phone},
            headers={
                "Authorization": f"Bearer {Config.TRUECALLER_API_KEY}",
                "Accept": "application/json",
            },
            timeout=timeout_sec,
        )
        try:
            body: Any = resp.json()
        except ValueError:
            body = resp.text[:1024]
        return (200 if resp.ok else 502), {
            "ok": resp.ok,
            "mode": "live",
            "query": phone,
            "upstream_status": resp.status_code,
            "result": body,
        }
    except requests.Timeout:
        return 504, {
            "ok": False,
            "mode": "live",
            "error": "UPSTREAM_TIMEOUT",
            "message": f"Truecaller authorized endpoint timed out after {timeout_sec}s.",
        }
    except requests.RequestException:
        return 502, {
            "ok": False,
            "mode": "live",
            "error": "UPSTREAM_CONNECTION_ERROR",
            "message": "Failed to connect to configured Truecaller authorized endpoint.",
        }
