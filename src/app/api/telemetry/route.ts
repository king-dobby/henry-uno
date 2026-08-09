import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { portalApi } from "@/lib/api";

const MAX_EVENTS = 200;

const ACTION_TYPES = new Set([
  "login",
  "logout",
  "session_start",
  "session_end",
  "page_view",
  "tab_view",
  "click",
  "mutation",
  "feature_use",
]);

function sanitizeEvent(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.event_id !== "string" || !e.event_id) return null;
  if (typeof e.occurred_at !== "string" || !e.occurred_at) return null;
  if (typeof e.action_type !== "string" || !ACTION_TYPES.has(e.action_type)) return null;

  const out: Record<string, unknown> = {
    event_id: e.event_id.slice(0, 64),
    action_type: e.action_type,
    occurred_at: e.occurred_at.slice(0, 40),
  };
  if (typeof e.page_path === "string") out.page_path = e.page_path.slice(0, 300);
  if (typeof e.feature_name === "string") out.feature_name = e.feature_name.slice(0, 120);
  if (typeof e.element === "string") out.element = e.element.slice(0, 160);
  if (typeof e.duration_seconds === "number" && Number.isFinite(e.duration_seconds)) {
    out.duration_seconds = e.duration_seconds;
  }
  if (e.metadata && typeof e.metadata === "object" && !Array.isArray(e.metadata)) {
    out.metadata = e.metadata;
  }
  return out;
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const sessionId = typeof b.session_id === "string" ? b.session_id.slice(0, 64) : "";
  const rawEvents = Array.isArray(b.events) ? b.events : null;
  if (!sessionId || !rawEvents) {
    return NextResponse.json(
      { error: "session_id and events are required" },
      { status: 400 }
    );
  }

  const events = rawEvents
    .slice(0, MAX_EVENTS)
    .map(sanitizeEvent)
    .filter((e): e is Record<string, unknown> => e !== null);
  if (events.length === 0) {
    return NextResponse.json({ ok: true, accepted: 0 });
  }

  try {
    const result = await portalApi("/api/telemetry/events", {
      method: "POST",
      body: { session_id: sessionId, surface: "portal", events },
      userId: user.id,
      userEmail: user.email,
    });
    return NextResponse.json(result);
  } catch {
    // Backend down — never surface a 500 for telemetry
    return NextResponse.json({ queued: false }, { status: 202 });
  }
}
