import os
import secrets
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Application configuration loaded from environment variables."""

    APP_NAME = "INFINITY NETWORK"
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY") or secrets.token_urlsafe(32)
    DATABASE_PATH = os.environ.get("SQLITE_DB_PATH", "infinity_network.db")

    # Session & Cookie Security
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"
    PERMANENT_SESSION_LIFETIME = timedelta(
        minutes=int(os.environ.get("SESSION_TTL_MINUTES", "60"))
    )

    # Admin Credentials (optional env override; if unset, first-run setup claims admin password)
    ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

    # Rate Limiting
    DEFAULT_RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "60"))

    # Nagad Authorized API Configuration
    NAGAD_MOCK_MODE = os.environ.get("NAGAD_MOCK_MODE", "true").lower() != "false"
    NAGAD_BASE_URL = os.environ.get("NAGAD_BASE_URL", "https://app.mynagad.com:20002")
    NAGAD_CHECK_PATH = os.environ.get(
        "NAGAD_CHECK_PATH", "/api/user/check-user-status-for-log-in"
    )
    NAGAD_USER_ASP_ID = os.environ.get("NAGAD_USER_ASP_ID", "100012345612345")
    NAGAD_USER_AGENT = os.environ.get("NAGAD_USER_AGENT", "ANDROID/2113")
    NAGAD_DEVICE_FGP = os.environ.get("NAGAD_DEVICE_FGP", "")
    NAGAD_ACCEPT_LANGUAGE = os.environ.get("NAGAD_ACCEPT_LANGUAGE", "bn")
    NAGAD_APP_CODE = os.environ.get("NAGAD_APP_CODE", "01")
    NAGAD_HTTP_USER_AGENT = os.environ.get(
        "NAGAD_HTTP_USER_AGENT", "okhttp/5.0.0-alpha.7"
    )
    NAGAD_API_KEY = os.environ.get("NAGAD_API_KEY", "")
    NAGAD_TIMEOUT_SECONDS = int(os.environ.get("NAGAD_TIMEOUT_SECONDS", "8"))

    # Truecaller Authorized API Configuration
    TRUECALLER_MOCK_MODE = os.environ.get("TRUECALLER_MOCK_MODE", "true").lower() != "false"
    TRUECALLER_API_URL = os.environ.get("TRUECALLER_API_URL", "")
    TRUECALLER_API_KEY = os.environ.get("TRUECALLER_API_KEY", "")
    TRUECALLER_TIMEOUT_SECONDS = int(os.environ.get("TRUECALLER_TIMEOUT_SECONDS", "8"))
