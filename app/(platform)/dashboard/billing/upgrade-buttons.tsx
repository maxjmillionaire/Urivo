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
        className={`u-lift w-full rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-60 ${
          highlight
            ? "u-gold"
            : "border border-hair bg-panel text-ivory hover:border-hair-strong hover:bg-panel-2"
        }`}
      >
        {busy ? "One moment…" : label}
      </button>
      {note && <p className="mt-3 text-center text-xs text-mist">{note}</p>}
    </div>
  );
}
