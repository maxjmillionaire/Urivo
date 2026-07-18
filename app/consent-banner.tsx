"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { getConsent, setConsent } from "@/lib/analytics";

/*
 * Cookie / analytics consent banner (DSGVO). Necessary cookies (auth) are
 * always allowed; analytics is enabled only on explicit "Accept". No dark
 * patterns — declining is one click and equally prominent.
 *
 * This is Urivo's own platform banner and must never appear on a generated
 * merchant storefront — those are the merchant's brand, and Urivo stays behind
 * the scenes. Suppressed on /store/* accordingly.
 */
export function ConsentBanner() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);

  const onStorefront = pathname?.startsWith("/store/") ?? false;

  useEffect(() => {
    if (!onStorefront && getConsent() === null) setShow(true);
  }, [onStorefront]);

  if (onStorefront || !show) return null;

  function choose(value: "granted" | "denied") {
    setConsent(value);
    setShow(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="u-glass fixed inset-x-0 bottom-0 z-50 border-t border-hair"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-mist">
          We use necessary cookies to keep you signed in. With your consent we
          also use analytics to improve Urivo.{" "}
          <Link href="/datenschutz" className="font-medium text-gold-soft underline-offset-4 hover:underline">
            Learn more
          </Link>
        </p>
        <div className="flex shrink-0 gap-3">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="u-lift rounded-lg border border-hair bg-panel px-4 py-2.5 text-sm font-semibold text-ivory hover:border-hair-strong hover:bg-panel-2"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="u-gold u-lift rounded-lg px-4 py-2.5 text-sm font-semibold"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
