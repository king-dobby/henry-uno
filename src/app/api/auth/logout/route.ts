import { NextResponse } from "next/server";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { portalApi } from "@/lib/api";

export async function POST() {
  // Fire-and-forget logout telemetry — must never block or fail the logout.
  try {
    const user = await getSession();
    if (user) {
      void portalApi("/api/telemetry/events", {
        method: "POST",
        body: {
          session_id: crypto.randomUUID(),
          surface: "portal",
          events: [
            {
              event_id: crypto.randomUUID(),
              action_type: "logout",
              occurred_at: new Date().toISOString(),
              page_path: "/api/auth/logout",
            },
          ],
        },
        userId: user.id,
        userEmail: user.email,
      }).catch(() => {});
    }
  } catch {
    // ignore — logout proceeds regardless
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
