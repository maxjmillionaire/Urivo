"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getConsent, setConsent } from "@/lib/analytics";

/*
 * Cookie / analytics consent banner (DSGVO). Necessary cookies (auth) are
 * always allowed; analytics is enabled only on explicit "Accept".
 *
 * Declining is ONE CLICK, in the same place, at the same size, with the same
 * label weight — there is no "manage preferences" maze and no pre-ticked box.
 * The two buttons are not identical in colour: Accept carries the brand's gold
 * fill and Necessary only is bordered.
 *
 * That difference is a deliberate, owner-level decision, recorded here so
 * nobody "fixes" it by accident and so the trade-off stays visible. The EDPB's
 * guidance on deceptive design treats visual weight as capable of nudging
 * consent, and the safest reading is that both options should carry identical
 * emphasis. Urivo accepts that risk knowingly rather than unknowingly: the
 * mitigations are that refusal costs exactly one click, is never hidden behind
 * a second screen, and sets a real "denied" value that the analytics layer
 * honours — the substance of free choice, if not equal pixels.
 *
 * If this is ever revisited, the change is one className on the Accept button.
 *
 * This banner is mounted ONLY by the (platform) root layout — Urivo's own
 * surfaces. Generated storefronts live under the separate (store) root layout
 * and structurally cannot mount it, so Urivo's consent UI can never appear on a
 * merchant's store regardless of how the store is routed (subdomain rewrite,
 * custom domain, path).
 */
export function ConsentBanner() {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (getConsent() === null) setShow(true);
  }, []);

  // Reserve space so the fixed banner never covers page content (e.g. the login
  // footer links on short mobile screens). Cleared on dismiss.
  useEffect(() => {
    if (!show) return;
    const apply = () => {
      const h = ref.current?.offsetHeight ?? 0;
      document.body.style.paddingBottom = `${h}px`;
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.body.style.paddingBottom = "";
    };
  }, [show]);

  if (!show) return null;

  function choose(value: "granted" | "denied") {
    setConsent(value);
    setShow(false);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Cookie consent"
      className="u-glass fixed inset-x-0 bottom-0 z-50 border-t border-hair"
    >
      <div className="mx-auto flex max-w-4xl flex-col items-start gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm leading-relaxed text-mist">
          We use necessary cookies to keep you signed in. With your consent we
          also use analytics to improve Urivo.{" "}
          <Link
            href="/datenschutz"
            className="-my-2 inline-block py-2 font-medium text-gold-soft underline-offset-4 hover:underline"
          >
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
