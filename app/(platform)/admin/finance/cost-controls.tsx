"use client";

import { useState } from "react";

/*
 * The three dials that decide what Urivo spends and what it believes spending
 * costs: the daily alert ladder, the monthly budget, and the real per-image
 * price.
 *
 * The image field is the important one. That single number is roughly two
 * thirds of what a free signup costs, and until it is measured every figure
 * derived from it is provisional. Saving it also rebases the entire ledger
 * history — exact, because each row stores its image COUNT — so the month stops
 * being a mixture of the old assumption and the new fact. The control says how
 * many rows it corrected, because a silent rewrite of financial history would
 * be worse than no rewrite at all.
 */

export function CostControls({
  thresholds,
  budgetEur,
  imageCostUsd,
  imageCostSource,
}: {
  thresholds: number[];
  budgetEur: number;
  imageCostUsd: number;
  imageCostSource: "estimated" | "measured";
}) {
  const [thresholdText, setThresholdText] = useState(thresholds.join(", "));
  const [budget, setBudget] = useState(String(budgetEur || ""));
  const [imageCost, setImageCost] = useState(imageCostUsd.toFixed(4));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function save(payload: Record<string, unknown>, describe: (r: Record<string, unknown>) => string) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setNote({ tone: "bad", text: String(json.detail ?? "Could not save.") });
        return;
      }
      setNote({ tone: "ok", text: describe(json) });
    } catch {
      setNote({ tone: "bad", text: "The request did not complete. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  const parsedThresholds = thresholdText
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <div>
          <label className="text-xs uppercase tracking-wide text-white/45">
            Daily alert thresholds (€)
          </label>
          <input
            value={thresholdText}
            onChange={(e) => setThresholdText(e.target.value)}
            placeholder="25, 50, 100"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm tabular-nums text-white focus:border-amber-300/50 focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-white/40">
            Each fires once a day, so a runaway day escalates instead of going quiet after the
            first email.
          </p>
          <button
            type="button"
            disabled={busy || parsedThresholds.length === 0}
            onClick={() => save({ spendThresholdsEur: parsedThresholds }, () => `Alerting at €${parsedThresholds.sort((a, b) => a - b).join(", €")}.`)}
            className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-amber-300/40 hover:text-white disabled:opacity-40"
          >
            Save thresholds
          </button>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-white/45">
            Monthly AI budget (€)
          </label>
          <input
            type="number"
            min={0}
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="0 = none"
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm tabular-nums text-white focus:border-amber-300/50 focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-white/40">
            Turns &ldquo;remaining budget&rdquo; into a real number and lets the month-end
            projection say whether you are heading over it.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ monthlyAiBudgetEur: Number(budget) || 0 }, () => "Budget saved.")}
            className="mt-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 transition-colors hover:border-amber-300/40 hover:text-white disabled:opacity-40"
          >
            Save budget
          </button>
        </div>

        <div
          className={`rounded-lg p-3 ${
            imageCostSource === "measured" ? "" : "border border-amber-300/30 bg-amber-300/5"
          }`}
        >
          <label className="text-xs uppercase tracking-wide text-white/45">
            Cost per image ($)
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                imageCostSource === "measured"
                  ? "bg-emerald-400/15 text-emerald-300"
                  : "bg-amber-400/20 text-amber-200"
              }`}
            >
              {imageCostSource}
            </span>
          </label>
          <input
            type="number"
            step="0.0001"
            min={0}
            value={imageCost}
            onChange={(e) => setImageCost(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm tabular-nums text-white focus:border-amber-300/50 focus:outline-none"
          />
          <p className="mt-1.5 text-xs text-white/40">
            Roughly two thirds of what a free signup costs. Saving a measured rate also{" "}
            <strong className="font-medium text-white/60">rewrites every historical row</strong> at
            the new price, so the month is not a mixture of two assumptions.
          </p>
          <button
            type="button"
            disabled={busy || !Number.isFinite(Number(imageCost))}
            onClick={() =>
              save(
                { imageCostUsd: Number(imageCost), imageCostSource: "measured" },
                (r) =>
                  `Saved as measured. ${Number(r.rowsRebased ?? 0)} historical action${
                    Number(r.rowsRebased ?? 0) === 1 ? "" : "s"
                  } recalculated at $${Number(imageCost).toFixed(4)}/image.`,
              )
            }
            className="mt-2 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:bg-amber-300 disabled:opacity-40"
          >
            Save as measured &amp; rebase history
          </button>
        </div>
      </div>

      {note && (
        <p className={`text-xs ${note.tone === "ok" ? "text-emerald-300" : "text-red-300"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
