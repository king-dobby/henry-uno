// Client-side telemetry queue. Batches user-activity events and posts them to
// /api/telemetry (same-origin, cookie auth). Best-effort: never throws, never
// captures input values, silently drops on failure.

export type TelemetryAction =
  | "login"
  | "logout"
  | "session_start"
  | "session_end"
  | "page_view"
  | "tab_view"
  | "click"
  | "mutation"
  | "feature_use";

export interface TelemetryEvent {
  event_id: string;
  action_type: TelemetryAction;
  occurred_at: string;
  page_path?: string;
  feature_name?: string;
  element?: string;
  metadata?: Record<string, unknown>;
  duration_seconds?: number;
}

const SESSION_ID_KEY = "henry_portal_session_tid";
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_AT_COUNT = 50;
const MAX_QUEUE = 200;

let queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let disabled = false; // set on 401 — stop flushing until next page load
let listenersInstalled = false;
let fallbackSessionId: string | null = null;

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = uuid();
    sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    // sessionStorage unavailable — fall back to a per-page-load id
    if (!fallbackSessionId) fallbackSessionId = uuid();
    return fallbackSessionId;
  }
}

export function track(
  action: TelemetryAction,
  fields: Partial<Omit<TelemetryEvent, "event_id" | "action_type" | "occurred_at">> = {}
): void {
  if (typeof window === "undefined") return;
  try {
    queue.push({
      event_id: uuid(),
      action_type: action,
      occurred_at: new Date().toISOString(),
      ...fields,
    });
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
    installListeners();
    if (queue.length >= FLUSH_AT_COUNT) {
      void flushNow();
    } else {
      scheduleFlush();
    }
  } catch {
    // telemetry must never break the app
  }
}

export async function flushNow(): Promise<void> {
  if (typeof window === "undefined" || disabled || queue.length === 0) return;
  const events = queue.splice(0, MAX_QUEUE);
  clearTimer();
  try {
    const res = await fetch("/api/telemetry", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: getSessionId(), surface: "portal", events }),
    });
    if (res.status === 401) {
      // Unauthenticated — no-op until the next page load
      disabled = true;
      queue = [];
    }
  } catch {
    // network failure — drop the batch, telemetry is best-effort
  }
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushNow();
  }, FLUSH_INTERVAL_MS);
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function installListeners(): void {
  if (listenersInstalled || typeof window === "undefined") return;
  listenersInstalled = true;
  window.addEventListener("pagehide", () => {
    void flushNow();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushNow();
  });
}
