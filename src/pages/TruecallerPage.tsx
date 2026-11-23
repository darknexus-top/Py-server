import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PhoneCall, Play, Save, ShieldAlert } from 'lucide-react';
import { JsonViewer } from '../components/JsonViewer';
import { apiRequest } from '../lib/api';
import type { AuthStatus, TruecallerConfig } from '../types';

interface TruecallerPageProps {
  auth: AuthStatus;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function TruecallerPage({ auth, onNavigate, notify }: TruecallerPageProps) {
  const [config, setConfig] = useState<TruecallerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('+8801625116266');
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST'>('GET');
  const [mockMode, setMockMode] = useState(true);
  const [apiUrl, setApiUrl] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('8');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastResult, setLastResult] = useState<{
    status: number;
    latencyMs: number;
    data: unknown;
  } | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    const res = await apiRequest<TruecallerConfig & { ok: boolean }>('/api/v1/truecaller/status');
    setLoading(false);
    if (res.ok && res.data.ok) {
      setConfig(res.data);
      setMockMode(res.data.mode === 'mock');
      setApiUrl(res.data.api_url.startsWith('http') ? res.data.api_url : '');
      setTimeoutSeconds(String(res.data.timeout_seconds || 8));
    }
  };

  useEffect(() => {
    if (auth.authenticated) {
      loadStatus();
    } else {
      setLoading(false);
    }
  }, [auth.authenticated]);

  if (!auth.authenticated) {
    return (
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-8 text-center space-y-4 max-w-lg mx-auto">
        <PhoneCall className="w-8 h-8 text-[#06B6D4] mx-auto" />
        <h2 className="text-lg font-semibold text-[#F8FAFC]">Sign in to access Truecaller Integration</h2>
        <p className="text-sm text-[#94A3B8]">
          Authorized caller lookup and configuration require an active administrator session.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('/login')}
          className="px-5 py-2.5 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-sm font-medium cursor-pointer"
        >
          Admin Sign In
        </button>
      </div>
    );
  }

  const handleSaveConfig = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await apiRequest<TruecallerConfig & { ok: boolean; message?: string }>(
      '/api/v1/truecaller/status',
      {
        method: 'POST',
        body: {
          mockMode,
          apiUrl,
          timeoutSeconds: Number(timeoutSeconds),
        },
      }
    );
    setSaving(false);
    if (res.ok && res.data.ok) {
      setConfig(res.data);
      notify('success', 'Truecaller configuration saved', `Active mode: ${res.data.mode.toUpperCase()}`);
    } else {
      notify('error', 'Failed to save configuration', res.data.message);
    }
  };

  const handleLookup = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    const endpoint =
      httpMethod === 'GET'
        ? `/api/v1/truecaller/lookup?phone=${encodeURIComponent(phone)}`
        : '/api/v1/truecaller/lookup';
    const res = await apiRequest(endpoint, {
      method: httpMethod,
      body: httpMethod === 'POST' ? { phone } : undefined,
    });
    setRunning(false);
    setLastResult({ status: res.status, latencyMs: res.latencyMs, data: res.data });
    if (res.ok) {
      notify('success', 'Truecaller lookup completed', `HTTP ${res.status} in ${res.latencyMs} ms`);
    } else {
      notify('error', 'Lookup validation or upstream error', `HTTP ${res.status}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F8FAFC] tracking-tight">
            Truecaller Authorized Integration
          </h2>
          <p className="text-sm text-[#94A3B8] mt-1">
            Official API directory lookup with phone validation, timeout protection, and mock mode.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-[#94A3B8]">
          <span>Mode:</span>
          <span className={mockMode ? 'text-[#06B6D4]' : 'text-emerald-400'}>
            {mockMode ? 'Mock Sandbox' : 'Live Authorized'}
          </span>
        </div>
      </div>

      <div className="bg-[#111827] border border-slate-800/80 rounded-xl px-5 py-3.5 flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-[#06B6D4] mt-0.5 shrink-0" />
        <p className="text-xs text-[#94A3B8] leading-relaxed">
          Credentials (<code className="font-mono text-slate-200">TRUECALLER_API_KEY</code>:{' '}
          {config?.credentials_configured.api_key || 'Not configured'}) remain strictly on the backend server. Only officially authorized enterprise API endpoints are permitted.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Phone Number Lookup</h3>
            <form onSubmit={handleLookup} className="space-y-4">
              <div>
                <label htmlFor="tc-phone" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  Phone Number (E.164 or 11-digit BD)
                </label>
                <input
                  id="tc-phone"
                  type="text"
                  required
                  placeholder="+8801625116266"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-[#94A3B8] mb-1.5">HTTP Method</span>
                <div className="grid grid-cols-2 gap-2 bg-[#080B12] p-1 rounded-lg border border-slate-800">
                  {(['GET', 'POST'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setHttpMethod(m)}
                      className={`py-1.5 rounded-md font-mono text-xs font-medium transition-colors cursor-pointer ${
                        httpMethod === m ? 'bg-[#7655FF] text-white' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={running}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-sm font-medium transition-colors cursor-pointer"
              >
                <Play className="w-4 h-4" />
                <span>{running ? 'Looking up...' : 'Run Lookup'}</span>
              </button>
            </form>
          </div>

          <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-sm font-semibold text-[#F8FAFC]">Provider Settings</h3>
              <div className="flex items-center gap-1 bg-[#080B12] p-1 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setMockMode(true)}
                  className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    mockMode ? 'bg-[#06B6D4] text-[#080B12]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  Mock
                </button>
                <button
                  type="button"
                  onClick={() => setMockMode(false)}
                  className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                    !mockMode ? 'bg-emerald-500 text-[#080B12]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                  }`}
                >
                  Live
                </button>
              </div>
            </div>

            {loading ? (
              <div className="space-y-3">
                <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
                <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
              </div>
            ) : (
              <form onSubmit={handleSaveConfig} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                    Authorized API Endpoint URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://api.authorized-provider.example/v1/lookup"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Timeout (seconds)</label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={timeoutSeconds}
                    onChange={(e) => setTimeoutSeconds(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Configuration'}</span>
                </button>
              </form>
            )}
          </div>
        </div>

        <div className="lg:col-span-7">
          <JsonViewer
            title="Truecaller API Response Viewer"
            data={
              lastResult
                ? lastResult.data
                : {
                    hint: 'Execute a lookup on the left to inspect the structured response payload.',
                    example_endpoint: '/api/v1/truecaller/lookup?phone=%2B8801625116266',
                    current_mode: mockMode ? 'mock' : 'live',
                  }
            }
            statusCode={lastResult?.status}
            latencyMs={lastResult?.latencyMs}
          />
        </div>
      </div>
    </div>
  );
}
