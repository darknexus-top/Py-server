import { getSetting } from './db.ts';
import {
  maskSecret,
  normalizeNagadMsisdn,
  normalizeTruecallerPhone,
  validateExternalUrl,
} from './security.ts';

export interface NagadStatusInfo {
  integration: string;
  enabled: boolean;
  mode: 'mock' | 'live';
  base_url: string;
  check_path: string;
  headers_preview: Record<string, string>;
  credentials_configured: {
    device_fingerprint: string;
    api_key: string;
  };
  timeout_seconds: number;
}

export function getNagadStatus(): NagadStatusInfo {
  const isMock = getSetting('nagad_mock_mode', 'true') === 'true';
  const baseUrl = getSetting('nagad_base_url', 'https://app.mynagad.com:20002');
  const checkPath = getSetting('nagad_check_path', '/api/user/check-user-status-for-log-in');
  const timeoutSec = Number.parseInt(getSetting('nagad_timeout_seconds', '8'), 10) || 8;

  return {
    integration: 'nagad',
    enabled: true,
    mode: isMock ? 'mock' : 'live',
    base_url: baseUrl,
    check_path: checkPath,
    headers_preview: {
      'X-KM-User-AspId': getSetting('nagad_user_asp_id', '100012345612345'),
      'X-KM-User-Agent': getSetting('nagad_user_agent', 'ANDROID/2113'),
      'X-KM-DEVICE-FGP': maskSecret(process.env.NAGAD_DEVICE_FGP),
      'X-KM-Accept-language': getSetting('nagad_accept_language', 'bn'),
      'X-KM-AppCode': getSetting('nagad_app_code', '01'),
      'Accept-Encoding': 'gzip',
      'User-Agent': getSetting('nagad_http_user_agent', 'okhttp/5.0.0-alpha.7'),
    },
    credentials_configured: {
      device_fingerprint: maskSecret(process.env.NAGAD_DEVICE_FGP),
      api_key: maskSecret(process.env.NAGAD_API_KEY),
    },
    timeout_seconds: timeoutSec,
  };
}

export async function runNagadCheck(rawMsisdn: unknown): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const validation = normalizeNagadMsisdn(rawMsisdn);
  if (!validation.valid || !validation.normalized) {
    return {
      status: 400,
      data: {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: validation.error || 'Invalid MSISDN.',
      },
    };
  }

  const msisdn = validation.normalized;
  const isMock = getSetting('nagad_mock_mode', 'true') === 'true';
  const baseUrl = getSetting('nagad_base_url', 'https://app.mynagad.com:20002');
  const checkPath = getSetting('nagad_check_path', '/api/user/check-user-status-for-log-in');
  const timeoutSec = Math.min(Math.max(Number.parseInt(getSetting('nagad_timeout_seconds', '8'), 10) || 8, 1), 30);

  const requestHeaders: Record<string, string> = {
    'X-KM-User-AspId': getSetting('nagad_user_asp_id', '100012345612345'),
    'X-KM-User-Agent': getSetting('nagad_user_agent', 'ANDROID/2113'),
    'X-KM-DEVICE-FGP': process.env.NAGAD_DEVICE_FGP || 'DEV_SANDBOX_FGP_UNSET',
    'X-KM-Accept-language': getSetting('nagad_accept_language', 'bn'),
    'X-KM-AppCode': getSetting('nagad_app_code', '01'),
    'Accept-Encoding': 'gzip',
    'User-Agent': getSetting('nagad_http_user_agent', 'okhttp/5.0.0-alpha.7'),
  };

  if (process.env.NAGAD_API_KEY) {
    requestHeaders['Authorization'] = `Bearer ${process.env.NAGAD_API_KEY}`;
  }

  if (isMock) {
    await new Promise((resolve) => setTimeout(resolve, 65));
    const lastDigit = Number(msisdn.slice(-1));
    const accountExists = lastDigit % 2 === 0 || msisdn === '01625116266';
    return {
      status: 200,
      data: {
        ok: true,
        mode: 'mock',
        msisdn,
        request_reference: {
          method: 'GET',
          url: `${baseUrl}${checkPath}?msisdn=${msisdn}`,
          headers: {
            ...requestHeaders,
            'X-KM-DEVICE-FGP': '[REDACTED]',
            ...(requestHeaders.Authorization ? { Authorization: '[REDACTED]' } : {}),
          },
        },
        upstream_response: {
          status: accountExists ? 'ACTIVE' : 'NOT_REGISTERED',
          userStatus: accountExists ? 'REGISTERED_ACTIVE' : 'UNREGISTERED',
          msisdn,
          acceptLanguage: requestHeaders['X-KM-Accept-language'],
          eligibleForAuthorizedCheck: true,
          checkedAt: new Date().toISOString(),
        },
      },
    };
  }

  // Live mode: validate SSRF constraints before dispatching outbound authorized request
  const targetUrl = `${baseUrl.replace(/\/+$/, '')}${checkPath.startsWith('/') ? checkPath : `/${checkPath}`}?msisdn=${encodeURIComponent(msisdn)}`;
  const urlValidation = validateExternalUrl(targetUrl);
  if (!urlValidation.valid) {
    return {
      status: 400,
      data: {
        ok: false,
        mode: 'live',
        error: 'INVALID_UPSTREAM_URL',
        message: urlValidation.error,
      },
    };
  }

  if (!process.env.NAGAD_DEVICE_FGP) {
    return {
      status: 503,
      data: {
        ok: false,
        mode: 'live',
        error: 'MISSING_CREDENTIALS',
        message: 'Live Nagad mode requires NAGAD_DEVICE_FGP environment variable to be configured on the server.',
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const res = await fetch(urlValidation.url!.toString(), {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
    });
    const rawBody = await res.text();
    let parsedBody: unknown = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // keep raw text snippet
    }
    return {
      status: res.ok ? 200 : 502,
      data: {
        ok: res.ok,
        mode: 'live',
        msisdn,
        upstream_status: res.status,
        upstream_response: parsedBody,
      },
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      status: isAbort ? 504 : 502,
      data: {
        ok: false,
        mode: 'live',
        error: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_ERROR',
        message: isAbort
          ? `Nagad authorized endpoint timed out after ${timeoutSec}s.`
          : 'Failed to reach configured Nagad authorized endpoint.',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function getTruecallerStatus() {
  const isMock = getSetting('truecaller_mock_mode', 'true') === 'true';
  const apiUrl = getSetting('truecaller_api_url', '');
  const timeoutSec = Number.parseInt(getSetting('truecaller_timeout_seconds', '8'), 10) || 8;

  return {
    integration: 'truecaller',
    enabled: true,
    mode: isMock ? 'mock' : 'live',
    api_url: apiUrl || 'Mock Directory Provider (Authorized API URL unset)',
    credentials_configured: {
      api_key: maskSecret(process.env.TRUECALLER_API_KEY),
    },
    timeout_seconds: timeoutSec,
  };
}

export async function runTruecallerLookup(rawPhone: unknown): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const validation = normalizeTruecallerPhone(rawPhone);
  if (!validation.valid || !validation.normalized) {
    return {
      status: 400,
      data: {
        ok: false,
        error: 'VALIDATION_ERROR',
        message: validation.error || 'Invalid phone number.',
      },
    };
  }

  const phone = validation.normalized;
  const isMock = getSetting('truecaller_mock_mode', 'true') === 'true';
  const apiUrl = getSetting('truecaller_api_url', '');
  const timeoutSec = Math.min(Math.max(Number.parseInt(getSetting('truecaller_timeout_seconds', '8'), 10) || 8, 1), 30);

  if (isMock) {
    await new Promise((resolve) => setTimeout(resolve, 55));
    const suffix = phone.slice(-4);
    const carriers = ['Grameenphone', 'Robi Axiata', 'Banglalink', 'Airtel Bangladesh', 'Teletalk'];
    const carrierIdx = Number(phone.slice(-1)) % carriers.length;
    const isBusiness = Number(phone.slice(-2, -1)) % 3 === 0;

    return {
      status: 200,
      data: {
        ok: true,
        mode: 'mock',
        query: phone,
        country_code: validation.countryCode || 'BD',
        result: {
          e164: phone,
          display_name: isBusiness ? `Apex Logistics Support (${suffix})` : `Verified Subscriber #${suffix}`,
          carrier: carriers[carrierIdx],
          line_type: 'mobile',
          spam_score: 0,
          spam_type: null,
          verified_badge: isBusiness,
          checked_at: new Date().toISOString(),
        },
      },
    };
  }

  const urlValidation = validateExternalUrl(apiUrl);
  if (!urlValidation.valid) {
    return {
      status: 400,
      data: {
        ok: false,
        mode: 'live',
        error: 'INVALID_UPSTREAM_URL',
        message: urlValidation.error || 'Authorized Truecaller API URL is not configured.',
      },
    };
  }

  if (!process.env.TRUECALLER_API_KEY) {
    return {
      status: 503,
      data: {
        ok: false,
        mode: 'live',
        error: 'MISSING_CREDENTIALS',
        message: 'Live Truecaller mode requires TRUECALLER_API_KEY environment variable on the server.',
      },
    };
  }

  const target = new URL(urlValidation.url!.toString());
  target.searchParams.set('q', phone);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
  try {
    const res = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${process.env.TRUECALLER_API_KEY}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const rawBody = await res.text();
    let parsedBody: unknown = rawBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // keep raw
    }
    return {
      status: res.ok ? 200 : 502,
      data: {
        ok: res.ok,
        mode: 'live',
        query: phone,
        upstream_status: res.status,
        result: parsedBody,
      },
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    return {
      status: isAbort ? 504 : 502,
      data: {
        ok: false,
        mode: 'live',
        error: isAbort ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONNECTION_ERROR',
        message: isAbort
          ? `Truecaller authorized endpoint timed out after ${timeoutSec}s.`
          : 'Failed to reach configured Truecaller authorized endpoint.',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
