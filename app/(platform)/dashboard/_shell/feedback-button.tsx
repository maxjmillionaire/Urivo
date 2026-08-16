"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/*
 * Feedback, captured where it happens.
 *
 * The point of this control is not the textarea — it is everything the person
 * does not have to type. The route, the store they are looking at, their plan,
 * their viewport and their browser are all known at the moment they press the
 * button, and every one of them is a question they would otherwise be asked a
 * day later, when they no longer remember.
 *
 * Placed bottom-LEFT deliberately: the assistant already owns bottom-right on
 * mobile, and a report button that covers the product's main action is a
 * report button that generates its own bug reports.
 */

const KINDS = [
  { key: "bug", label: "Something broke", hint: "It failed, hung, or did the wrong thing." },
  { key: "confusing", label: "I got stuck", hint: "It worked, but I could not tell how." },
  { key: "idea", label: "Idea", hint: "Something you wish it did." },
  { key: "praise", label: "This is good", hint: "Worth knowing what to protect." },
] as const;

type Kind = (typeof KINDS)[number]["key"];
type State = "idle" | "sending" | "sent" | "error";

export function FeedbackButton({ storeId }: { storeId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send() {
    if (message.trim().length < 3 || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          kind,
          route: pathname,
          storeId: storeId ?? undefined,
          context: {
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            screen: `${window.screen.width}x${window.screen.height}`,
            userAgent: navigator.userAgent.slice(0, 300),
            language: navigator.language,
          },
        }),
      });
      if (!res.ok) {
        /*
         * Never claim it was sent when it was not. A tester who believes they
         * have reported something does not report it again, and the thing they
         * found is lost — which is worse than having no button at all.
         */
        setState("error");
        setError(
          res.status === 429
            ? "That is a lot of reports in one hour. Try again shortly."
            : "It did not send. Nothing was saved — please try again.",
        );
        return;
      }
      setState("sent");
      setMessage("");
      setTimeout(() => {
        setOpen(false);
        setState("idle");
      }, 1600);
    } catch {
      setState("error");
      setError("It did not send — you may be offline. Nothing was saved.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="u-glass u-lift fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full border border-hair px-3.5 py-2.5 text-xs font-medium text-ivory/80 transition-colors hover:text-ivory active:scale-[0.97] lg:left-[256px]"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 text-gold" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h12v9H8l-4 3.5V4Z" />
        </svg>
        Feedback
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Send feedback"
          /*
           * Nearly opaque, not glass. The shell's translucent panels sit over
           * empty space; this one sits over dense metric tiles, and at the
           * shell's 0.55 alpha the numbers behind it read straight through the
           * sentence someone is trying to write.
           */
          className="fixed bottom-20 left-5 z-50 w-[min(23rem,calc(100vw-2.5rem))] rounded-2xl border border-hair bg-[rgb(14,22,40)]/98 p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)] backdrop-blur-xl lg:left-[256px]"
        >
          {state === "sent" ? (
            <p className="py-6 text-center text-sm text-ivory">
              Sent — with the page and store attached. Thank you.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    onClick={() => setKind(k.key)}
                    title={k.hint}
                    className={`rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium transition-colors ${
                      kind === k.key
                        ? "border-gold/50 bg-gold/10 text-ivory"
                        : "border-hair text-ivory/60 hover:text-ivory/90"
                    }`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>

              <textarea
                ref={textareaRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={4000}
                rows={4}
                placeholder="What happened? What did you expect instead?"
                className="mt-3 w-full resize-none rounded-lg border border-hair bg-night/60 px-3 py-2.5 text-sm text-ivory placeholder:text-ivory/35 focus:border-gold/50 focus:outline-none"
              />

              {error && <p className="mt-2 text-xs text-red-300">{error}</p>}

              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-[11px] leading-tight text-ivory/40">
                  The page you are on is included automatically.
                </p>
                <button
                  type="button"
                  onClick={send}
                  disabled={message.trim().length < 3 || state === "sending"}
                  className="u-gold shrink-0 rounded-full px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-40"
                >
                  {state === "sending" ? "Sending…" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
