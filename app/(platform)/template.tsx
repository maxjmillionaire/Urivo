"use client";

import { useRef, type ReactNode } from "react";
import { ensureGsap, prefersReducedMotion, useIsomorphicLayoutEffect } from "./_motion/motion";

/*
 * Page transition. Next re-mounts this template on every navigation, so it's
 * the one place a route change gets a deliberate entrance instead of an abrupt
 * swap. A soft opacity settle — nothing that shifts layout.
 *
 * Opacity ONLY, on purpose: the app shell's sidebar and companion rail are
 * position:fixed, and a transform on this wrapper would become their containing
 * block and break the layout mid-transition. The gentle upward motion lives on
 * the inner content (the shell's scrolling column), never on this ancestor.
 */
export default function PlatformTemplate({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const gsap = ensureGsap();
    const ctx = gsap.context(() => {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.32, ease: "power2.out" });
    }, ref);
    return () => ctx.revert();
  }, []);

  return <div ref={ref}>{children}</div>;
}
