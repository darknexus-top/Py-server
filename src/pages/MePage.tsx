import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Copy, KeyRound, Plus, Trash2, User } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { ApiKeyRow, AuthStatus } from '../types';

interface MePageProps {
  auth: AuthStatus;
  onAuthChange: () => Promise<void>;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function MePage({ auth, onAuthChange, onNavigate, notify }: MePageProps) {
  const [displayName, setDisplayName] = useState(auth.user?.displayName || '');
  const [email, setEmail] = useState(auth.user?.email || '');
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const loadMe = async () => {
    setLoading(true);
    const res = await apiRequest<{
      ok: boolean;
      profile?: { displayName: string; email: string };
      api_keys?: ApiKeyRow[];
    }>('/api/v1/me');
    setLoading(false);
    if (res.ok && res.data.ok) {
      if (res.data.profile) {
        setDisplayName(res.data.profile.displayName);
        setEmail(res.data.profile.email);
      }
      setApiKeys(res.data.api_keys || []);
    }
  };

  useEffect(() => {
    if (auth.authenticated) {
      loadMe();
    } else {
      setLoading(false);
    }
  }, [auth.authenticated]);

  if (!auth.authenticated) {
    return (
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-8 text-center space-y-4 max-w-lg mx-auto">
        <User className="w-8 h-8 text-[#7655FF] mx-auto" />
        <h2 className="text-lg font-semibold text-[#F8FAFC]">Sign in to view your profile</h2>
        <p className="text-sm text-[#94A3B8]">
          Manage your administrator account details and issue or revoke API keys.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('/login')}
          className="px-5 py-2.5 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-sm font-medium cursor-pointer"
        >
          Go to Sign In
        </button>
      </div>
    );
  }

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    const res = await apiRequest<{ ok: boolean; message?: string }>('/api/v1/me', {
      method: 'POST',
      body: { action: 'update_profile', displayName, email },
    });
    setSavingProfile(false);
    if (res.ok && res.data.ok) {
      await onAuthChange();
      notify('success', 'Profile updated');
    } else {
      notify('error', 'Update failed', res.data.message);
    }
  };

  const handleCreateKey = async (e: FormEvent) => {
    e.preventDefault();
    setCreatingKey(true);
    const res = await apiRequest<{ ok: boolean; api_key?: string; message?: string }>('/api/v1/me', {
      method: 'POST',
      body: { action: 'create_key', label: newKeyLabel || 'Client Integration Key' },
    });
    setCreatingKey(false);
    if (res.ok && res.data.ok && res.data.api_key) {
      setRevealedKey(res.data.api_key);
      setNewKeyLabel('');
      await loadMe();
      notify('success', 'API key created', 'Copy and store this key securely.');
    } else {
      notify('error', 'Failed to create key', res.data.message);
    }
  };

  const handleRevokeKey = async (keyId: number) => {
    const res = await apiRequest<{ ok: boolean }>('/api/v1/me', {
      method: 'POST',
      body: { action: 'revoke_key', keyId },
    });
    if (res.ok && res.data.ok) {
      await loadMe();
      notify('info', 'API key revoked');
    }
  };

  const copyRevealed = async () => {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[#F8FAFC] tracking-tight">Profile &amp; API Keys</h2>
        <p className="text-sm text-[#94A3B8] mt-1">
          Configure administrator identity and manage bearer/header API credentials.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-5">
          <div className="flex items-center gap-4">
            {!avatarError ? (
              <img
                src="/src/assets/images/avatar_platform_admin_1795474750390.jpg"
                alt="Platform administrator portrait"
                referrerPolicy="no-referrer"
                onError={() => setAvatarError(true)}
                className="w-16 h-16 rounded-xl object-cover border border-slate-700/80 shrink-0"
              />
            ) : (
              <div className="w-16 h-16 rounded-xl bg-[#7655FF]/20 border border-[#7655FF]/40 flex items-center justify-center shrink-0">
                <User className="w-7 h-7 text-[#7655FF]" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-base font-semibold text-[#F8FAFC] truncate">{displayName || auth.user?.username}</p>
              <p className="text-xs text-[#94A3B8] font-mono">
                {auth.user?.username} · {auth.user?.role}
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label htmlFor="profile-name" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                Display Name
              </label>
              <input
                id="profile-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
              />
            </div>
            <div>
              <label htmlFor="profile-email" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                Email Address
              </label>
              <input
                id="profile-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
              />
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="w-full py-2.5 px-4 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-xs font-medium transition-colors cursor-pointer"
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </button>
          </form>
        </div>

        {/* API Keys Management */}
        <div className="lg:col-span-2 bg-[#111827] border border-slate-800/80 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <KeyRound className="w-4 h-4 text-[#06B6D4]" />
              <h3 className="text-sm font-semibold text-[#F8FAFC]">Programmatic API Keys</h3>
            </div>
            <span className="text-xs text-[#94A3B8] font-mono">Header: X-API-Key</span>
          </div>

          <form onSubmit={handleCreateKey} className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Key label (e.g. Production Worker)"
              value={newKeyLabel}
              onChange={(e) => setNewKeyLabel(e.target.value)}
              className="flex-1 px-3.5 py-2 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
            />
            <button
              type="submit"
              disabled={creatingKey}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-xs font-medium whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{creatingKey ? 'Generating...' : 'Generate API Key'}</span>
            </button>
          </form>

          {revealedKey && (
            <div className="bg-[#080B12] border border-emerald-500/40 rounded-lg p-4 space-y-2">
              <p className="text-xs font-medium text-emerald-400">
                New API key generated (shown once — store it securely):
              </p>
              <div className="flex items-center justify-between gap-3">
                <code className="font-mono text-xs text-[#F8FAFC] break-all">{revealedKey}</code>
                <button
                  type="button"
                  onClick={copyRevealed}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-[#F8FAFC] shrink-0 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">
              <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
              <div className="h-10 bg-slate-800/50 rounded-lg animate-pulse" />
            </div>
          ) : apiKeys.length === 0 ? (
            <p className="text-xs text-[#94A3B8] py-4">No API keys created yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800/80 text-xs text-[#94A3B8]">
                    <th className="py-2.5 pr-4 font-medium">Label</th>
                    <th className="py-2.5 px-3 font-medium">Prefix</th>
                    <th className="py-2.5 px-3 font-medium">Status</th>
                    <th className="py-2.5 px-3 font-medium">Last Used</th>
                    <th className="py-2.5 pl-3 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-xs">
                  {apiKeys.map((k) => (
                    <tr key={k.id}>
                      <td className="py-3 pr-4 font-medium text-[#F8FAFC]">{k.label}</td>
                      <td className="py-3 px-3 font-mono text-[#06B6D4]">{k.key_prefix}••••</td>
                      <td className={`py-3 px-3 font-mono ${k.revoked ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {k.revoked ? 'Revoked' : 'Active'}
                      </td>
                      <td className="py-3 px-3 font-mono text-[#94A3B8]">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        {!k.revoked && (
                          <button
                            type="button"
                            onClick={() => handleRevokeKey(k.id)}
                            className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Revoke</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Sample Request Snippet */}
          <div className="pt-2 border-t border-slate-800/80 space-y-2">
            <p className="text-xs font-medium text-[#94A3B8]">Authenticated API Call Example</p>
            <pre className="p-3.5 rounded-lg bg-[#080B12] border border-slate-800 font-mono text-xs text-slate-300 overflow-x-auto">
              {`curl -X GET "${window.location.origin}/api/v1/nagad/check?msisdn=01625116266" \\\n  -H "X-API-Key: YOUR_API_KEY"`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
