"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AskUrivo } from "./ask-urivo";
import { IconSpark, IconClose } from "./icons";
import type { RailStore } from "./app-rail";

/*
 * Mobile companion — brings Ask Urivo (and the store's context) to phones, where
 * the desktop right rail is hidden. A floating action button opens a bottom
 * sheet holding the live-store header and the full Ask Urivo conversation, so
 * the agent is one tap away on every screen. Desktop keeps the fixed rail.
 */
export function MobileRail({
  store,
  canAsk = true,
  outOfCredits = false,
  plan,
}: {
  store: RailStore | null;
  canAsk?: boolean;
  outOfCredits?: boolean;
  plan?: string | null;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="lg:hidden">
      {/* Floating trigger */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Ask Urivo"
          className="u-gold u-lift fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-[0_16px_40px_-16px_rgba(236,206,126,0.6)] active:scale-[0.97]"
        >
          <IconSpark width={16} height={16} />
          Ask Urivo
        </button>
      )}

      {/* Scrim */}
      <div
        aria-hidden={!open}
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-40 bg-night/70 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ask Urivo"
        className={`u-glass fixed inset-x-0 bottom-0 z-50 flex h-[86vh] flex-col rounded-t-3xl border-t border-hair transition-transform duration-[400ms] ease-(--ease-urivo) ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* grab handle + header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-3">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/15" />
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">Ask Urivo</span>
            {store?.isLive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-live/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-live">
                <span className="h-1.5 w-1.5 rounded-full bg-live" /> Live
              </span>
            )}
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="mt-2 text-mist transition-colors hover:text-ivory">
            <IconClose width={18} height={18} />
          </button>
        </div>

        {/* store context row */}
        {store && (
          <div className="mx-5 mb-2 flex items-center justify-between rounded-xl border border-hair bg-panel/60 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ivory">{store.name}</p>
              <p className="truncate font-mono text-[10px] text-mist-dim">{store.subdomain}.urivo.ai</p>
            </div>
            <Link
              href={`/dashboard/stores/${store.id}`}
              onClick={() => setOpen(false)}
              className="u-lift shrink-0 rounded-lg border border-hair bg-panel px-3 py-1.5 text-xs font-semibold text-ivory transition-colors hover:border-hair-strong"
            >
              Manage
            </Link>
          </div>
        )}

        {/* Ask Urivo fills the rest */}
        {open && <AskUrivo hasStore={!!store} storeId={store?.id ?? null} canAsk={canAsk} outOfCredits={outOfCredits} plan={plan} />}
      </div>
    </div>
  );
}
