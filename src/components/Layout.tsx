import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  Blocks,
  LogIn,
  LogOut,
  Menu,
  PhoneCall,
  Settings,
  ShieldCheck,
  User,
  Wallet,
  X,
} from 'lucide-react';
import type { AuthStatus } from '../types';

interface LayoutProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  auth: AuthStatus;
  sseConnected: boolean;
  onLogout: () => void;
  children: ReactNode;
}

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: Activity },
  { path: '/Nagat', label: 'Nagad', icon: Wallet },
  { path: '/Truecaller', label: 'Truecaller', icon: PhoneCall },
  { path: '/all', label: 'Integrations', icon: Blocks },
  { path: '/me', label: 'Profile & Keys', icon: User },
  { path: '/settings', label: 'Server Settings', icon: Settings },
];

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/me': 'Profile & API Keys',
  '/Nagat': 'Nagad Integration',
  '/Truecaller': 'Truecaller Integration',
  '/all': 'All Integrations & API Docs',
  '/settings': 'Server Settings',
  '/login': 'Admin Access',
};

export function Layout({
  currentPath,
  onNavigate,
  auth,
  sseConnected,
  onLogout,
  children,
}: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentTitle = ROUTE_TITLES[currentPath] || 'Dashboard';

  const handleLinkClick = (path: string) => {
    onNavigate(path);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#080B12] text-[#F8FAFC] flex">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#0B0F19] border-r border-slate-800/80 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-800/80">
          <button
            type="button"
            onClick={() => handleLinkClick('/')}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <div className="w-7 h-7 rounded-lg bg-[#7655FF] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-sm tracking-tight text-[#F8FAFC] whitespace-nowrap">
              INFINITY NETWORK
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="lg:hidden text-[#94A3B8] hover:text-[#F8FAFC] p-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1 overflow-y-auto" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = currentPath === item.path;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => handleLinkClick(item.path)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-[#7655FF]/15 text-[#F8FAFC] border border-[#7655FF]/40'
                    : 'text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#7655FF]' : 'text-[#94A3B8]'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 space-y-3">
          {auth.authenticated && (
            <div className="flex items-center justify-between text-xs text-[#94A3B8]">
              <span>Telemetry Stream</span>
              <span className={`font-mono ${sseConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                {sseConnected ? 'Connected' : 'Connecting'}
              </span>
            </div>
          )}

          {auth.authenticated && auth.user ? (
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="min-w-0">
                <p className="text-xs font-medium text-[#F8FAFC] truncate">{auth.user.displayName}</p>
                <p className="text-xs text-[#94A3B8] truncate">{auth.user.username}</p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                title="Sign out"
                className="p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-slate-800/60 transition-colors shrink-0 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => handleLinkClick('/login')}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>{auth.needsSetup ? 'Setup Admin Access' : 'Admin Sign In'}</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 px-4 sm:px-8 border-b border-slate-800/80 bg-[#080B12]/90 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg text-[#94A3B8] hover:text-[#F8FAFC] hover:bg-slate-800/60"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-[#94A3B8] hidden sm:inline whitespace-nowrap">Infinity Network</span>
              <span className="text-slate-600 hidden sm:inline">/</span>
              <h1 className="font-semibold text-[#F8FAFC] truncate">{currentTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {auth.authenticated ? (
              <button
                type="button"
                onClick={() => handleLinkClick('/all')}
                className="px-4 py-2 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                API Tester
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleLinkClick('/login')}
                className="px-4 py-2 rounded-lg bg-[#7655FF] hover:bg-[#6544ee] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {auth.needsSetup ? 'Claim Admin' : 'Sign In'}
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1360px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
