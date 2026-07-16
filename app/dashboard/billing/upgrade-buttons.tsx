"use client";

import { useState } from "react";

/*
 * Upgrade CTA. Calls the checkout entry point; until Stripe is wired
 * (Phase 2) it surfaces the graceful "opens at launch" message.
 */
export function UpgradeButton({
  plan,
  label,
  highlight,
}: {
  plan: "core" | "pro";
  label: string;
  highlight?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function upgrade() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setNote(data.message || "Checkout is not available right now.");
    } catch {
      setNote("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={upgrade}
        disabled={busy}
        className={`w-full rounded-lg px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 disabled:opacity-60 ${
          highlight
            ? "bg-gold-500 text-forest-900 hover:bg-champagne"
            : "border border-ivory-100/15 text-ivory-100/80 hover:border-ivory-100/30 hover:text-ivory-100"
        }`}
      >
        {busy ? "One moment…" : label}
      </button>
      {note && <p className="mt-3 text-center text-xs font-light text-gold-300">{note}</p>}
    </div>
  );
}
