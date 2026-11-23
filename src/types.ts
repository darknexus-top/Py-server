export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: string;
}

export interface AuthStatus {
  authenticated: boolean;
  needsSetup: boolean;
  user: AuthUser | null;
  csrfToken: string | null;
}

export interface RequestLogRow {
  id: number;
  method: string;
  path: string;
  status_code: number;
  latency_ms: number;
  client_ip: string;
  actor: string;
  integration: string;
  request_meta: string;
  response_summary: string;
  created_at: string;
}

export interface TelemetrySnapshot {
  online: boolean;
  uptime_seconds: number;
  timestamp: string;
  metrics: {
    total_requests: number;
    success_requests: number;
    failed_requests: number;
    avg_latency_ms: number;
  };
  integrations: {
    nagad: { mode: 'mock' | 'live'; status: string };
    truecaller: { mode: 'mock' | 'live'; status: string };
  };
  recent_logs: RequestLogRow[];
}

export interface ApiKeyRow {
  id: number;
  label: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked: number;
}

export interface NagadConfig {
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

export interface TruecallerConfig {
  integration: string;
  enabled: boolean;
  mode: 'mock' | 'live';
  api_url: string;
  credentials_configured: {
    api_key: string;
  };
  timeout_seconds: number;
}

export interface IntegrationItem {
  id: string;
  name: string;
  category: string;
  route: string;
  apiBase: string;
  mode: 'mock' | 'live';
  status: string;
  description: string;
  endpoints: Array<{
    method: string;
    path: string;
    auth: string;
  }>;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  detail?: string;
}
