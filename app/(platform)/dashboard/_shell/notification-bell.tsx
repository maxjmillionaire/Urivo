"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/*
 * The merchant's notification center — the bell. Shows an unread count, opens a
 * feed of recent events (a sale, a milestone, a low balance), and marks
 * everything read on open. Server-rendered on each navigation; the email channel
 * carries the same events for immediacy. (Real-time polling can layer on later.)
 */

export interface BellItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  severity: "info" | "success" | "warning" | "critical";
  read: boolean;
  createdAt: string;
}

const DOT: Record<BellItem["severity"], string> = {
  info: "bg-mist",
  success: "bg-live",
  warning: "bg-gold",
  critical: "bg-alert",
};

export function NotificationBell({ items, unread }: { items: BellItem[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(unread);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && count > 0) {
      setCount(0); // optimistic
      fetch("/api/notifications/read", { method: "POST" }).catch(() => {});
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
        className="u-press relative flex h-9 w-9 items-center justify-center rounded-full border border-hair bg-panel/80 text-mist backdrop-blur transition-colors hover:border-hair-strong hover:text-ivory"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[9px] font-bold text-night">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-11 z-40 w-80 overflow-hidden rounded-2xl border border-hair-strong bg-panel-2 shadow-2xl"
          style={{ animation: "urivo-fade-up 160ms var(--ease-urivo) both" }}
        >
          <div className="flex items-center justify-between border-b border-hair px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Notifications</p>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[12.5px] text-mist-dim">
              You&apos;re all caught up. Sales, milestones and alerts will appear here.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-hair overflow-y-auto">
              {items.map((n) => {
                const inner = (
                  <div className="flex gap-3 px-4 py-3">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[n.severity]}`} />
                    <div className="min-w-0 flex-1">
                      <p className={`text-[13px] leading-snug ${n.read ? "text-cloud" : "font-semibold text-ivory"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="mt-0.5 text-[11.5px] leading-snug text-mist">{n.body}</p>}
                      <p className="mt-1 text-[10px] uppercase tracking-wide text-mist-dim">{relTime(n.createdAt)}</p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id} className="transition-colors hover:bg-panel">
                    {n.href ? (
                      <Link href={n.href} onClick={() => setOpen(false)} className="block">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
