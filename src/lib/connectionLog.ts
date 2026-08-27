/**
 * Lightweight, dependency-free log of every request FrostLine makes to its
 * own /api/fortyguard/* proxy (which mirrors 1:1 what the proxy then sends
 * to the real FortyGuard API — same method, same body shape, just with the
 * api-key header attached server-side). Powers the "FortyGuard connection"
 * badge + inspector panel in main.ts so the live/simulated data question
 * never requires opening devtools.
 *
 * Deliberately a tiny pub-sub, not a state library — this app has no other
 * shared client state and doesn't need one.
 */

export type ConnectionStatus = "unknown" | "connected" | "fallback" | "not_configured";

export interface ConnectionLogEntry {
  id: string;
  timestamp: number;
  /** Human-friendly name, e.g. "Submit heatmap request" — the technical method+url is shown alongside it. */
  label: string;
  method: string;
  url: string;
  requestBody?: unknown;
  status: "pending" | "success" | "error";
  statusCode?: number;
  durationMs?: number;
  responseBody?: unknown;
  errorMessage?: string;
}

type Listener = () => void;

const MAX_ENTRIES = 40;

let entries: ConnectionLogEntry[] = [];
let status: ConnectionStatus = "unknown";
let nextId = 0;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEntries(): ConnectionLogEntry[] {
  return entries;
}

export function getStatus(): ConnectionStatus {
  return status;
}

export function setStatus(next: ConnectionStatus) {
  status = next;
  notify();
}

export function startEntry(
  label: string,
  method: string,
  url: string,
  requestBody?: unknown
): string {
  const id = `log-${nextId++}`;
  entries = [
    { id, timestamp: Date.now(), label, method, url, requestBody, status: "pending" as const },
    ...entries,
  ].slice(0, MAX_ENTRIES);
  notify();
  return id;
}

export function finishEntry(id: string, patch: Partial<ConnectionLogEntry>) {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  notify();
}

export function clearLog() {
  entries = [];
  notify();
}
