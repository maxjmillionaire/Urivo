"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/*
 * Records a real transfer to a creator, settling everything currently owed.
 *
 * The amount is never sent from here — the server computes it from the locked
 * set of owed commissions. This form only captures how the money was actually
 * sent, so a creator query can be answered from one row later.
 */
export function PayoutButton({
  creatorId,
  creatorName,
  owedEur,
  owedCount,
}: {
  creatorId: string;
  creatorName: string;
  owedEur: number;
  owedCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (owedCount === 0) {
    return <span className="text-xs text-white/30">nothing owed</span>;
  }

  async function record() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId, method, reference, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Could not record the payout.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-300/20"
      >
        Record payout
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-white/15 bg-white/[0.04] p-4 text-left">
      <p className="text-sm text-white/80">
        Settle <span className="font-semibold text-white">€{owedEur.toFixed(2)}</span> to{" "}
        <span className="font-semibold text-white">{creatorName}</span>
        <span className="text-white/50"> · {owedCount} commission{owedCount === 1 ? "" : "s"}</span>
      </p>
      <p className="mt-1 text-xs text-white/40">
        Send the money first, then record it here. This does not move funds.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-white/50">
          Method
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1220] px-2.5 py-2 text-sm text-white"
          >
            <option value="bank_transfer">Bank transfer</option>
            <option value="paypal">PayPal</option>
            <option value="wise">Wise</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="text-xs text-white/50">
          Reference
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="TX-0001"
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1220] px-2.5 py-2 text-sm text-white placeholder:text-white/25"
          />
        </label>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        className="mt-2 w-full rounded-lg border border-white/10 bg-[#0b1220] px-2.5 py-2 text-sm text-white placeholder:text-white/25"
      />

      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={record}
          disabled={busy}
          className="rounded-lg bg-amber-300 px-3.5 py-2 text-xs font-semibold text-[#0b1220] disabled:opacity-60"
        >
          {busy ? "Recording…" : `Record €${owedEur.toFixed(2)} as paid`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="rounded-lg border border-white/15 px-3.5 py-2 text-xs font-semibold text-white/70 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
