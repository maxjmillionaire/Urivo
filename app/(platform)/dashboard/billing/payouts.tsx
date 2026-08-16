"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import type { ConnectState } from "@/lib/billing/connect";

/*
 * Payout setup — the merchant's Stripe Connect state, stated plainly. A store
 * that cannot accept payments must say so here rather than failing silently at
 * a customer's checkout, so every state gets honest copy and one clear action.
 */

const COPY: Record<
  ConnectState,
  { label: string; tone: "idle" | "progress" | "ready" | "alert"; title: string; body: string; cta: string }
> = {
  not_started: {
    label: "Not set up",
    tone: "idle",
    title: "Set up payouts to start selling",
    body: "Connect a payout account so orders from your storefronts pay out to your bank. It takes a couple of minutes, and Stripe handles the details.",
    cta: "Set up payouts",
  },
  in_progress: {
    label: "Incomplete",
    tone: "progress",
    title: "Finish setting up payouts",
    body: "You started payout setup but didn't finish. Your stores can't accept orders until it's complete.",
    cta: "Continue setup",
  },
  pending: {
    label: "Under review",
    tone: "progress",
    title: "Stripe is reviewing your details",
    body: "Everything is submitted. Stripe usually confirms within a few minutes — we'll notify you the moment your stores can accept orders.",
    cta: "Check status",
  },
  restricted: {
    label: "Action needed",
    tone: "alert",
    title: "Your stores can't take payments",
    body: "Stripe needs more information before your storefronts can accept orders. Opening setup will show you exactly what's missing.",
    cta: "Resolve now",
  },
  ready: {
    label: "Active",
    tone: "ready",
    title: "Your stores can accept payments",
    body: "Orders pay out directly to your bank account — Urivo never holds your money. Open your Stripe dashboard for payouts, bank details and tax documents.",
    cta: "Open Stripe dashboard",
  },
};

const DOT: Record<"idle" | "progress" | "ready" | "alert", string> = {
  idle: "bg-mist-dim",
  progress: "bg-gold",
  ready: "bg-emerald-400",
  alert: "bg-rose-400",
};

export function PayoutSetup({ state }: { state: ConnectState }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const copy = COPY[state];

  async function open() {
    track("payout_setup_clicked", { state });
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/connect/onboard", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setNote(data.message || "Payout setup isn't available right now.");
    } catch {
      setNote("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="u-float rounded-2xl border border-hair bg-panel/70 p-6">
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[copy.tone]}`} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">
          Payouts &middot; {copy.label}
        </p>
      </div>
      <p className="mt-3 text-[17px] font-semibold tracking-tight text-ivory">{copy.title}</p>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist">{copy.body}</p>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`u-lift mt-5 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60 ${
          state === "ready"
            ? "border border-hair bg-panel text-ivory hover:border-hair-strong hover:bg-panel-2"
            : "u-gold"
        }`}
      >
        {busy ? "One moment…" : copy.cta}
      </button>
      {note && <p className="mt-3 text-xs text-mist">{note}</p>}
    </div>
  );
}
