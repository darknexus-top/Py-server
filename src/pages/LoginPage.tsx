import { useState } from 'react';
import type { FormEvent } from 'react';
import { Copy, Check, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { apiRequest } from '../lib/api';
import type { AuthStatus } from '../types';

interface LoginPageProps {
  auth: AuthStatus;
  onAuthChange: () => Promise<void>;
  onNavigate: (path: string) => void;
  notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void;
}

export function LoginPage({ auth, onAuthChange, onNavigate, notify }: LoginPageProps) {
  const [username, setUsername] = useState('admin');
  const [displayName, setDisplayName] = useState('Platform Administrator');
  const [email, setEmail] = useState('admin@infinity.network');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [initialApiKey, setInitialApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const res = await apiRequest<{
      ok: boolean;
      message?: string;
      initialApiKey?: string;
    }>('/api/v1/auth/setup', {
      method: 'POST',
      body: { username, displayName, email, password },
    });
    setSubmitting(false);

    if (!res.ok || !res.data.ok) {
      setErrorMsg(res.data.message || 'Failed to complete admin setup.');
      return;
    }

    if (res.data.initialApiKey) {
      setInitialApiKey(res.data.initialApiKey);
    }
    await onAuthChange();
    notify('success', 'Admin account created', 'Your session is active.');
    if (!res.data.initialApiKey) {
      onNavigate('/');
    }
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!password) {
      setErrorMsg('Enter your password.');
      return;
    }

    setSubmitting(true);
    const res = await apiRequest<{ ok: boolean; message?: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: { username, password },
    });
    setSubmitting(false);

    if (!res.ok || !res.data.ok) {
      setErrorMsg(res.data.message || 'Invalid credentials.');
      return;
    }

    await onAuthChange();
    notify('success', 'Signed in', `Welcome back, ${username}.`);
    onNavigate('/');
  };

  const handleCopyKey = async () => {
    if (!initialApiKey) return;
    await navigator.clipboard.writeText(initialApiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1500);
  };

  if (initialApiKey) {
    return (
      <div className="max-w-lg mx-auto py-8">
        <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
              <KeyRound className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F8FAFC]">Admin Access Claimed</h2>
              <p className="text-xs text-[#94A3B8]">Save your starter API key before continuing</p>
            </div>
          </div>

          <p className="text-sm text-[#94A3B8] leading-relaxed">
            Your administrator account is active and a default API key has been generated for programmatic{' '}
            <code className="font-mono text-slate-200">/api/v1/*</code> requests. This secret is shown once.
          </p>

          <div className="bg-[#080B12] border border-slate-800 rounded-lg p-3 flex items-center justify-between gap-3">
            <code className="font-mono text-xs text-[#06B6D4] break-all">{initialApiKey}</code>
            <button
              type="button"
              onClick={handleCopyKey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs text-[#F8FAFC] shrink-0 cursor-pointer"
            >
              {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="w-full py-2.5 px-4 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-sm font-medium transition-colors cursor-pointer"
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-8">
      <div className="bg-[#111827] border border-slate-800/80 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#7655FF]/15 border border-[#7655FF]/30 flex items-center justify-center">
              {auth.needsSetup ? (
                <ShieldCheck className="w-5 h-5 text-[#7655FF]" />
              ) : (
                <Lock className="w-5 h-5 text-[#7655FF]" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#F8FAFC]">
                {auth.needsSetup ? 'First-Run Admin Setup' : 'Admin Sign In'}
              </h2>
              <p className="text-xs text-[#94A3B8]">
                {auth.needsSetup
                  ? 'Set your initial administrator credentials to lock this instance.'
                  : 'Sign in with your administrator account.'}
              </p>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg px-4 py-3 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        <form onSubmit={auth.needsSetup ? handleSetup : handleLogin} className="space-y-4">
          <div>
            <label htmlFor="auth-username" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
              Username
            </label>
            <input
              id="auth-username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
            />
          </div>

          {auth.needsSetup && (
            <>
              <div>
                <label htmlFor="auth-display" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  Display Name
                </label>
                <input
                  id="auth-display"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>
              <div>
                <label htmlFor="auth-email" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                  Admin Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
                />
              </div>
            </>
          )}

          <div>
            <label htmlFor="auth-password" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              required
              minLength={auth.needsSetup ? 8 : 1}
              placeholder={auth.needsSetup ? 'Minimum 8 characters' : 'Enter password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
            />
          </div>

          {auth.needsSetup && (
            <div>
              <label htmlFor="auth-confirm" className="block text-xs font-medium text-[#94A3B8] mb-1.5">
                Confirm Password
              </label>
              <input
                id="auth-confirm"
                type="password"
                required
                minLength={8}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#080B12] border border-slate-800 text-sm text-[#F8FAFC] focus:outline-none focus:border-[#7655FF]"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 px-4 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] disabled:opacity-60 text-white text-sm font-medium transition-colors cursor-pointer"
          >
            {submitting
              ? 'Processing...'
              : auth.needsSetup
                ? 'Claim Admin Account'
                : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
