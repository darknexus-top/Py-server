import { useCallback, useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { ToastStack } from './components/Toast';
import { apiRequest, setCsrfToken } from './lib/api';
import { AllIntegrationsPage } from './pages/AllIntegrationsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { MePage } from './pages/MePage';
import { NagadPage } from './pages/NagadPage';
import { SettingsPage } from './pages/SettingsPage';
import { TruecallerPage } from './pages/TruecallerPage';
import type { AuthStatus, TelemetrySnapshot, ToastMessage } from './types';

const VALID_PATHS = new Set(['/', '/me', '/Nagat', '/Truecaller', '/all', '/login', '/settings']);

function normalizeRoute(pathname: string): string {
  if (VALID_PATHS.has(pathname)) return pathname;
  return '/';
}

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(() =>
    normalizeRoute(window.location.pathname)
  );
  const [auth, setAuth] = useState<AuthStatus>({
    authenticated: false,
    needsSetup: false,
    user: null,
    csrfToken: null,
  });
  const [authLoaded, setAuthLoaded] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', title: string, detail?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, type, title, detail }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshAuth = useCallback(async () => {
    const res = await apiRequest<AuthStatus & { ok: boolean }>('/api/v1/auth/status');
    if (res.ok && res.data) {
      setAuth({
        authenticated: Boolean(res.data.authenticated),
        needsSetup: Boolean(res.data.needsSetup),
        user: res.data.user || null,
        csrfToken: res.data.csrfToken || null,
      });
      setCsrfToken(res.data.csrfToken || null);
    }
    setAuthLoaded(true);
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const onPopState = () => {
      setCurrentPath(normalizeRoute(window.location.pathname));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((targetPath: string) => {
    const normalized = normalizeRoute(targetPath);
    if (window.location.pathname !== normalized) {
      window.history.pushState({}, '', normalized);
    }
    setCurrentPath(normalized);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Subscribe to Server-Sent Events (SSE) when authenticated
  useEffect(() => {
    if (!auth.authenticated) {
      setTelemetry(null);
      setSseConnected(false);
      return;
    }

    const source = new EventSource('/api/v1/stream', { withCredentials: true });
    source.onopen = () => {
      setSseConnected(true);
    };
    source.addEventListener('snapshot', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as TelemetrySnapshot;
        setTelemetry(parsed);
        setSseConnected(true);
      } catch {
        // ignore parse errors
      }
    });
    source.addEventListener('heartbeat', (event) => {
      try {
        const hb = JSON.parse((event as MessageEvent).data) as { uptime_seconds: number; online: boolean };
        setTelemetry((prev) =>
          prev ? { ...prev, uptime_seconds: hb.uptime_seconds, online: hb.online } : prev
        );
      } catch {
        // ignore
      }
    });
    source.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      source.close();
      setSseConnected(false);
    };
  }, [auth.authenticated]);

  const handleLogout = async () => {
    await apiRequest('/api/v1/auth/logout', { method: 'POST' });
    setCsrfToken(null);
    await refreshAuth();
    notify('info', 'Signed out');
    navigate('/login');
  };

  if (!authLoaded) {
    return (
      <div className="min-h-screen bg-[#080B12] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#7655FF] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <>
      <Layout
        currentPath={currentPath}
        onNavigate={navigate}
        auth={auth}
        sseConnected={sseConnected}
        onLogout={handleLogout}
      >
        {currentPath === '/' && (
          <DashboardPage
            auth={auth}
            telemetry={telemetry}
            sseConnected={sseConnected}
            onNavigate={navigate}
            notify={notify}
          />
        )}
        {currentPath === '/me' && (
          <MePage auth={auth} onAuthChange={refreshAuth} onNavigate={navigate} notify={notify} />
        )}
        {currentPath === '/Nagat' && (
          <NagadPage auth={auth} onNavigate={navigate} notify={notify} />
        )}
        {currentPath === '/Truecaller' && (
          <TruecallerPage auth={auth} onNavigate={navigate} notify={notify} />
        )}
        {currentPath === '/all' && (
          <AllIntegrationsPage auth={auth} onNavigate={navigate} notify={notify} />
        )}
        {currentPath === '/settings' && (
          <SettingsPage auth={auth} onNavigate={navigate} notify={notify} />
        )}
        {currentPath === '/login' && (
          <LoginPage auth={auth} onAuthChange={refreshAuth} onNavigate={navigate} notify={notify} />
        )}
      </Layout>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
