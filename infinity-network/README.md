# INFINITY NETWORK — API Management Platform

Production-ready Python Flask API gateway and dark developer dashboard with SQLite persistence, Server-Sent Events (SSE) live telemetry, Flask-Login session authentication, CSRF protection, rate limiting, sensitive log redaction, and configurable authorized Nagad & Truecaller integrations.

## Project Structure

```text
infinity-network/
├── app.py
├── config.py
├── requirements.txt
├── .env.example
├── database/
│   └── database.py
├── routes/
│   ├── auth_helpers.py
│   ├── web.py
│   ├── api.py
│   ├── nagad.py
│   └── truecaller.py
├── services/
│   ├── nagad_service.py
│   ├── truecaller_service.py
│   └── realtime_service.py
├── templates/
│   ├── base.html
│   ├── dashboard.html
│   ├── me.html
│   ├── nagad.html
│   ├── truecaller.html
│   ├── all.html
│   ├── login.html
│   └── settings.html
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── README.md
```

## Installation & Running Locally

1. Create and activate a virtual environment:

```bash
cd infinity-network
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Configure environment variables:

```bash
cp .env.example .env
# Edit .env to set FLASK_SECRET_KEY and optional ADMIN_PASSWORD / integration credentials
```

4. Start the server:

```bash
python app.py
```

Open `http://127.0.0.1:5000` in your browser. If `ADMIN_PASSWORD` is left blank in `.env`, navigate to `/login` to claim your initial administrator password.

## Sample API Requests & Responses

### Health Check

```bash
curl -s http://127.0.0.1:5000/api/v1/health
```

```json
{
  "ok": true,
  "service": "INFINITY NETWORK",
  "status": "healthy",
  "database": "connected",
  "uptime_seconds": 14,
  "timestamp": "2026-11-23T22:15:00+00:00"
}
```

### Nagad Authorized Status Check (Mock Mode)

```bash
curl -s "http://127.0.0.1:5000/api/v1/nagad/check?msisdn=01625116266" \
  -H "X-API-Key: inf_your_api_key_here"
```

```json
{
  "ok": true,
  "mode": "mock",
  "msisdn": "01625116266",
  "request_reference": {
    "method": "GET",
    "url": "https://app.mynagad.com:20002/api/user/check-user-status-for-log-in?msisdn=01625116266",
    "headers": {
      "X-KM-User-AspId": "100012345612345",
      "X-KM-User-Agent": "ANDROID/2113",
      "X-KM-DEVICE-FGP": "[REDACTED]",
      "X-KM-Accept-language": "bn",
      "X-KM-AppCode": "01",
      "Accept-Encoding": "gzip",
      "User-Agent": "okhttp/5.0.0-alpha.7"
    }
  },
  "upstream_response": {
    "status": "ACTIVE",
    "userStatus": "REGISTERED_ACTIVE",
    "msisdn": "01625116266",
    "acceptLanguage": "bn",
    "eligibleForAuthorizedCheck": true
  }
}
```

### Truecaller Phone Lookup (Mock Mode)

```bash
curl -s -X POST http://127.0.0.1:5000/api/v1/truecaller/lookup \
  -H "Content-Type: application/json" \
  -H "X-API-Key: inf_your_api_key_here" \
  -d '{"phone": "+8801625116266"}'
```

```json
{
  "ok": true,
  "mode": "mock",
  "query": "+8801625116266",
  "country_code": "BD",
  "result": {
    "e164": "+8801625116266",
    "display_name": "Verified Subscriber #6266",
    "carrier": "Robi Axiata",
    "line_type": "mobile",
    "spam_score": 0,
    "verified_badge": false
  }
}
```
