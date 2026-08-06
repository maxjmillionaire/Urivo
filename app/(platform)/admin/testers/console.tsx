"use client";

import { useCallback, useEffect, useState } from "react";

/*
 * Tester console. Grant a real plan to somebody who is not paying, for a fixed
 * number of days, and see who currently has one.
 *
 * The refusals are the interesting part of this screen. The database will not
 * comp an account that has a live Stripe subscription, and rather than showing
 * "error" the console prints the reason in full — because the admin's next
 * action depends entirely on which refusal it was.
 */

interface CompedAccount {
  email: string;
  full_name: string | null;
  plan: string;
  comp_reason: string | null;
  comped_until: string;
  credits: number;
  stores: number;
}

const PRESETS = [
  { label: "Tester · Founder, 14 days", plan: "core" as const, days: 14, credits: 150, reason: "launch tester" },
  { label: "Tester · Pro, 14 days", plan: "pro" as const, days: 14, credits: 400, reason: "launch tester" },
  { label: "Make-good · Founder, 30 days", plan: "core" as const, days: 30, credits: 150, reason: "make-good" },
];

function remaining(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? "" : "s"} left`;
  return `${Math.max(1, Math.floor(ms / 3_600_000))} h left`;
}

export function TesterConsole() {
  const [accounts, setAccounts] = useState<CompedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<"core" | "pro">("core");
  const [days, setDays] = useState(14);
  const [credits, setCredits] = useState(150);
  const [reason, setReason] = useState("launch tester");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/testers");
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { accounts: CompedAccount[] };
      setAccounts(json.accounts ?? []);
    } catch {
      setMessage({
        tone: "bad",
        text: "Could not load the list. If migration 0035 has not been applied yet, that is why.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant() {
    if (!email.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/testers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), plan, days, credits, reason }),
      });
      const json = (await res.json()) as { detail?: string; error?: string; expiresAt?: string };
      if (!res.ok) {
        setMessage({ tone: "bad", text: json.detail ?? json.error ?? "The grant was refused." });
        return;
      }
      setMessage({
        tone: "ok",
        text: `${email.trim()} now has ${plan === "pro" ? "Pro" : "Founder"} until ${new Date(
          json.expiresAt!,
        ).toLocaleDateString("de-DE", { day: "numeric", month: "long" })}.`,
      });
      setEmail("");
      await load();
    } catch {
      setMessage({ tone: "bad", text: "The request did not complete. Nothing was granted." });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(target: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/testers?email=${encodeURIComponent(target)}`, {
        method: "DELETE",
      });
      const json = (await res.json()) as { detail?: string };
      if (!res.ok) {
        setMessage({ tone: "bad", text: json.detail ?? "Could not revoke." });
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="text-sm font-semibold">Grant access</h2>
        <p className="mt-1 text-xs text-white/50">
          The person must already have a Urivo account — access is granted to a real signup, never
          created here, so email confirmation and the signup checks still apply.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setPlan(p.plan);
                setDays(p.days);
                setCredits(p.credits);
                setReason(p.reason);
              }}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-amber-300/40 hover:text-white"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="lg:col-span-2 text-xs text-white/50">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tester@example.com"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:border-amber-300/50 focus:outline-none"
            />
          </label>
          <label className="text-xs text-white/50">
            Plan
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value as "core" | "pro")}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-amber-300/50 focus:outline-none"
            >
              <option value="core">Founder</option>
              <option value="pro">Pro</option>
            </select>
          </label>
          <label className="text-xs text-white/50">
            Days
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-amber-300/50 focus:outline-none"
            />
          </label>
          <label className="text-xs text-white/50">
            Credits
            <input
              type="number"
              min={0}
              max={5000}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-amber-300/50 focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[16rem] flex-1 text-xs text-white/50">
            Reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-amber-300/50 focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={grant}
            disabled={busy || !email.trim()}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-black transition-opacity hover:bg-amber-300 disabled:opacity-40"
          >
            {busy ? "Working…" : "Grant"}
          </button>
        </div>

        {message && (
          <p
            className={`mt-3 text-xs ${message.tone === "ok" ? "text-emerald-300" : "text-red-300"}`}
          >
            {message.text}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold">
          Currently comped{accounts.length > 0 && <span className="text-white/40"> · {accounts.length}</span>}
        </h2>
        {loading ? (
          <p className="mt-3 text-xs text-white/40">Loading…</p>
        ) : accounts.length === 0 ? (
          <p className="mt-3 text-xs text-white/40">
            Nobody has granted access right now. Every grant expires by itself — access that quietly
            became permanent would be indistinguishable from a pricing leak.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-white/40">
                <tr>
                  {["Account", "Plan", "Reason", "Expires", "Credits", "Stores", ""].map((h) => (
                    <th key={h} className="border-b border-white/10 pb-2 pr-4 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.email} className="border-b border-white/5">
                    <td className="py-2.5 pr-4">
                      <span className="text-white/90">{a.email}</span>
                      {a.full_name && <span className="ml-2 text-xs text-white/40">{a.full_name}</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-white/70">{a.plan === "pro" ? "Pro" : "Founder"}</td>
                    <td className="py-2.5 pr-4 text-white/50">{a.comp_reason ?? "—"}</td>
                    <td className="py-2.5 pr-4 text-white/70">{remaining(a.comped_until)}</td>
                    <td className="py-2.5 pr-4 text-white/70">{a.credits}</td>
                    <td className="py-2.5 pr-4 text-white/70">{a.stores}</td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => revoke(a.email)}
                        disabled={busy}
                        className="text-xs text-red-300/80 transition-colors hover:text-red-200 disabled:opacity-40"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
