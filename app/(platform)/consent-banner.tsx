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

  /*
   * Shown after the visitor's first scroll rather than on first paint.
   *
   * On a phone this banner is 167px tall — a fifth of the screen — and it
   * landed directly on the storefront preview that is the entire proof of
   * "Urivo builds it". The first thing a visitor saw was a legal notice sitting
   * on top of the product.
   *
   * This is a presentation change and NOT a change to consent: analytics is
   * gated on getConsent() === "granted" in lib/analytics, so nothing
   * non-essential is set before the visitor answers, whether the banner is on
   * screen at that moment or not. Delaying a request for permission that
   * nothing is waiting on costs no one anything.
   *
   * Three ways in, because a banner that can never appear is worse than one
   * that appears early — the visitor could never grant OR refuse:
   *
   *   1. the first real scroll,
   *   2. immediately when the page is too short to scroll (the login screen),
   *   3. a timeout, for someone who lands and reads without moving.
   */
  useEffect(() => {
    if (getConsent() !== null) return;

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const reveal = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
      setShow(true);
    };

    // A few pixels of tolerance: elastic scroll and rounding both produce tiny
    // non-zero offsets that are not a visitor deciding to look further.
    function onScroll() {
      if (window.scrollY > 24) reveal();
    }

    /*
     * No page-height heuristic. There was one — "if the document cannot scroll,
     * show the banner at once" — and it was wrong in a way worth recording:
     * measured during hydration the landing page reports a scrollHeight equal
     * to the viewport for the better part of a second, because the
     * scroll-reveal sections have not mounted their content yet. A page three
     * thousand pixels tall therefore looked unscrollable, and the banner
     * appeared immediately on exactly the screen this was meant to protect.
     * Deferring the measurement only moved the race.
     *
     * A plain timeout needs no measurement and cannot be wrong: whoever scrolls
     * gets the banner then, whoever does not gets it shortly after, and a short
     * page is covered by the same branch as a long one.
     */
    window.addEventListener("scroll", onScroll, { passive: true });
    timer = setTimeout(reveal, 3500);
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer) clearTimeout(timer);
    };
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
