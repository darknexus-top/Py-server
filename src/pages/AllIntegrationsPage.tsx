import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowUpRight, Check, Code2, Copy, Play } from 'lucide-react';
import { JsonViewer } from '../components/JsonViewer';
import { apiRequest } from '../lib/api';
import type { AuthStatus, IntegrationItem } from '../types';

interface AllIntegrationsPageProps {
  auth: AuthStatus;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

const API_ENDPOINTS = [
  { method: 'GET', path: '/api/v1/health', auth: 'Public', desc: 'Database & service health check' },
  { method: 'GET', path: '/api/v1/status', auth: 'Public', desc: 'Server uptime, counters, and integration status' },
  { method: 'GET', path: '/api/v1/me', auth: 'Session / API Key', desc: 'Admin profile and API key inventory' },
  { method: 'GET', path: '/api/v1/nagad/status', auth: 'Session / API Key', desc: 'Nagad configuration and redacted headers' },
  { method: 'GET', path: '/api/v1/nagad/check?msisdn=01625116266', auth: 'Session / API Key', desc: 'Nagad MSISDN eligibility check' },
  { method: 'POST', path: '/api/v1/nagad/check', auth: 'Session / API Key', desc: 'Nagad MSISDN check via JSON payload' },
  { method: 'GET', path: '/api/v1/truecaller/status', auth: 'Session / API Key', desc: 'Truecaller integration status' },
  { method: 'GET', path: '/api/v1/truecaller/lookup?phone=%2B8801625116266', auth: 'Session / API Key', desc: 'Truecaller E.164 phone lookup' },
  { method: 'POST', path: '/api/v1/truecaller/lookup', auth: 'Session / API Key', desc: 'Truecaller lookup via JSON payload' },
  { method: 'GET', path: '/api/v1/integrations', auth: 'Session / API Key', desc: 'List all available integrations' },
  { method: 'GET', path: '/api/v1/logs', auth: 'Session / API Key', desc: 'Redacted request & response audit logs' },
];

export function AllIntegrationsPage({ auth, onNavigate, notify }: AllIntegrationsPageProps) {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [testMethod, setTestMethod] = useState<'GET' | 'POST'>('GET');
  const [testPath, setTestPath] = useState('/api/v1/health');
  const [testBody, setTestBody] = useState('{\n  "msisdn": "01625116266"\n}');
  const [customApiKey, setCustomApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    latencyMs: number;
    data: unknown;
  } | null>(null);

  // Python Flask project files explorer
  const [flaskFiles, setFlaskFiles] = useState<Array<{ path: string; size: number }>>([]);
  const [selectedFlaskFile, setSelectedFlaskFile] = useState<string>('');
  const [flaskContent, setFlaskContent] = useState<string>('');
  const [copiedFlask, setCopiedFlask] = useState(false);

  useEffect(() => {
    if (!auth.authenticated) return;
    apiRequest<{ ok: boolean; integrations?: IntegrationItem[] }>('/api/v1/integrations').then((res) => {
      if (res.ok && res.data.integrations) setIntegrations(res.data.integrations);
    });
    apiRequest<{ ok: boolean; files?: Array<{ path: string; size: number }> }>('/api/v1/flask-project').then(
      (res) => {
        if (res.ok && res.data.files && res.data.files.length > 0) {
          setFlaskFiles(res.data.files);
          loadFlaskFile(res.data.files[0].path);
        }
      }
    );
  }, [auth.authenticated]);

  const loadFlaskFile = async (filePath: string) => {
    setSelectedFlaskFile(filePath);
    const res = await apiRequest<{ ok: boolean; content?: string }>(
      `/api/v1/flask-project?file=${encodeURIComponent(filePath)}`
    );
    if (res.ok && res.data.content !== undefined) {
      setFlaskContent(res.data.content);
    }
  };

  const handleRunTest = async (e: FormEvent) => {
    e.preventDefault();
    let parsedBody: unknown = undefined;
    if (testMethod === 'POST' && testBody.trim()) {
      try {
        parsedBody = JSON.parse(testBody);
      } catch {
        notify('error', 'Invalid JSON body', 'Check JSON syntax before sending.');
        return;
      }
    }
    setTesting(true);
    const res = await apiRequest(testPath, {
      method: testMethod,
      body: parsedBody,
      apiKey: customApiKey.trim() || undefined,
    });
    setTesting(false);
    setTestResult({ status: res.status, latencyMs: res.latencyMs, data: res.data });
  };

  const copyFlaskSource = async () => {
    if (!flaskContent) return;
    await navigator.clipboard.writeText(flaskContent);
    setCopiedFlask(true);
    setTimeout(() => setCopiedFlask(false), 1500);
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-[#F8FAFC] tracking-tight">
          All Integrations &amp; API Explorer
        </h2>
        <p className="text-sm text-[#94A3B8] mt-1">
          Available integration modules, REST API v1 reference, interactive tester, and Python Flask source bundle.
        </p>
      </div>

      {/* Integration Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(integrations.length > 0
          ? integrations
          : [
              {
                id: 'nagad',
                name: 'Nagad Authorized Gateway',
                category: 'Financial Identity',
                route: '/Nagat',
                apiBase: '/api/v1/nagad',
                mode: 'mock' as const,
                status: 'active',
                description:
                  'Authorized MSISDN login-eligibility check with configurable gateway headers and mock sandbox.',
                endpoints: [],
              },
              {
                id: 'truecaller',
                name: 'Truecaller Caller Lookup',
                category: 'Caller Verification',
                route: '/Truecaller',
                apiBase: '/api/v1/truecaller',
                mode: 'mock' as const,
                status: 'active',
                description:
                  'Authorized E.164 phone directory lookup with validation, timeout protection, and mock mode.',
                endpoints: [],
              },
            ]
        ).map((item) => (
          <div
            key={item.id}
            className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 flex flex-col justify-between gap-4"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
                <span>{item.category}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[#06B6D4]">{item.mode === 'live' ? 'Live' : 'Mock'}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{item.apiBase}</span>
              </div>
              <h3 className="text-base font-semibold text-[#F8FAFC]">{item.name}</h3>
              <p className="text-xs text-[#94A3B8] leading-relaxed">{item.description}</p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
              <span className="text-xs font-mono text-emerald-400">Active</span>
              <button
                type="button"
                onClick={() => onNavigate(item.route)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#7655FF] hover:text-[#967dff] cursor-pointer"
              >
                <span>Open Integration</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Interactive API Tester + Endpoint Reference */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">REST API v1 Endpoints</h3>
          </div>
          <div className="divide-y divide-slate-800/60">
            {API_ENDPOINTS.map((ep, idx) => (
              <button
                key={`${ep.method}-${ep.path}-${idx}`}
                type="button"
                onClick={() => {
                  setTestMethod(ep.method === 'POST' ? 'POST' : 'GET');
                  setTestPath(ep.path);
                  if (ep.path.includes('truecaller')) {
                    setTestBody('{\n  "phone": "+8801625116266"\n}');
                  } else if (ep.path.includes('nagad')) {
                    setTestBody('{\n  "msisdn": "01625116266"\n}');
                  }
                }}
                className="w-full px-5 py-3 text-left hover:bg-slate-800/35 transition-colors flex items-center justify-between gap-4 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`font-mono text-xs font-semibold ${
                        ep.method === 'POST' ? 'text-[#7655FF]' : 'text-[#06B6D4]'
                      }`}
                    >
                      {ep.method}
                    </span>
                    <span className="font-mono text-xs text-[#F8FAFC] truncate">{ep.path}</span>
                  </div>
                  <p className="text-xs text-[#94A3B8] mt-0.5 truncate">{ep.desc}</p>
                </div>
                <span className="text-xs text-[#94A3B8] whitespace-nowrap shrink-0">{ep.auth}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-6 space-y-5">
          <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Interactive API Tester</h3>
            <form onSubmit={handleRunTest} className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <select
                  aria-label="HTTP Method"
                  value={testMethod}
                  onChange={(e) => setTestMethod(e.target.value as 'GET' | 'POST')}
                  className="px-3 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
                <input
                  type="text"
                  required
                  value={testPath}
                  onChange={(e) => setTestPath(e.target.value)}
                  className="flex-1 px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  Optional X-API-Key Override (otherwise uses active session)
                </label>
                <input
                  type="password"
                  placeholder="inf_..."
                  value={customApiKey}
                  onChange={(e) => setCustomApiKey(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>

              {testMethod === 'POST' && (
                <div>
                  <label className="block text-xs font-medium text-[#94A3B8] mb-1.5">JSON Body</label>
                  <textarea
                    rows={4}
                    value={testBody}
                    onChange={(e) => setTestBody(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={testing}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{testing ? 'Sending...' : 'Send Request'}</span>
              </button>
            </form>
          </div>

          <JsonViewer
            title="API Response"
            data={
              testResult
                ? testResult.data
                : { info: 'Click an endpoint on the left or enter a custom /api/v1/* path and press Send Request.' }
            }
            statusCode={testResult?.status}
            latencyMs={testResult?.latencyMs}
          />
        </div>
      </div>

      {/* Python Flask Source Code Explorer */}
      {auth.authenticated && flaskFiles.length > 0 && (
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Code2 className="w-4 h-4 text-[#06B6D4]" />
              <h3 className="text-sm font-semibold text-[#F8FAFC]">
                Python Flask Source Project (<code className="font-mono text-[#06B6D4]">infinity-network/</code>)
              </h3>
            </div>
            <button
              type="button"
              onClick={copyFlaskSource}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#080B12] border border-slate-800 text-xs text-[#F8FAFC] hover:bg-slate-800 cursor-pointer self-start sm:self-auto"
            >
              {copiedFlask ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedFlask ? 'Copied File' : 'Copy Current File'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12">
            <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-800/80 max-h-96 overflow-y-auto divide-y divide-slate-800/50">
              {flaskFiles.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => loadFlaskFile(f.path)}
                  className={`w-full px-4 py-2.5 text-left flex items-center justify-between gap-2 text-xs font-mono transition-colors cursor-pointer ${
                    selectedFlaskFile === f.path
                      ? 'bg-[#7655FF]/15 text-[#F8FAFC]'
                      : 'text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-slate-800/30'
                  }`}
                >
                  <span className="truncate">{f.path}</span>
                  <span className="text-[11px] text-slate-500 tabular-nums shrink-0">{f.size} B</span>
                </button>
              ))}
            </div>
            <div className="lg:col-span-8 bg-[#080B12]">
              <pre className="p-4 font-mono text-xs text-slate-200 overflow-x-auto max-h-96 leading-relaxed">
                {flaskContent}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
