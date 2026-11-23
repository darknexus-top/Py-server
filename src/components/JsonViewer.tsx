import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface JsonViewerProps {
  title: string;
  data: unknown;
  statusCode?: number;
  latencyMs?: number;
}

export function JsonViewer({ title, data, statusCode, latencyMs }: JsonViewerProps) {
  const [copied, setCopied] = useState(false);
  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="bg-[#0B0F19] border border-slate-800/80 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-slate-800/80 bg-[#111827]/70">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-medium text-[#F8FAFC] truncate">{title}</span>
          {statusCode !== undefined && (
            <span
              className={`font-mono text-xs tabular-nums ${
                statusCode >= 200 && statusCode < 400 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              HTTP {statusCode}
            </span>
          )}
          {latencyMs !== undefined && (
            <span className="font-mono text-xs tabular-nums text-[#94A3B8]">
              · {latencyMs} ms
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#F8FAFC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-96 leading-relaxed">
        {formatted}
      </pre>
    </div>
  );
}
