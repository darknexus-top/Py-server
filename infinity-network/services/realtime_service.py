import ipaddress
import json
import queue
import re
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Generator, List, Tuple
from urllib.parse import urlparse

from database.database import get_metrics_summary, get_setting

SERVER_START_TIME = time.monotonic()

_SENSITIVE_PATTERN = re.compile(
    r"(password|passcode|otp|token|secret|api[-_]?key|authorization|x-api-key|device[-_]?fgp|fingerprint|cookie|csrf)",
    re.IGNORECASE,
)

_rate_lock = threading.Lock()
_rate_buckets: Dict[str, Tuple[int, float]] = {}

_sse_lock = threading.Lock()
_sse_subscribers: List[queue.Queue] = []


def get_uptime_seconds() -> int:
    return int(time.monotonic() - SERVER_START_TIME)


def mask_secret(value: str) -> str:
    cleaned = (value or "").strip()
    if not cleaned:
        return "Not configured"
    if len(cleaned) <= 6:
        return "Configured (••••••)"
    return f"Configured (••••{cleaned[-4:]})"


def sanitize_text(value: Any, max_len: int = 120) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x1f\x7f<>]", "", value).strip()
    return cleaned[:max_len]


def redact_sensitive_data(data: Any, depth: int = 0) -> Any:
    if depth > 6 or data is None:
        return data
    if isinstance(data, str):
        if data.lower().startswith("bearer "):
            return "Bearer [REDACTED]"
        return data[:512]
    if isinstance(data, list):
        return [redact_sensitive_data(item, depth + 1) for item in data[:25]]
    if isinstance(data, dict):
        result: Dict[str, Any] = {}
        for k, v in data.items():
            if _SENSITIVE_PATTERN.search(str(k)):
                result[k] = "[REDACTED]"
            else:
                result[k] = redact_sensitive_data(v, depth + 1)
        return result
    return data


def validate_external_url(raw_url: str) -> Tuple[bool, str]:
    try:
        parsed = urlparse(raw_url.strip())
    except Exception:
        return False, "Invalid URL format."
    if parsed.scheme not in ("http", "https"):
        return False, "Only http:// and https:// endpoints are permitted."
    host = (parsed.hostname or "").lower()
    if not host or host == "localhost" or host.endswith(".local"):
        return False, "Loopback and local hostnames are blocked."
    try:
        ip_obj = ipaddress.ip_address(host)
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_reserved
            or ip_obj.is_multicast
        ):
            return False, "Private, loopback, and link-local IP ranges are blocked."
    except ValueError:
        pass
    return True, ""


def check_rate_limit(client_key: str) -> Tuple[bool, int, int, int]:
    try:
        limit = max(5, min(int(get_setting("rate_limit_per_minute", "60")), 5000))
    except ValueError:
        limit = 60

    now = time.time()
    window = 60.0
    with _rate_lock:
        count, reset_at = _rate_buckets.get(client_key, (0, now + window))
        if now >= reset_at:
            count = 0
            reset_at = now + window
        count += 1
        _rate_buckets[client_key] = (count, reset_at)
        allowed = count <= limit
        remaining = max(0, limit - count)
        return allowed, limit, remaining, int(reset_at)


def build_telemetry_snapshot() -> Dict[str, Any]:
    summary = get_metrics_summary(limit=25)
    return {
        "online": True,
        "uptime_seconds": get_uptime_seconds(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": {
            "total_requests": summary["total_requests"],
            "success_requests": summary["success_requests"],
            "failed_requests": summary["failed_requests"],
            "avg_latency_ms": summary["avg_latency_ms"],
        },
        "integrations": {
            "nagad": {
                "mode": "mock" if get_setting("nagad_mock_mode", "true") == "true" else "live",
                "status": "ready",
            },
            "truecaller": {
                "mode": "mock" if get_setting("truecaller_mock_mode", "true") == "true" else "live",
                "status": "ready",
            },
        },
        "recent_logs": summary["recent_logs"],
    }


def broadcast_telemetry_update(snapshot: Dict[str, Any]) -> None:
    payload = f"event: snapshot\ndata: {json.dumps(snapshot)}\n\n"
    with _sse_lock:
        dead: List[queue.Queue] = []
        for q in _sse_subscribers:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            if q in _sse_subscribers:
                _sse_subscribers.remove(q)


def sse_event_stream(initial_snapshot: Dict[str, Any]) -> Generator[str, None, None]:
    q: queue.Queue = queue.Queue(maxsize=32)
    with _sse_lock:
        _sse_subscribers.append(q)

    try:
        yield f"event: snapshot\ndata: {json.dumps(initial_snapshot)}\n\n"
        while True:
            try:
                msg = q.get(timeout=3.0)
                yield msg
            except queue.Empty:
                hb = {
                    "online": True,
                    "uptime_seconds": get_uptime_seconds(),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                yield f"event: heartbeat\ndata: {json.dumps(hb)}\n\n"
    finally:
        with _sse_lock:
            if q in _sse_subscribers:
                _sse_subscribers.remove(q)
