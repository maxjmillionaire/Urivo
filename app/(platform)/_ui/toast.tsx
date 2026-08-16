"use client";

import { useEffect, useState } from "react";

/*
 * Lightweight global toast. `toast()` dispatches a window event; the <Toaster/>
 * mounted once in the layout renders the stack. Event-based so any client
 * component can call toast() without threading context or providers.
 */

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

const EVENT = "urivo:toast";

export function toast(message: string, opts?: { type?: ToastKind }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, kind: opts?.type ?? "info" } }));
}

let seq = 0;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail as { message: string; kind: ToastKind };
      const id = ++seq;
      setItems((prev) => [...prev, { id, message: detail.message, kind: detail.kind }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 4000);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 px-4 pb-5 sm:items-end sm:pr-6"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className="u-msg-in pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border bg-panel/95 px-4 py-3 text-sm shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)] backdrop-blur"
          style={{
            borderColor:
              t.kind === "success" ? "rgba(52,199,142,0.4)" : t.kind === "error" ? "rgba(229,103,78,0.4)" : "var(--hair-strong, rgba(244,241,232,0.16))",
          }}
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: t.kind === "success" ? "#34c78e" : t.kind === "error" ? "#e5674e" : "#ECCE7E" }}
          />
          <span className="text-ivory">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
