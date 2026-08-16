"use client";

import { useEffect, useLayoutEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/*
 * Motion core — the single GSAP entry point for the whole platform.
 *
 * Principles (UEOS Book VI + the Premium Motion mandate):
 *  • GPU only — every tween animates transform/opacity, never layout.
 *  • Context-safe — callers wrap work in gsap.context() and revert on unmount.
 *  • Reduced-motion first — honoured everywhere; motion is an enhancement,
 *    never a requirement for the UI to be usable.
 *  • Registered once — ScrollTrigger is a singleton across the app.
 */

let registered = false;

export function ensureGsap(): typeof gsap {
  if (!registered && typeof window !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
    // One shared, calm curve — the product's signature ease.
    gsap.defaults({ ease: "power3.out" });
    registered = true;
  }
  return gsap;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Pre-paint on the client (no flash of the pre-animation state), plain effect
// during SSR so React never warns about useLayoutEffect on the server.
export const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export { gsap, ScrollTrigger };
