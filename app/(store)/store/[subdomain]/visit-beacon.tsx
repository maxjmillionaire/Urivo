"use client";

import { useEffect } from "react";

/*
 * Anonymous storefront visit beacon. Fires once per browser session per store
 * so the merchant's Command Center can show real Visitors + Conversion. The
 * session is the server-issued HttpOnly commerce cookie (spec 10 §2), which
 * this file cannot read and does not need to: the browser attaches it to the
 * request automatically, and /api/track takes it from there.
 *
 * No identifier is written to the visitor's device from here. An earlier
 * version minted one in sessionStorage; the server stopped reading it when the
 * cookie arrived, and it survived for a release as dead weight — an id stored
 * on someone's machine for no purpose, while the specification claimed none
 * existed. Removed.
 *
 * The one thing still kept locally is a boolean "already counted this store",
 * which carries no id and cannot be used to recognise anybody.
 */

export function VisitBeacon({ subdomain }: { subdomain: string }) {
  useEffect(() => {
    // Once per store per session — a sent flag avoids double-counting SPA nav.
    const flag = `urivo_seen_${subdomain}`;
    try {
      if (sessionStorage.getItem(flag)) return;
    } catch {
      return;
    }
    /*
     * ?uc= is the ad that sent this visitor — Urivo's own tracking link. It is
     * read once, on the first pageview of the session, which is what makes the
     * attribution FIRST touch: the ad that introduced the brand gets the sale,
     * not whatever retargeting ad happened to run last.
     */
    const params = new URLSearchParams(window.location.search);
    const payload = JSON.stringify({
      subdomain,
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
