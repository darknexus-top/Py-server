import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Play, Save, ShieldAlert, Wallet } from 'lucide-react';
import { JsonViewer } from '../components/JsonViewer';
import { apiRequest } from '../lib/api';
import type { AuthStatus, NagadConfig } from '../types';

interface NagadPageProps {
  auth: AuthStatus;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function NagadPage({ auth, onNavigate, notify }: NagadPageProps) {
  const [config, setConfig] = useState<NagadConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [msisdn, setMsisdn] = useState('01625116266');
  const [httpMethod, setHttpMethod] = useState<'GET' | 'POST'>('GET');
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  // Configurable header / endpoint fields (secrets like X-KM-DEVICE-FGP remain server-side only)
  const [mockMode, setMockMode] = useState(true);
  const [baseUrl, setBaseUrl] = useState('https://app.mynagad.com:20002');
  const [checkPath, setCheckPath] = useState('/api/user/check-user-status-for-log-in');
  const [userAspId, setUserAspId] = useState('100012345612345');
  const [userAgent, setUserAgent] = useState('ANDROID/2113');
  const [acceptLanguage, setAcceptLanguage] = useState('bn');
  const [appCode, setAppCode] = useState('01');
  const [httpUserAgent, setHttpUserAgent] = useState('okhttp/5.0.0-alpha.7');
  const [timeoutSeconds, setTimeoutSeconds] = useState('8');

  const [lastResult, setLastResult] = useState<{
    status: number;
    latencyMs: number;
    data: unknown;
  } | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    const res = await apiRequest<NagadConfig & { ok: boolean }>('/api/v1/nagad/status');
    setLoading(false);
    if (res.ok && res.data.ok) {
      setConfig(res.data);
      setMockMode(res.data.mode === 'mock');
      setBaseUrl(res.data.base_url);
      setCheckPath(res.data.check_path);
      setUserAspId(res.data.headers_preview['X-KM-User-AspId'] || '');
      setUserAgent(res.data.headers_preview['X-KM-User-Agent'] || '');
      setAcceptLanguage(res.data.headers_preview['X-KM-Accept-language'] || 'bn');
      setAppCode(res.data.headers_preview['X-KM-AppCode'] || '01');
      setHttpUserAgent(res.data.headers_preview['User-Agent'] || '');
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
        <Wallet className="w-8 h-8 text-[#7655FF] mx-auto" />
        <h2 className="text-lg font-semibold text-[#F8FAFC]">Sign in to access Nagad Integration</h2>
        <p className="text-sm text-[#94A3B8]">
          Authorized gateway configuration and MSISDN checks require an active admin session.
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
    const res = await apiRequest<NagadConfig & { ok: boolean; message?: string }>('/api/v1/nagad/status', {
      method: 'POST',
      body: {
        mockMode,
        baseUrl,
        checkPath,
        userAspId,
        userAgent,
        acceptLanguage,
        appCode,
        httpUserAgent,
        timeoutSeconds: Number(timeoutSeconds),
      },
    });
    setSaving(false);
    if (res.ok && res.data.ok) {
      setConfig(res.data);
      notify('success', 'Nagad configuration saved', `Active mode: ${res.data.mode.toUpperCase()}`);
    } else {
      notify('error', 'Configuration failed', res.data.message);
    }
  };

  const handleRunCheck = async (e: FormEvent) => {
    e.preventDefault();
    setRunning(true);
    const endpoint =
      httpMethod === 'GET'
        ? `/api/v1/nagad/check?msisdn=${encodeURIComponent(msisdn)}`
        : '/api/v1/nagad/check';
    const res = await apiRequest(endpoint, {
      method: httpMethod,
      body: httpMethod === 'POST' ? { msisdn } : undefined,
    });
    setRunning(false);
    setLastResult({ status: res.status, latencyMs: res.latencyMs, data: res.data });
    if (res.ok) {
      notify('success', 'Nagad status check completed', `HTTP ${res.status} in ${res.latencyMs} ms`);
    } else {
      notify('error', 'Nagad check returned error', `HTTP ${res.status}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F8FAFC] tracking-tight">
            Nagad Authorized Integration
          </h2>
          <p className="text-sm text-[#94A3B8] mt-1">
            Configurable authorized user-status endpoint with server-side fingerprint protection and mock mode.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-[#94A3B8]">
          <span>Mode:</span>
          <span className={mockMode ? 'text-[#06B6D4]' : 'text-emerald-400'}>
            {mockMode ? 'Mock Sandbox' : 'Live Authorized'}
          </span>
        </div>
      </div>

      {/* Compliance Notice */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl px-5 py-3.5 flex items-start gap-3">
        <ShieldAlert className="w-4 h-4 text-[#06B6D4] mt-0.5 shrink-0" />
        <p className="text-xs text-[#94A3B8] leading-relaxed">
          Device fingerprint (<code className="font-mono text-slate-200">X-KM-DEVICE-FGP</code>) and API credentials are read exclusively from server environment variables ({config?.credentials_configured.device_fingerprint || 'Not configured'}) and are never exposed in browser JS or logged unredacted.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Check Runner */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Execute MSISDN Status Check</h3>
            <form onSubmit={handleRunCheck} className="space-y-4">
              <div>
                <label htmlFor="nagad-msisdn" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  MSISDN (Bangladesh 11-digit mobile)
                </label>
                <input
                  id="nagad-msisdn"
                  type="text"
                  required
                  placeholder="01625116266"
                  value={msisdn}
                  onChange={(e) => setMsisdn(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-[#94A3B8] mb-1.5">Gateway Request Method</span>
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
                <span>{running ? 'Checking...' : 'Check User Status'}</span>
              </button>
            </form>
          </div>

          {lastResult ? (
            <JsonViewer
              title="Nagad API Response"
              data={lastResult.data}
              statusCode={lastResult.status}
              latencyMs={lastResult.latencyMs}
            />
          ) : (
            <JsonViewer
              title="Reference Outbound Request Structure"
              data={{
                method: 'GET',
                url: `${baseUrl}${checkPath}?msisdn=${msisdn}`,
                headers: config?.headers_preview || {
                  'X-KM-User-AspId': userAspId,
                  'X-KM-User-Agent': userAgent,
                  'X-KM-DEVICE-FGP': 'Configured on server',
                  'X-KM-Accept-language': acceptLanguage,
                  'X-KM-AppCode': appCode,
                  'Accept-Encoding': 'gzip',
                  'User-Agent': httpUserAgent,
                },
              }}
            />
          )}
        </div>

        {/* Configurable Reference Headers & Endpoint */}
        <div className="lg:col-span-7 bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Authorized Endpoint &amp; Header Configuration</h3>
            <div className="flex items-center gap-1 bg-[#080B12] p-1 rounded-lg border border-slate-800">
              <button
                type="button"
                onClick={() => setMockMode(true)}
                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                  mockMode ? 'bg-[#06B6D4] text-[#080B12]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                Mock Mode
              </button>
              <button
                type="button"
                onClick={() => setMockMode(false)}
                className={`px-3 py-1 rounded-md text-xs font-medium cursor-pointer ${
                  !mockMode ? 'bg-emerald-500 text-[#080B12]' : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                Live Mode
              </button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
              <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
              <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
            </div>
          ) : (
            <form onSubmit={handleSaveConfig} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Base Host URL</label>
                <input
                  type="url"
                  required
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">Authorized Check Path</label>
                <input
                  type="text"
                  required
                  value={checkPath}
                  onChange={(e) => setCheckPath(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">X-KM-User-AspId</label>
                <input
                  type="text"
                  value={userAspId}
                  onChange={(e) => setUserAspId(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">X-KM-User-Agent</label>
                <input
                  type="text"
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">X-KM-Accept-language</label>
                <input
                  type="text"
                  value={acceptLanguage}
                  onChange={(e) => setAcceptLanguage(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">X-KM-AppCode</label>
                <input
                  type="text"
                  value={appCode}
                  onChange={(e) => setAppCode(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">HTTP User-Agent</label>
                <input
                  type="text"
                  value={httpUserAgent}
                  onChange={(e) => setHttpUserAgent(e.target.value)}
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

              <div className="sm:col-span-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{saving ? 'Saving...' : 'Save Nagad Configuration'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
