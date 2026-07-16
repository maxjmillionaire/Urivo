"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getConsent, setConsent } from "@/lib/analytics";

/*
 * Cookie / analytics consent banner (DSGVO). Necessary cookies (auth) are
 * always allowed; analytics is enabled only on explicit "Accept". No dark
 * patterns — declining is one click and equally prominent.
 */
export function ConsentBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (getConsent() === null) setShow(true);
  }, []);

  if (!show) return null;

  function choose(value: "granted" | "denied") {
    setConsent(value);
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-ivory-100/10 bg-forest-950/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-light leading-relaxed text-ivory-100/70">
          We use necessary cookies to keep you signed in. With your consent we
          also use analytics to improve Urivo.{" "}
          <Link href="/datenschutz" className="text-gold-300 underline-offset-4 hover:underline">
            Learn more
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="rounded-lg border border-ivory-100/15 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/70 transition-colors hover:border-ivory-100/30 hover:text-ivory-100"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="rounded-lg bg-gold-500 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest-900 transition-colors hover:bg-champagne"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
