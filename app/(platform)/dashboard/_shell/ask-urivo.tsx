"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { nextPlan } from "@/lib/plans";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { IconSpark, IconArrow } from "./icons";
import { Markdown } from "./markdown";

const MESSAGE_COST = CREDIT_COSTS.askMessage;

/*
 * Interactive "Ask Urivo" — the conversational half of the companion rail.
 *
 * ONE assistant, one streaming path. It used to fork on whether a store
 * existed: storeless founders got a streaming chat, and everyone else got a
 * blocking edit-proposer, so the rail sat on three bouncing dots for the whole
 * call and then dropped a wall of text. Now every turn streams, and a proposed
 * change arrives as a card mid-conversation — so one answer can diagnose a
 * problem AND offer the fix, which is the point of an assistant that can see
 * your business.
 */

interface ProposedEdit {
  summary: string;
  design?: Record<string, unknown>;
  products?: unknown[];
  setLive?: boolean;
}

type Phase = "thinking" | "writing";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  edit?: ProposedEdit | null;
  /** The store the proposal was reasoned about — authoritative over the prop. */
  editStoreId?: string | null;
  applied?: boolean;
  /** Set when the turn failed; the bubble stays put and offers a retry. */
  error?: string | null;
  phase?: Phase | null;
}

const SUGGESTIONS_STORE = [
  "Why is nobody buying?",
  "What should I fix first?",
  "Rewrite my hero headline",
  "Give me a 30-day launch plan",
];
const SUGGESTIONS_EMPTY = ["Help me name my brand", "What should I sell first?", "Shape my store idea"];

const TRANSCRIPT_KEY = "urivo_ask_transcript";
const MAX_PERSISTED = 24;

let idSeq = 0;
const nextId = () => `m${++idSeq}-${Date.now()}`;

export function AskUrivo({
  hasStore,
  storeId,
  canAsk = true,
  credits = 0,
  plan,
}: {
  hasStore: boolean;
  storeId: string | null;
  canAsk?: boolean;
  credits?: number;
  plan?: string | null;
}) {
  const router = useRouter();
  const [creditNudge, setCreditNudge] = useState(true);
  const [creditsLeft, setCreditsLeft] = useState(credits);

  // Keep the local balance in sync when the server value changes (navigation).
  useEffect(() => setCreditsLeft(credits), [credits]);

  const outOfCredits = creditsLeft < MESSAGE_COST;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /*
   * The transcript survives navigation and reload. Losing a long, carefully
   * built conversation to a stray refresh is the fastest way to make an
   * assistant feel disposable. Session-scoped: it belongs to this tab and this
   * sitting, and it never touches disk.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(TRANSCRIPT_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!Array.isArray(saved)) return;
      const clean = saved.filter(
        (m): m is Msg =>
          !!m && typeof m === "object" &&
          (m as Msg).role !== undefined && typeof (m as Msg).content === "string",
      );
      // Never restore a turn mid-flight: a stream cannot resume after a reload.
      if (clean.length) setMessages(clean.map((m) => ({ ...m, phase: null })));
    } catch {
      /* a corrupt transcript is simply not restored */
    }
  }, []);

  useEffect(() => {
    if (!restored.current) return;
    try {
      if (messages.length === 0) sessionStorage.removeItem(TRANSCRIPT_KEY);
      else sessionStorage.setItem(TRANSCRIPT_KEY, JSON.stringify(messages.slice(-MAX_PERSISTED)));
    } catch {
      /* storage full or blocked — the conversation still works in memory */
    }
  }, [messages]);

  /*
   * Consume the NDJSON event stream. Text is appended as it arrives, the
   * reasoning phase is surfaced honestly, and a proposed change becomes a card.
   * Partial lines are buffered — a chunk boundary can land mid-JSON.
   */
  const runTurn = useCallback(
    async (history: Msg[], assistantId: string, signal: AbortSignal) => {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history
            .filter((m) => m.content.trim() && !m.error)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
        signal,
      });

      if (!res.ok || !res.body) {
        let message = "Ask Urivo is unavailable right now. Please try again.";
        try {
          const data = await res.json();
          if (data?.message) message = data.message;
        } catch {
          /* non-JSON */
        }
        const err = new Error(message);
        if (res.status === 402) (err as Error & { code?: string }).code = "INSUFFICIENT_CREDITS";
        throw err;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const patch = (fn: (m: Msg) => Msg) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      let buffer = "";
      let acc = "";
      let charged = true;

      const handle = (line: string) => {
        let event: {
          type?: string; text?: string; phase?: Phase;
          edit?: ProposedEdit; storeId?: string | null; message?: string;
        };
        try {
          event = JSON.parse(line);
        } catch {
          return; // a malformed frame is skipped, never rendered
        }
        if (event.type === "text" && typeof event.text === "string") {
          acc += event.text;
          patch((m) => ({ ...m, content: acc, phase: "writing" }));
        } else if (event.type === "phase" && event.phase) {
          patch((m) => ({ ...m, phase: event.phase as Phase }));
        } else if (event.type === "edit" && event.edit) {
          patch((m) => ({ ...m, edit: event.edit as ProposedEdit, editStoreId: event.storeId ?? null }));
        } else if (event.type === "error") {
          charged = false;
          patch((m) => ({ ...m, error: event.message ?? "Something interrupted that response." }));
        }
      };

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) handle(line);
      }
      if (buffer.trim()) handle(buffer);

      patch((m) => ({ ...m, phase: null }));
      return { produced: acc.trim().length > 0, charged };
    },
    [],
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      // Every message costs credits — block and nudge when the balance is empty.
      if (creditsLeft < MESSAGE_COST) {
        setCreditNudge(true);
        return;
      }
      setError(null);
      const userMsg: Msg = { id: nextId(), role: "user", content };
      const assistantMsg: Msg = { id: nextId(), role: "assistant", content: "", phase: "thinking" };
      const history = [...messages, userMsg];
      setMessages([...history, assistantMsg]);
      setDraft("");
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const { produced, charged } = await runTurn(history, assistantMsg.id, controller.signal);
        // Only a turn that actually produced an answer is charged server-side,
        // so the visible balance must follow the same rule.
        if (produced && charged) setCreditsLeft((c) => Math.max(0, c - MESSAGE_COST));
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          // Keep whatever streamed before the stop — it is still an answer.
          setMessages((prev) =>
            prev
              .map((m) => (m.id === assistantMsg.id ? { ...m, phase: null } : m))
              .filter((m) => m.id !== assistantMsg.id || m.content.trim().length > 0),
          );
          return;
        }
        const message = err instanceof Error ? err.message : "Something went wrong.";
        if ((err as Error & { code?: string }).code === "INSUFFICIENT_CREDITS") {
          setCreditsLeft(0);
          setCreditNudge(true);
        }
        // The turn stays in place carrying its error, so the founder can retry
        // it rather than losing the exchange and retyping the question.
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, phase: null, error: message } : m)),
        );
      } finally {
        setBusy(false);
        abortRef.current = null;
        taRef.current?.focus();
      }
    },
    [messages, busy, runTurn, creditsLeft],
  );

  /** Re-ask the question that produced a failed turn, in place. */
  const retry = useCallback(
    (assistantId: string) => {
      if (busy) return;
      const at = messages.findIndex((m) => m.id === assistantId);
      if (at < 1) return;
      const question = messages[at - 1];
      if (question.role !== "user") return;
      setMessages(messages.slice(0, at - 1));
      void send(question.content);
    },
    [messages, busy, send],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  // The Home "Ask Urivo" command bar dispatches prompts here (via a window
  // event) so the signature input and the companion rail are one assistant, not
  // two. A ref keeps the listener bound to the latest `send` without rebinding.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (typeof text === "string" && text.trim()) void sendRef.current(text);
    };
    window.addEventListener("urivo:ask", onAsk as EventListener);
    return () => window.removeEventListener("urivo:ask", onAsk as EventListener);
  }, []);

  const applyEdit = useCallback(
    async (msg: Msg) => {
      // Apply to the store Urivo actually reasoned about, not whichever one
      // the rail happens to be showing.
      const target = msg.editStoreId ?? storeId;
      if (!target || !msg.edit || applyingId) return;
      setError(null);
      setApplyingId(msg.id);
      try {
        const res = await fetch(`/api/stores/${target}/edit/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: msg.edit }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Could not apply the change.");
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, applied: true } : m)));
        router.refresh(); // live preview + store pages reflect the change
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not apply the change.");
      } finally {
        setApplyingId(null);
      }
    },
    [storeId, applyingId, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setBusy(false);
    taRef.current?.focus();
  };

  const suggestions = hasStore ? SUGGESTIONS_STORE : SUGGESTIONS_EMPTY;
  const hasTranscript = messages.length > 0;
  const livePhase = messages[messages.length - 1]?.phase ?? null;

  if (!canAsk) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-5 pb-2 pt-4">
          <IconSpark className="text-gold" width={13} height={13} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">Ask Urivo</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-center px-5 pb-5">
          <div className="u-float rounded-2xl border border-gold/20 bg-panel/60 p-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Founder &amp; Pro</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ivory">
              The AI Store Assistant describes a change and applies it to your live store — copy,
              palette, layout, products.
            </p>
            <Link
              href="/dashboard/billing"
              className="u-gold u-lift mt-4 inline-flex rounded-xl px-5 py-2.5 text-xs font-semibold"
            >
              Unlock Ask Urivo
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const nudgePlan = nextPlan(plan);
  const showCreditNudge = canAsk && outOfCredits && creditNudge;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* Out-of-credits nudge — Lovable-style: upgrade, or top up, in one tap */}
      {showCreditNudge && (
        <div className="absolute inset-x-3 top-11 z-30 u-float rounded-xl border border-gold/25 bg-[#0f1a2e] p-4 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]">
          <button
            type="button"
            onClick={() => setCreditNudge(false)}
            aria-label="Dismiss"
            className="absolute right-2.5 top-2.5 text-mist-dim transition-colors hover:text-ivory"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Out of credits</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ivory">
            You&apos;re out of credits. Keep building — pick one:
          </p>
          <div className="mt-3 space-y-2">
            {nudgePlan && (
              <Link
                href="/dashboard/billing"
                className="u-gold u-lift block rounded-lg px-3 py-2 text-center text-xs font-semibold"
              >
                Upgrade to {nudgePlan.name}
              </Link>
            )}
            <Link
              href="/dashboard/billing"
              className="u-lift block rounded-lg border border-hair bg-panel px-3 py-2 text-center text-xs font-semibold text-ivory hover:border-hair-strong hover:bg-panel-2"
            >
              Buy more credits
            </Link>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-center gap-1.5">
          <IconSpark className="text-gold" width={13} height={13} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">Ask Urivo</span>
        </div>
        {hasTranscript && (
          <button onClick={reset} className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-mist-dim transition-colors hover:text-mist active:scale-[0.96]">
            New chat
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        {hasTranscript ? (
          <div className="space-y-3 pb-2">
            {messages.map((m) => (
              <div key={m.id} className="u-msg-in">
                <MessageBubble msg={m} onRetry={() => retry(m.id)} canRetry={!busy} />
                {m.role === "assistant" && m.edit && (
                  <EditCard
                    edit={m.edit}
                    applied={!!m.applied}
                    applying={applyingId === m.id}
                    canApply={!!(m.editStoreId ?? storeId)}
                    onApply={() => applyEdit(m)}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="pb-2">
            <p className="text-xs leading-relaxed text-mist">
              {hasStore
                ? "Ask for a change and I'll propose it — copy, palette, fonts, layout, products. You approve before it goes live."
                : "Tell me your idea and I'll help you shape a brand worth launching."}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="u-lift rounded-full border border-hair bg-panel/60 px-2.5 py-1 text-[11px] text-cloud transition-colors hover:border-gold/40 hover:text-ivory active:scale-[0.97]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-hair p-4">
        {error && (
          <p className="mb-2 px-1 text-[11px] text-alert" role="alert">
            {error}
          </p>
        )}
        <div className="rounded-xl border border-hair bg-night transition-colors focus-within:border-gold/50">
          <textarea
            ref={taRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder={hasStore ? "Rewrite my hero, add a product, change the palette…" : "Describe the store you want to build…"}
            className="w-full resize-none bg-transparent px-3.5 pt-3 text-sm text-ivory placeholder:text-mist-dim focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <span className="pl-1 text-[10px] text-mist-dim">
              {busy
                ? livePhase === "writing"
                  ? "Urivo is writing…"
                  : "Urivo is working it out…"
                : outOfCredits
                  ? "Out of credits"
                  : `${MESSAGE_COST} credit · ${creditsLeft} left`}
            </span>
            {busy ? (
              /* A long answer is a feature, but never a trap — stop keeps what
                 has streamed so far. */
              <button
                onClick={stop}
                className="flex h-7 items-center gap-1.5 rounded-lg border border-hair bg-panel px-2.5 text-[11px] font-semibold text-cloud transition-colors hover:border-hair-strong hover:text-ivory active:scale-[0.96]"
                aria-label="Stop generating"
              >
                <span aria-hidden className="h-2 w-2 rounded-[2px] bg-cloud" />
                Stop
              </button>
            ) : (
              <button
                onClick={() => void send(draft)}
                disabled={!draft.trim() || outOfCredits}
                className="u-gold flex h-7 w-7 items-center justify-center rounded-lg transition-transform active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send"
              >
                <IconArrow width={15} height={15} />
              </button>
            )}
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] leading-tight text-mist-dim">
          Urivo is an AI and can make mistakes. Check important information.
        </p>
      </div>
    </div>
  );
}

function EditCard({
  edit,
  applied,
  applying,
  canApply,
  onApply,
}: {
  edit: ProposedEdit;
  applied: boolean;
  applying: boolean;
  canApply: boolean;
  onApply: () => void;
}) {
  return (
    <div className="u-msg-in mt-2 rounded-xl border border-gold/25 bg-gold/[0.05] p-3">
      <div className="flex items-center gap-1.5">
        <IconSpark className="text-gold" width={12} height={12} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Proposed change</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ivory">{edit.summary}</p>
      {applied ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-[12px] font-semibold text-live">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6 9 17l-5-5" />
          </svg>
          Applied to your store
        </p>
      ) : canApply ? (
        <button
          onClick={onApply}
          disabled={applying}
          className="u-gold u-lift mt-2.5 w-full rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
        >
          {applying ? "Applying…" : "Apply to my store"}
        </button>
      ) : (
        /* Proposed before a store exists — honest about why there is no button. */
        <p className="mt-2 text-[11px] leading-relaxed text-mist">
          Generate a store first and this becomes one tap.
        </p>
      )}
    </div>
  );
}

function MessageBubble({
  msg,
  onRetry,
  canRetry,
}: {
  msg: Msg;
  onRetry: () => void;
  canRetry: boolean;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-sm border border-gold/25 bg-gold/[0.08] px-3 py-2 text-[13px] leading-relaxed text-ivory">
          {msg.content}
        </div>
      </div>
    );
  }

  const empty = msg.content.trim().length === 0;
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-hair bg-panel/70 px-3 py-2 text-[13px] leading-relaxed text-cloud">
        {empty && msg.phase ? (
          <Reasoning phase={msg.phase} />
        ) : (
          <>
            {/* Markdown, so a structured answer reads as one — the reply used
                to render its own asterisks and hyphens as literal characters. */}
            <Markdown source={msg.content} />
            {msg.phase === "writing" && <Caret />}
          </>
        )}
        {msg.error && (
          <div className={empty ? "" : "mt-2 border-t border-hair pt-2"}>
            <p className="text-[12px] leading-relaxed text-alert" role="alert">
              {msg.error}
            </p>
            {canRetry && (
              <button
                onClick={onRetry}
                className="mt-1.5 rounded-md text-[11px] font-semibold text-gold-soft underline decoration-gold/40 underline-offset-2 transition-colors hover:text-gold active:scale-[0.97]"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/*
 * The reasoning phase, shown honestly. Urivo genuinely spends longer on a hard
 * question than an easy one, and saying so is better than an undifferentiated
 * spinner that makes every wait feel like a stall.
 */
function Reasoning({ phase }: { phase: Phase }) {
  return (
    <span className="inline-flex items-center gap-2 py-0.5">
      <ThinkingDots />
      <span className="text-[11px] text-mist">
        {phase === "thinking" ? "Working it out" : "Writing"}
      </span>
    </span>
  );
}

/** A blinking caret while text streams, so the reply reads as being written. */
function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[0.95em] w-[2px] translate-y-[0.15em] bg-gold/80"
      style={{ animation: "urivo-thinking 1s infinite ease-in-out" }}
    />
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-0.5" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-mist" style={{ animation: `urivo-thinking 1.1s ${i * 0.16}s infinite ease-in-out` }} />
      ))}
    </span>
  );
}
