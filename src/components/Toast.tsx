import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import type { ToastMessage } from '../types';

interface ToastStackProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon =
          toast.type === 'success' ? CheckCircle2 : toast.type === 'error' ? AlertCircle : Info;
        const iconColor =
          toast.type === 'success'
            ? 'text-emerald-400'
            : toast.type === 'error'
              ? 'text-rose-400'
              : 'text-[#06B6D4]';

        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 bg-[#111827] border border-slate-700/80 rounded-lg px-4 py-3 shadow-xl transition-all duration-150"
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#F8FAFC] leading-snug">{toast.title}</p>
              {toast.detail && (
                <p className="text-xs text-[#94A3B8] mt-0.5 break-words">{toast.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="text-[#94A3B8] hover:text-[#F8FAFC] p-0.5 transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
