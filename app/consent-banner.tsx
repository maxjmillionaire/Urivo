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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-muted">
          We use necessary cookies to keep you signed in. With your consent we
          also use analytics to improve Urivo.{" "}
          <Link href="/datenschutz" className="font-medium text-brand underline-offset-4 hover:underline">
            Learn more
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-surface-muted"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition-colors hover:bg-brand-hover"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
