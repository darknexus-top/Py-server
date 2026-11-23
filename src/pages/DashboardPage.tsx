import { useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, Server, Terminal } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthStatus, RequestLogRow, TelemetrySnapshot } from '../types';

interface DashboardPageProps {
  auth: AuthStatus;
  telemetry: TelemetrySnapshot | null;
  sseConnected: boolean;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

function formatUptime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
}

export function DashboardPage({
  auth,
  telemetry,
  sseConnected,
  onNavigate,
  notify,
}: DashboardPageProps) {
  const [publicStatus, setPublicStatus] = useState<TelemetrySnapshot | null>(null);
  const [logFilter, setLogFilter] = useState<'all' | 'nagad' | 'truecaller' | 'errors'>('all');
  const [probing, setProbing] = useState(false);
  const [liveUptime, setLiveUptime] = useState<number>(0);

  const activeData = telemetry || publicStatus;

  useEffect(() => {
    if (!activeData) return;
    setLiveUptime(activeData.uptime_seconds);
  }, [activeData?.uptime_seconds]);

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveUptime((prev) => (prev > 0 ? prev + 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!auth.authenticated) {
      apiRequest<TelemetrySnapshot>('/api/v1/status').then((res) => {
        if (res.ok) setPublicStatus(res.data);
      });
    }
  }, [auth.authenticated]);

  const handleHealthProbe = async () => {
    setProbing(true);
    const res = await apiRequest<{ status?: string; database?: string }>('/api/v1/health');
    setProbing(false);
    if (res.ok) {
      notify('success', 'Health check passed', `Database ${res.data.database} (${res.latencyMs} ms)`);
      if (!auth.authenticated) {
        const st = await apiRequest<TelemetrySnapshot>('/api/v1/status');
        if (st.ok) setPublicStatus(st.data);
      }
    } else {
      notify('error', 'Health check failed', `HTTP ${res.status}`);
    }
  };

  const recentLogs: RequestLogRow[] = activeData?.recent_logs || [];
  const filteredLogs = recentLogs.filter((row) => {
    if (logFilter === 'errors') return row.status_code >= 400;
    if (logFilter === 'nagad') return row.integration === 'nagad';
    if (logFilter === 'truecaller') return row.integration === 'truecaller';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Intro / Control Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[#F8FAFC] tracking-tight">
            Platform Telemetry &amp; Gateway Status
          </h2>
          <p className="text-sm text-[#94A3B8] mt-1">
            Real-time request counters, integration modes, and redacted activity stream.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={handleHealthProbe}
            disabled={probing}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#111827] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-[#F8FAFC] transition-colors whitespace-nowrap cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#06B6D4] ${probing ? 'animate-spin' : ''}`} />
            <span>Run Health Check</span>
          </button>
        </div>
      </div>

      {/* Unauthenticated Notice */}
      {!auth.authenticated && (
        <div className="bg-[#111827] border border-[#7655FF]/35 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-[#F8FAFC]">
              {auth.needsSetup
                ? 'First-run administrator setup required'
                : 'Sign in to unlock live SSE logs, Nagad/Truecaller runners, and API key management'}
            </p>
            <p className="text-xs text-[#94A3B8]">
              Protected API endpoints enforce server-side session or X-API-Key authentication.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>{auth.needsSetup ? 'Claim Admin Access' : 'Admin Sign In'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-2">
          <p className="text-xs text-[#94A3B8]">Server Status</p>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                activeData?.online ? 'bg-emerald-400' : 'bg-rose-400'
              }`}
              aria-hidden="true"
            />
            <span className="text-xl font-semibold text-[#F8FAFC]">
              {activeData?.online ? 'Online' : 'Offline'}
            </span>
          </div>
          <p className="text-xs font-mono text-[#94A3B8]">
            {auth.authenticated ? (sseConnected ? 'SSE live stream' : 'Reconnecting') : 'HTTP probe'}
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-2">
          <p className="text-xs text-[#94A3B8]">Live Server Uptime</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-[#F8FAFC]">
            {activeData ? formatUptime(liveUptime) : '--:--:--'}
          </p>
          <p className="text-xs text-[#94A3B8]">Continuous process clock</p>
        </div>

        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-2">
          <p className="text-xs text-[#94A3B8]">API Requests</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-[#F8FAFC]">
            {activeData ? activeData.metrics.total_requests.toLocaleString() : '—'}
          </p>
          <p className="text-xs text-[#94A3B8] font-mono tabular-nums">
            Avg {activeData ? `${activeData.metrics.avg_latency_ms} ms` : '—'}
          </p>
        </div>

        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-2">
          <p className="text-xs text-[#94A3B8]">Successful (2xx–3xx)</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-emerald-400">
            {activeData ? activeData.metrics.success_requests.toLocaleString() : '—'}
          </p>
          <p className="text-xs text-[#94A3B8]">Validated responses</p>
        </div>

        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 space-y-2">
          <p className="text-xs text-[#94A3B8]">Failed (4xx–5xx)</p>
          <p className="text-xl font-semibold font-mono tabular-nums text-rose-400">
            {activeData ? activeData.metrics.failed_requests.toLocaleString() : '—'}
          </p>
          <p className="text-xs text-[#94A3B8]">Auth, validation &amp; limits</p>
        </div>
      </div>

      {/* Integrations Status Split */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <span>Financial Identity</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#06B6D4]">
                {activeData?.integrations.nagad.mode === 'live' ? 'Live Mode' : 'Mock Mode'}
              </span>
            </div>
            <h3 className="text-base font-semibold text-[#F8FAFC]">Nagad Authorized API</h3>
            <p className="text-xs text-[#94A3B8]">
              MSISDN login eligibility check with configurable headers and server-side device fingerprint.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/Nagat')}
            className="px-3.5 py-2 rounded-lg bg-[#080B12] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open Console
          </button>
        </div>

        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <span>Caller Verification</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[#06B6D4]">
                {activeData?.integrations.truecaller.mode === 'live' ? 'Live Mode' : 'Mock Mode'}
              </span>
            </div>
            <h3 className="text-base font-semibold text-[#F8FAFC]">Truecaller Lookup API</h3>
            <p className="text-xs text-[#94A3B8]">
              Authorized E.164 phone lookup with strict input validation, timeout guards, and mock sandbox.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/Truecaller')}
            className="px-3.5 py-2 rounded-lg bg-[#080B12] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-[#F8FAFC] whitespace-nowrap shrink-0 cursor-pointer"
          >
            Open Console
          </button>
        </div>
      </div>

      {/* Recent API Activity Table */}
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-[#7655FF]" />
            <h3 className="text-sm font-semibold text-[#F8FAFC]">Recent API Activity</h3>
          </div>

          <div className="flex items-center gap-1 bg-[#080B12] p-1 rounded-lg border border-slate-800/80 self-start sm:self-auto">
            {(['all', 'nagad', 'truecaller', 'errors'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLogFilter(tab)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors cursor-pointer ${
                  logFilter === tab
                    ? 'bg-[#7655FF] text-white'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {!auth.authenticated ? (
          <div className="p-8 text-center space-y-2">
            <Terminal className="w-6 h-6 text-[#94A3B8] mx-auto" />
            <p className="text-sm text-[#F8FAFC] font-medium">Activity log requires authentication</p>
            <p className="text-xs text-[#94A3B8]">
              Sign in as administrator to inspect live redacted API request records.
            </p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm text-[#F8FAFC] font-medium">No matching API requests yet</p>
            <p className="text-xs text-[#94A3B8]">
              Trigger a Nagad check, Truecaller lookup, or health probe to observe live telemetry.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800/80 text-xs text-[#94A3B8]">
                  <th className="py-3 px-5 font-medium">Method</th>
                  <th className="py-3 px-4 font-medium">Endpoint</th>
                  <th className="py-3 px-4 font-medium">Module</th>
                  <th className="py-3 px-4 font-medium">Actor</th>
                  <th className="py-3 px-4 font-medium text-right">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Latency</th>
                  <th className="py-3 px-5 font-medium text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {filteredLogs.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-5 font-mono font-medium text-[#06B6D4] whitespace-nowrap">
                      {row.method}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#F8FAFC] whitespace-nowrap">
                      {row.path}
                    </td>
                    <td className="py-2.5 px-4 text-[#94A3B8] capitalize whitespace-nowrap">
                      {row.integration}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[#94A3B8] whitespace-nowrap">
                      {row.actor}
                    </td>
                    <td
                      className={`py-2.5 px-4 font-mono tabular-nums text-right whitespace-nowrap ${
                        row.status_code < 400 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {row.status_code}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-[#94A3B8] text-right whitespace-nowrap">
                      {row.latency_ms} ms
                    </td>
                    <td className="py-2.5 px-5 font-mono tabular-nums text-[#94A3B8] text-right whitespace-nowrap">
                      {new Date(row.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
