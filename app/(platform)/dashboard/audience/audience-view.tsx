"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { CAMPAIGN_LIMITS } from "@/lib/marketing/limits";
import type { AudienceStats, Subscriber } from "@/lib/marketing/audience";
import { IconSpark, IconMail } from "../_shell/icons";

/*
 * The audience workspace: who subscribed, and a composer to reach them. Urivo
 * drafts from a one-line goal; the merchant edits and sends. Sending is a
 * deliberate two-step (a real message to real inboxes should never be one
 * stray click), and the send button names the exact number it will reach.
 */

interface Props {
  storeId: string;
  storeName: string;
  subdomain: string;
  isLive: boolean;
  stats: AudienceStats;
  subscribers: Subscriber[];
}

export function AudienceView({ storeId, storeName, subdomain, isLive, stats, subscribers }: Props) {
  const router = useRouter();
  const [goal, setGoal] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentNote, setSentNote] = useState<string | null>(null);

  const canDraft = goal.trim().length >= 4 && !drafting && !sending;
  const canSend =
    subject.trim().length >= CAMPAIGN_LIMITS.subjectMin &&
    body.trim().length >= CAMPAIGN_LIMITS.bodyMin &&
    stats.active > 0 &&
    !sending &&
    !drafting;

  async function draft() {
    if (!canDraft) return;
    setError(null);
    setSentNote(null);
    setDrafting(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/campaigns/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Couldn't draft that just now.");
      setSubject(data.subject ?? "");
      setBody(data.body ?? "");
      router.refresh(); // credits changed
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft that just now.");
    } finally {
      setDrafting(false);
    }
  }

  async function send() {
    if (!canSend) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setError(null);
    setSentNote(null);
    setSending(true);
    try {
      const res = await fetch(`/api/stores/${storeId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Couldn't send that campaign.");
      setSentNote(`Sent to ${data.sentCount} of ${data.audienceCount} subscriber${data.audienceCount === 1 ? "" : "s"}.`);
      setSubject("");
      setBody("");
      setGoal("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send that campaign.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Subscribers" value={stats.active} />
        <Stat label="New · 30 days" value={stats.last30d} />
        <Stat label="Unsubscribed" value={stats.unsubscribed} muted />
      </div>

      {/* Composer */}
      <section className="u-float rounded-2xl border border-hair bg-panel/70 p-5 sm:p-6">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-hair bg-panel/60 text-gold">
            <IconSpark width={14} height={14} />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-ivory">Write a campaign</p>
            <p className="text-[11px] text-mist-dim">
              Tell Urivo the goal — it drafts, you edit and send. {CREDIT_COSTS.campaignDraft} credits to draft.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            maxLength={300}
            placeholder="e.g. Announce we're live, or win back quiet subscribers"
            className="min-w-0 flex-1 rounded-xl border border-hair bg-night px-3.5 py-2.5 text-sm text-ivory placeholder:text-mist-dim focus:border-gold/50 focus:outline-none"
          />
          <button
            onClick={() => void draft()}
            disabled={!canDraft}
            className="u-lift shrink-0 rounded-xl border border-hair bg-panel px-4 py-2.5 text-xs font-semibold text-ivory transition-colors hover:border-gold/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {drafting ? "Drafting…" : "Draft with Urivo"}
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={CAMPAIGN_LIMITS.subjectMax}
            placeholder="Subject line"
            className="w-full rounded-xl border border-hair bg-night px-3.5 py-2.5 text-sm font-medium text-ivory placeholder:text-mist-dim focus:border-gold/50 focus:outline-none"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={7}
            maxLength={CAMPAIGN_LIMITS.bodyMax}
            placeholder="Your message. Urivo can write the first draft — you have the final word."
            className="w-full resize-none rounded-xl border border-hair bg-night px-3.5 py-3 text-sm leading-relaxed text-ivory placeholder:text-mist-dim focus:border-gold/50 focus:outline-none"
          />
        </div>

        {error && <p className="mt-3 text-[12px] text-alert" role="alert">{error}</p>}
        {sentNote && <p className="mt-3 text-[12px] text-live">{sentNote}</p>}

        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-mist-dim">
            {isLive ? (
              <>Sends from <span className="font-mono text-mist">{storeName} via Urivo</span></>
            ) : (
              <>This store is a draft — you can still email past subscribers.</>
            )}
          </p>
          <div className="flex items-center gap-2">
            {confirming && (
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg px-2.5 py-2 text-[11px] font-medium text-mist-dim transition-colors hover:text-mist"
              >
                Cancel
              </button>
            )}
            <button
              onClick={() => void send()}
              disabled={!canSend}
              className="u-gold u-lift shrink-0 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending
                ? "Sending…"
                : confirming
                  ? `Confirm — send to ${stats.active}`
                  : `Send to ${stats.active} subscriber${stats.active === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </section>

      {/* List */}
      <section className="u-float overflow-hidden rounded-2xl border border-hair bg-panel/70">
        <div className="flex items-center justify-between border-b border-hair px-5 py-3.5">
          <div className="flex items-center gap-2">
            <IconMail className="text-mist" width={15} height={15} />
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-mist">Subscribers</h2>
          </div>
          <a
            href={`/api/stores/${storeId}/subscribers/export`}
            className="u-lift rounded-lg border border-hair bg-panel px-3 py-1.5 text-[11px] font-semibold text-ivory transition-colors hover:border-hair-strong"
          >
            Export CSV
          </a>
        </div>

        {subscribers.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-ivory">No subscribers yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-mist">
              When shoppers subscribe on{" "}
              <span className="font-mono text-mist-dim">{subdomain}.urivo.ai</span>, they'll appear here.
            </p>
          </div>
        ) : (
          <ul className="max-h-[420px] divide-y divide-hair/60 overflow-y-auto">
            {subscribers.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="min-w-0 truncate text-[13px] text-cloud">{s.email}</span>
                <div className="flex shrink-0 items-center gap-3">
                  {s.subscribed ? (
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-live">
                      <span className="h-1.5 w-1.5 rounded-full bg-live" /> Active
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-mist-dim">Unsubscribed</span>
                  )}
                  <span className="w-20 text-right font-mono text-[10px] text-mist-dim">
                    {new Date(s.createdAt).toISOString().slice(0, 10)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="u-float rounded-2xl border border-hair bg-panel/70 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">{label}</p>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${muted ? "text-mist" : "text-ivory"}`}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
