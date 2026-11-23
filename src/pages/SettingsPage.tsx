import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Save, Settings, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthStatus } from '../types';

interface SettingsPageProps {
  auth: AuthStatus;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function SettingsPage({ auth, onNavigate, notify }: SettingsPageProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rateLimit, setRateLimit] = useState('60');
  const [sessionTtl, setSessionTtl] = useState('60');
  const [redactionEnabled, setRedactionEnabled] = useState(true);
  const [nagadMock, setNagadMock] = useState(true);
  const [truecallerMock, setTruecallerMock] = useState(true);
  const [clearingLogs, setClearingLogs] = useState(false);

  useEffect(() => {
    if (!auth.authenticated) {
      setLoading(false);
      return;
    }
    apiRequest<{
      ok: boolean;
      settings?: {
        rate_limit_per_minute: number;
        session_ttl_minutes: number;
        log_redaction_enabled: boolean;
        nagad_mock_mode: boolean;
        truecaller_mock_mode: boolean;
      };
    }>('/api/v1/settings').then((res) => {
      setLoading(false);
      if (res.ok && res.data.settings) {
        setRateLimit(String(res.data.settings.rate_limit_per_minute));
        setSessionTtl(String(res.data.settings.session_ttl_minutes));
        setRedactionEnabled(res.data.settings.log_redaction_enabled);
        setNagadMock(res.data.settings.nagad_mock_mode);
        setTruecallerMock(res.data.settings.truecaller_mock_mode);
      }
    });
  }, [auth.authenticated]);

  if (!auth.authenticated) {
    return (
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-8 text-center space-y-4 max-w-lg mx-auto">
        <Settings className="w-8 h-8 text-[#7655FF] mx-auto" />
        <h2 className="text-lg font-semibold text-[#F8FAFC]">Sign in to manage server settings</h2>
        <p className="text-sm text-[#94A3B8]">
          Rate limits, session expiration, and log redaction settings are protected for administrators.
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

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await apiRequest<{ ok: boolean; message?: string }>('/api/v1/settings', {
      method: 'POST',
      body: {
        rate_limit_per_minute: Number(rateLimit),
        session_ttl_minutes: Number(sessionTtl),
        log_redaction_enabled: redactionEnabled,
        nagad_mock_mode: nagadMock,
        truecaller_mock_mode: truecallerMock,
      },
    });
    setSaving(false);
    if (res.ok && res.data.ok) {
      notify('success', 'Server settings saved');
    } else {
      notify('error', 'Failed to update settings', res.data.message);
    }
  };

  const handleClearLogs = async () => {
    setClearingLogs(true);
    const res = await apiRequest<{ ok: boolean }>('/api/v1/logs', {
      method: 'POST',
      body: { action: 'clear' },
    });
    setClearingLogs(false);
    if (res.ok && res.data.ok) {
      notify('info', 'Request logs cleared');
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[#F8FAFC] tracking-tight">Server Settings</h2>
        <p className="text-sm text-[#94A3B8] mt-1">
          Configure rate limiting, session expiration, audit log redaction, and integration modes.
        </p>
      </div>

      {loading ? (
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-4">
          <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
          <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
        </div>
      ) : (
        <form
          onSubmit={handleSave}
          className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label htmlFor="rate-limit" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                API Rate Limit (requests / minute)
              </label>
              <input
                id="rate-limit"
                type="number"
                min={5}
                max={5000}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
              />
            </div>

            <div>
              <label htmlFor="session-ttl" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                Session Expiration (minutes)
              </label>
              <input
                id="session-ttl"
                type="number"
                min={5}
                max={1440}
                value={sessionTtl}
                onChange={(e) => setSessionTtl(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
              />
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-800/80">
            <label className="flex items-center justify-between gap-4 py-1 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[#F8FAFC]">Sensitive Data Log Redaction</p>
                <p className="text-xs text-[#94A3B8]">
                  Automatically masks passwords, OTPs, API keys, and device fingerprints in audit logs.
                </p>
              </div>
              <input
                type="checkbox"
                checked={redactionEnabled}
                onChange={(e) => setRedactionEnabled(e.target.checked)}
                className="w-4 h-4 accent-[#7655FF]"
              />
            </label>

            <label className="flex items-center justify-between gap-4 py-1 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[#F8FAFC]">Nagad Mock Mode</p>
                <p className="text-xs text-[#94A3B8]">
                  Simulate authorized Nagad status responses locally without outbound network calls.
                </p>
              </div>
              <input
                type="checkbox"
                checked={nagadMock}
                onChange={(e) => setNagadMock(e.target.checked)}
                className="w-4 h-4 accent-[#7655FF]"
              />
            </label>

            <label className="flex items-center justify-between gap-4 py-1 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-[#F8FAFC]">Truecaller Mock Mode</p>
                <p className="text-xs text-[#94A3B8]">
                  Simulate caller directory lookups locally when authorized API credentials are absent.
                </p>
              </div>
              <input
                type="checkbox"
                checked={truecallerMock}
                onChange={(e) => setTruecallerMock(e.target.checked)}
                className="w-4 h-4 accent-[#7655FF]"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-800/80">
            <button
              type="button"
              onClick={handleClearLogs}
              disabled={clearingLogs}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#080B12] hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/40 text-xs font-medium text-rose-400 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{clearingLogs ? 'Clearing...' : 'Clear Audit Logs'}</span>
            </button>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
