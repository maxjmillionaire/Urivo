"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { planName } from "@/lib/plans";
import { IconSettings, IconCard } from "./icons";

/*
 * Account menu — the profile control at the foot of the sidebar. Shows the
 * signed-in person by their real name and plan, and opens a calm popover with
 * the account destinations (Settings, Billing) and a real Sign out.
 */

export type Account = {
  name: string | null;
  email: string | null;
  plan: string | null;
  avatarUrl: string | null;
};

function IconLogout({ className }: { className?: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

export function AccountMenu({ account }: { account: Account }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const name = account.name?.trim() || null;
  const display = name || account.email || "Your account";
  const initial = (name || account.email || "U").slice(0, 1).toUpperCase();
  const planLabel = planName(account.plan);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const avatar = account.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={account.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
  ) : (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navymark text-xs font-semibold text-gold-soft">
      {initial}
    </span>
  );

  return (
    <div ref={ref} className="relative border-t border-hair px-3 py-3">
      {open && (
        <div
          role="menu"
          className="u-glass u-float absolute bottom-[calc(100%-0.25rem)] left-3 right-3 z-50 overflow-hidden rounded-xl border border-hair-strong"
        >
          <div className="flex items-center gap-3 border-b border-hair px-4 py-3.5">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium text-ivory">{display}</p>
              {name && account.email && (
                <p className="truncate text-[11px] text-mist-dim">{account.email}</p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-mist">Plan</span>
            <span className="rounded-full border border-gold/25 bg-gold/[0.06] px-2.5 py-0.5 text-[11px] font-semibold text-gold-soft">
              {planLabel}
            </span>
          </div>

          <div className="border-t border-hair p-1.5">
            <Link
              href="/dashboard/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-mist transition-colors hover:bg-white/[0.04] hover:text-ivory"
            >
              <IconSettings className="text-mist" /> Settings
            </Link>
            <Link
              href="/dashboard/billing"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-mist transition-colors hover:bg-white/[0.04] hover:text-ivory"
            >
              <IconCard className="text-mist" /> Plan &amp; billing
            </Link>
          </div>

          <div className="border-t border-hair p-1.5">
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-mist transition-colors hover:bg-alert/[0.08] hover:text-alert"
              >
                <IconLogout className="text-mist" /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
          open ? "bg-white/[0.05]" : "hover:bg-white/[0.035]"
        }`}
      >
        {avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-ivory">{display}</span>
          <span className="block truncate text-[11px] text-mist-dim">{planLabel} plan</span>
        </span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-mist" aria-hidden>
          <path d="M8 9l4-4 4 4" />
          <path d="M16 15l-4 4-4-4" />
        </svg>
      </button>
    </div>
  );
}
