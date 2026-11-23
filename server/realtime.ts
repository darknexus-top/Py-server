import type { Response } from 'express';
import { getMetricsSummary, getSetting } from './db.ts';

const sseClients = new Set<Response>();
const SERVER_BOOT_TIME = Date.now();

export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - SERVER_BOOT_TIME) / 1000);
}

export function registerSseClient(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  sseClients.add(res);

  sendEventToClient(res, 'snapshot', buildTelemetrySnapshot());

  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      sseClients.delete(res);
      return;
    }
    sendEventToClient(res, 'heartbeat', {
      uptime_seconds: getUptimeSeconds(),
      timestamp: new Date().toISOString(),
      online: true,
    });
  }, 3000);

  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

function sendEventToClient(res: Response, eventName: string, payload: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function buildTelemetrySnapshot() {
  const summary = getMetricsSummary();
  return {
    online: true,
    uptime_seconds: getUptimeSeconds(),
    timestamp: new Date().toISOString(),
    metrics: {
      total_requests: summary.total_requests,
      success_requests: summary.success_requests,
      failed_requests: summary.failed_requests,
      avg_latency_ms: summary.avg_latency_ms,
    },
    integrations: {
      nagad: {
        mode: getSetting('nagad_mock_mode', 'true') === 'true' ? 'mock' : 'live',
        status: 'ready',
      },
      truecaller: {
        mode: getSetting('truecaller_mock_mode', 'true') === 'true' ? 'mock' : 'live',
        status: 'ready',
      },
    },
    recent_logs: summary.recent_logs,
  };
}

export function broadcastTelemetryUpdate(latestLog?: Record<string, unknown>): void {
  if (sseClients.size === 0) return;
  const snapshot = buildTelemetrySnapshot();
  for (const client of sseClients) {
    sendEventToClient(client, 'snapshot', snapshot);
    if (latestLog) {
      sendEventToClient(client, 'activity', latestLog);
    }
  }
}
