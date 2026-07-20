"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconSpark, IconArrow } from "./icons";

/*
 * Interactive "Ask Urivo" — the conversational half of the companion rail.
 *
 * With a live store it becomes an editor: the founder describes a change, Urivo
 * proposes it, and one tap applies it to the real store (copy, palette, fonts,
 * layout, products) — the storefront preview updates in place. Without a store
 * it streams grounded advice to help shape the first one.
 */

interface ProposedEdit {
  summary: string;
  design?: Record<string, unknown>;
  products?: unknown[];
  setLive?: boolean;
}

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  edit?: ProposedEdit | null;
  applied?: boolean;
}

const SUGGESTIONS_STORE = ["Rewrite my hero headline", "Add one more product", "Make it feel more minimal", "Warm up the palette"];
const SUGGESTIONS_EMPTY = ["Help me name my brand", "What should I sell first?", "Shape my store idea"];

let idSeq = 0;
const nextId = () => `m${++idSeq}-${Date.now()}`;

export function AskUrivo({
  hasStore,
  storeId,
  canAsk = true,
}: {
  hasStore: boolean;
  storeId: string | null;
  canAsk?: boolean;
}) {
  const router = useRouter();
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

  const streamChat = useCallback(async (history: Msg[], assistantId: string, signal: AbortSignal) => {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
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
      throw new Error(message);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)));
    }
    if (!acc.trim()) {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: "I didn't catch that — try again?" } : m)));
    }
  }, []);

  const editPropose = useCallback(
    async (history: Msg[], assistantId: string, signal: AbortSignal) => {
      const res = await fetch(`/api/stores/${storeId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, content: m.content })) }),
        signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Ask Urivo is unavailable right now. Please try again.");
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: data.reply || "Done.", edit: data.edit ?? null } : m)),
      );
    },
    [storeId],
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;
      setError(null);
      const userMsg: Msg = { id: nextId(), role: "user", content };
      const assistantMsg: Msg = { id: nextId(), role: "assistant", content: "" };
      const history = [...messages, userMsg];
      setMessages([...history, assistantMsg]);
      setDraft("");
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        if (storeId) await editPropose(history, assistantMsg.id, controller.signal);
        else await streamChat(history, assistantMsg.id, controller.signal);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Something went wrong.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      } finally {
        setBusy(false);
        abortRef.current = null;
        taRef.current?.focus();
      }
    },
    [messages, busy, storeId, editPropose, streamChat],
  );

  const applyEdit = useCallback(
    async (msg: Msg) => {
      if (!storeId || !msg.edit || applyingId) return;
      setError(null);
      setApplyingId(msg.id);
      try {
        const res = await fetch(`/api/stores/${storeId}/edit/apply`, {
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

  if (!canAsk) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1.5 px-5 pb-2 pt-4">
          <IconSpark className="text-gold" width={13} height={13} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">Ask Urivo</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col justify-center px-5 pb-5">
          <div className="u-float rounded-2xl border border-gold/20 bg-panel/60 p-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-soft">Founder &amp; Elite</p>
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
                <MessageBubble msg={m} busy={busy} />
                {m.role === "assistant" && m.edit && (
                  <EditCard
                    edit={m.edit}
                    applied={!!m.applied}
                    applying={applyingId === m.id}
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
            <span className="pl-1 text-[10px] text-mist-dim">{busy ? "Urivo is thinking…" : "Enter to send"}</span>
            <button
              onClick={() => void send(draft)}
              disabled={busy || !draft.trim()}
              className="u-gold flex h-7 w-7 items-center justify-center rounded-lg transition-transform active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Send"
            >
              <IconArrow width={15} height={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditCard({
  edit,
  applied,
  applying,
  onApply,
}: {
  edit: ProposedEdit;
  applied: boolean;
  applying: boolean;
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
      ) : (
        <button
          onClick={onApply}
          disabled={applying}
          className="u-gold u-lift mt-2.5 w-full rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-60"
        >
          {applying ? "Applying…" : "Apply to my store"}
        </button>
      )}
    </div>
  );
}

function MessageBubble({ msg, busy }: { msg: Msg; busy: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-sm border border-gold/25 bg-gold/[0.08] px-3 py-2 text-[13px] leading-relaxed text-ivory">
          {msg.content}
        </div>
      </div>
    );
  }
  const isThinking = busy && msg.content.length === 0;
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-hair bg-panel/70 px-3 py-2 text-[13px] leading-relaxed text-cloud">
        {isThinking ? <ThinkingDots /> : <span className="whitespace-pre-wrap">{msg.content}</span>}
      </div>
    </div>
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
