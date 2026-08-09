"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track, flushNow } from "@/lib/telemetryClient";

const SESSION_STARTED_KEY = "henry_portal_session_started";

function labelFor(el: Element): string {
  return (
    el.getAttribute("aria-label") ||
    el.getAttribute("title") ||
    (el.textContent || "").trim().slice(0, 80) ||
    el.id ||
    el.tagName.toLowerCase()
  );
}

export default function TelemetryProvider() {
  const pathname = usePathname();

  // Page view on every mount / path change. Nav is full page loads, so this
  // covers all navigation. session_start fires once per tab session.
  useEffect(() => {
    try {
      let started = false;
      try {
        started = sessionStorage.getItem(SESSION_STARTED_KEY) === "1";
      } catch {
        // sessionStorage unavailable — treat every load as started
        started = true;
      }
      if (!started) {
        try {
          sessionStorage.setItem(SESSION_STARTED_KEY, "1");
        } catch {
          // ignore
        }
        track("session_start", { page_path: pathname });
      }
      track("page_view", { page_path: pathname });
    } catch {
      // telemetry must never break the app
    }
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      try {
        const target = e.target;
        if (!(target instanceof Element)) return;
        if (target instanceof HTMLInputElement && target.type === "password") return;
        const tracked = target.closest("[data-track]");
        const actionable = tracked || target.closest("a, button");
        if (!actionable) return;
        const element =
          tracked?.getAttribute("data-track") || labelFor(actionable);
        const inNav = actionable.closest("nav") !== null;
        track("click", {
          page_path: window.location.pathname,
          element,
          ...(inNav ? { feature_name: element } : {}),
        });
      } catch {
        // never break clicks
      }
    }

    function onPageHide() {
      try {
        track("session_end", { page_path: window.location.pathname });
        void flushNow();
      } catch {
        // ignore
      }
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  return null;
}
