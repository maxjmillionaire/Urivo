"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconSpark, IconArrow } from "./icons";

/*
 * Interactive "Ask Urivo" — the conversational half of the companion rail.
 *
 * A real transcript with token-by-token streaming from /api/ask, grounded in
 * the merchant's active store. This is the foundation the store editor will
 * hang applied edits off of; today it drafts, plans and advises.
 */

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS_STORE = [
  "Rewrite my hero headline",
  "Draft one more product",
  "Refine the palette",
];
const SUGGESTIONS_EMPTY = [
  "Help me name my brand",
  "What should I sell first?",
  "Shape my store idea",
];

let idSeq = 0;
const nextId = () => `m${++idSeq}-${Date.now()}`;

export function AskUrivo({ hasStore }: { hasStore: boolean }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToEnd();
  }, [messages, scrollToEnd]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      setError(null);
      const userMsg: Msg = { id: nextId(), role: "user", content };
      const assistantMsg: Msg = { id: nextId(), role: "assistant", content: "" };
      const history = [...messages, userMsg];
      setMessages([...history, assistantMsg]);
      setDraft("");
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let message = "Ask Urivo is unavailable right now. Please try again.";
          try {
            const data = await res.json();
            if (data?.message) message = data.message;
          } catch {
            /* non-JSON error body */
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
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc } : m)),
          );
        }
        if (!acc.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: "I didn't catch that — try again?" } : m,
            ),
          );
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setError(message);
        // Drop the empty assistant bubble on failure.
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
      } finally {
        setStreaming(false);
        abortRef.current = null;
        taRef.current?.focus();
      }
    },
    [messages, streaming],
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
    setStreaming(false);
    taRef.current?.focus();
  };

  const suggestions = hasStore ? SUGGESTIONS_STORE : SUGGESTIONS_EMPTY;
  const hasTranscript = messages.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Label / reset */}
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div className="flex items-center gap-1.5">
          <IconSpark className="text-gold" width={13} height={13} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">
            Ask Urivo
          </span>
        </div>
        {hasTranscript && (
          <button
            onClick={reset}
            className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-mist-dim transition-colors hover:text-mist active:scale-[0.96]"
          >
            New chat
          </button>
        )}
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5">
        {hasTranscript ? (
          <div className="space-y-3 pb-2">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} streaming={streaming} />
            ))}
          </div>
        ) : (
          <div className="pb-2">
            <p className="text-xs leading-relaxed text-mist">
              {hasStore
                ? "Ask for an edit and I'll draft it against your store — copy, products, palette."
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

      {/* Composer */}
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
            disabled={streaming}
            placeholder={hasStore ? "Rewrite my hero, add a product, change the palette…" : "Describe the store you want to build…"}
            className="w-full resize-none bg-transparent px-3.5 pt-3 text-sm text-ivory placeholder:text-mist-dim focus:outline-none disabled:opacity-60"
          />
          <div className="flex items-center justify-between px-2.5 pb-2.5">
            <span className="pl-1 text-[10px] text-mist-dim">
              {streaming ? "Urivo is thinking…" : "Enter to send"}
            </span>
            <button
              onClick={() => void send(draft)}
              disabled={streaming || !draft.trim()}
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

function MessageBubble({ msg, streaming }: { msg: Msg; streaming: boolean }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-sm border border-gold/25 bg-gold/[0.08] px-3 py-2 text-[13px] leading-relaxed text-ivory">
          {msg.content}
        </div>
      </div>
    );
  }
  const isThinking = streaming && msg.content.length === 0;
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
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-mist"
          style={{ animation: `urivo-thinking 1.1s ${i * 0.16}s infinite ease-in-out` }}
        />
      ))}
    </span>
  );
}
