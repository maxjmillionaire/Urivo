"use client";

import { useEffect } from "react";

/*
 * Anonymous storefront visit beacon. Fires once per browser session per store
 * so the merchant's Command Center can show real Visitors + Conversion. The
 * session id is a random string held in sessionStorage — cookieless, no PII,
 * cleared when the tab closes. Never rendered for owner previews.
 */

function sessionId(): string {
  const KEY = "urivo_sid";
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function VisitBeacon({ subdomain }: { subdomain: string }) {
  useEffect(() => {
    // Once per store per session — a sent flag avoids double-counting SPA nav.
    const flag = `urivo_seen_${subdomain}`;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      return;
    }
    const sid = sessionId();
    if (!sid) return;

    /*
     * ?uc= is the ad that sent this visitor — Urivo's own tracking link. It is
     * read once, on the first pageview of the session, which is what makes the
     * attribution FIRST touch: the ad that introduced the brand gets the sale,
     * not whatever retargeting ad happened to run last.
     */
    const params = new URLSearchParams(window.location.search);
    const payload = JSON.stringify({
      subdomain,
      sid,
      path: window.location.pathname,
      uc: params.get("uc") ?? undefined,
      campaign: params.get("utm_campaign") ?? undefined,
      source: params.get("utm_source") ?? undefined,
    });
    try {
      sessionStorage.setItem(flag, "1");
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
      } else {
        void fetch("/api/track", { method: "POST", body: payload, headers: { "Content-Type": "application/json" }, keepalive: true });
      }
    } catch {
      /* never let analytics disturb the storefront */
    }
  }, [subdomain]);

  return null;
}
