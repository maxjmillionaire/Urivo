"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/*
 * The feedback inbox.
 *
 * Sorted open-first, newest-first, and grouped by nothing — during a test phase
 * the only question is "what is still broken", and any clever taxonomy just
 * hides items behind a filter nobody clicked.
 *
 * The route is displayed as prominently as the message on purpose. Two people
 * writing "it didn't work" from the same screen is a bug; from two different
 * screens it is two bugs, and the sentence alone cannot tell you which.
 */

interface Item {
  id: string;
  email: string;
  kind: string;
  message: string;
  route: string | null;
  plan: string | null;
  store_name: string | null;
  context: Record<string, unknown>;
  resolved_at: string | null;
  created_at: string;
}

const KIND_STYLE: Record<string, string> = {
  bug: "bg-red-400/15 text-red-200",
  confusing: "bg-amber-400/15 text-amber-200",
  idea: "bg-sky-400/15 text-sky-200",
  praise: "bg-emerald-400/15 text-emerald-200",
};

const KIND_LABEL: Record<string, string> = {
  bug: "Broke",
  confusing: "Stuck",
  idea: "Idea",
  praise: "Good",
};

function ago(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function FeedbackInbox() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/feedback?limit=300");
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { items: Item[] };
      setItems(json.items ?? []);
      setError(null);
    } catch {
      setError("Could not load. If migration 0036 has not been applied yet, that is why.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(id: string) {
    // Optimistic: triage is a rapid pass, and a spinner per row would slow it.
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, resolved_at: i.resolved_at ? null : new Date().toISOString() } : i)),
    );
    const res = await fetch("/api/admin/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) await load();
  }

  const open = items.filter((i) => !i.resolved_at);
  const visible = useMemo(() => (showResolved ? items : open), [items, open, showResolved]);

  /* Where things break, not just how often — the funnel view of the same data. */
  const byRoute = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of open) {
      if (i.kind === "praise") continue;
      const key = i.route ?? "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [open]);

  if (loading) return <p className="text-xs text-white/40">Loading…</p>;
  if (error) return <p className="text-xs text-red-300">{error}</p>;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Open", open.length],
          ["Broke", open.filter((i) => i.kind === "bug").length],
          ["Stuck", open.filter((i) => i.kind === "confusing").length],
          ["Total", items.length],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] uppercase tracking-wider text-white/40">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {byRoute.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-sm font-semibold">Where people are getting stuck</h2>
          <p className="mt-1 text-xs text-white/50">
            Open reports by screen, praise excluded. The top row is the next thing to fix.
          </p>
          <ul className="mt-3 space-y-1.5">
            {byRoute.map(([route, count]) => (
              <li key={route} className="flex items-center gap-3 text-sm">
                <span className="w-8 shrink-0 text-right font-semibold text-amber-300">{count}</span>
                <span className="truncate font-mono text-xs text-white/70">{route}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            {showResolved ? "Everything" : "Open"}
            <span className="text-white/40"> · {visible.length}</span>
          </h2>
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs text-amber-300/90 hover:text-amber-200"
          >
            {showResolved ? "Show open only" : "Show resolved too"}
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="mt-4 text-xs text-white/40">
            Nothing here. During a test phase that means either everything works or nobody has
            pressed the button — worth knowing which.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {visible.map((i) => (
              <li
                key={i.id}
                className={`rounded-xl border p-4 ${
                  i.resolved_at ? "border-white/5 bg-white/[0.01] opacity-60" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wider ${KIND_STYLE[i.kind] ?? "bg-white/10 text-white/70"}`}>
                    {KIND_LABEL[i.kind] ?? i.kind}
                  </span>
                  {i.route && <code className="rounded bg-black/40 px-1.5 py-0.5 text-white/70">{i.route}</code>}
                  {i.store_name && <span className="text-white/50">{i.store_name}</span>}
                  {i.plan && <span className="text-white/40">{i.plan}</span>}
                  <span className="text-white/30">·</span>
                  <span className="text-white/40">{ago(i.created_at)}</span>
                  <button
                    type="button"
                    onClick={() => toggle(i.id)}
                    className="ml-auto text-xs text-white/50 transition-colors hover:text-white"
                  >
                    {i.resolved_at ? "Reopen" : "Mark handled"}
                  </button>
                </div>

                <p className="mt-2.5 whitespace-pre-wrap text-sm text-white/90">{i.message}</p>

                <p className="mt-2 text-[11px] text-white/35">
                  {i.email}
                  {typeof i.context?.viewport === "string" && <> · {i.context.viewport}</>}
                  {typeof i.context?.userAgent === "string" && (
                    <> · {String(i.context.userAgent).slice(0, 60)}…</>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
