"use client";

import { useState } from "react";

/*
 * Free-generation kill switch (2.4). The 3am brake: one click suspends all free
 * generations immediately; paying accounts are never affected. Optimistic on
 * success, reverts on failure.
 */
export function FreeGenerationsSwitch({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const next = !enabled;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ freeGenerationsEnabled: next }),
      });
      if (!res.ok) throw new Error("failed");
      setEnabled(next);
    } catch {
      setErr("Could not update. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4 ${
        enabled ? "border-white/10 bg-white/[0.03]" : "border-red-400/40 bg-red-400/10"
      }`}
    >
      <div>
        <p className="text-sm font-semibold">
          Free store generation
          <span
            className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              enabled ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/20 text-red-200"
            }`}
          >
            {enabled ? "Enabled" : "Paused"}
          </span>
        </p>
        <p className="mt-1 text-xs text-white/50">
          {enabled
            ? "Free accounts can generate stores. Click to pause instantly if inference spend runs away."
            : "Free accounts are blocked from generating. Paying accounts are unaffected."}
        </p>
        {err && <p className="mt-1 text-xs text-red-300">{err}</p>}
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
          enabled
            ? "bg-red-500/90 text-white hover:bg-red-500"
            : "bg-emerald-500/90 text-white hover:bg-emerald-500"
        }`}
      >
        {busy ? "One moment…" : enabled ? "Pause free generations" : "Resume free generations"}
      </button>
    </div>
  );
}
