"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { CREDIT_PACKS, CREDIT_PACK_ORDER, packStores, savingsPct, type CreditPack } from "@/lib/credit-packs";

/*
 * Credit packs — one-time top-ups. Studio is center-stage (the honest default);
 * Scale anchors high and carries the real biggest saving. Ethical persuasion
 * only: true % savings, tangible "= N stores" framing, no urgency, no scarcity.
 */

function BuyButton({ pack, highlight }: { pack: CreditPack; highlight: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function buy() {
    track("credit_pack_clicked", { pack: pack.id });
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: pack.id }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      setNote(data.message || "Credit packs aren't available right now.");
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
        onClick={buy}
        disabled={busy}
        className={`u-lift w-full rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60 ${
          highlight ? "u-gold" : "border border-hair bg-panel text-ivory hover:border-hair-strong hover:bg-panel-2"
        }`}
      >
        {busy ? "One moment…" : `Buy ${pack.name}`}
      </button>
      {note && <p className="mt-2 text-center text-[11px] text-mist">{note}</p>}
    </div>
  );
}

export function CreditPacks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`grid gap-3 ${compact ? "sm:grid-cols-3" : "sm:grid-cols-3 gap-4"}`}>
      {CREDIT_PACK_ORDER.map((id) => {
        const pack = CREDIT_PACKS[id];
        const popular = pack.id === "studio";
        const save = savingsPct(pack);
        return (
          <div
            key={pack.id}
            className={`u-float relative flex flex-col rounded-2xl bg-panel/70 ${compact ? "p-4" : "p-6"} ${
              popular ? "border border-gold/35" : "border border-hair"
            }`}
          >
            {pack.badge && (
              <span
                className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  popular ? "u-gold" : "border border-hair-strong bg-panel-2 text-gold-soft"
                }`}
              >
                {pack.badge}
              </span>
            )}
            <div className="flex items-baseline justify-between">
              <h3 className={`font-semibold text-ivory ${compact ? "text-base" : "text-lg"}`}>{pack.name}</h3>
              {save > 0 && <span className="text-[11px] font-semibold text-live">−{save}%</span>}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className={`font-semibold tracking-tight text-ivory ${compact ? "text-2xl" : "text-3xl"}`}>
                €{pack.priceEUR}
              </span>
              <span className="text-xs text-mist">once</span>
            </div>
            <p className="mt-2 text-sm text-ivory">
              {pack.credits} credits
              <span className="text-mist">
                {" "}· {packStores(pack)} store{packStores(pack) === 1 ? "" : "s"}
              </span>
            </p>
            <div className={compact ? "mt-3" : "mt-5"}>
              <BuyButton pack={pack} highlight={popular} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
