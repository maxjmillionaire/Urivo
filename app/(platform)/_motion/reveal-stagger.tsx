"use client";

import { useRef, type ReactNode } from "react";
import { ensureGsap, prefersReducedMotion, useIsomorphicLayoutEffect, ScrollTrigger } from "./motion";

/*
 * RevealStagger — wrap a stack of sections once and every direct child reveals
 * in as it enters the viewport, batched so items that appear together share a
 * gentle stagger. This is how a whole page "assembles itself" with a single
 * edit instead of decorating every section by hand.
 *
 * Same performance contract as Reveal: transform + opacity only, `once`
 * triggers, one gsap.context that reverts on unmount. Reduced-motion / no-JS →
 * everything visible, no motion. The pre-paint layout effect sets the starting
 * state so there's never a flash of the settled layout.
 */
export function RevealStagger({
  children,
  className,
  y = 14,
  stagger = 0.06,
  duration = 0.6,
  start = "top 92%",
}: {
  children: ReactNode;
  className?: string;
  y?: number;
  stagger?: number;
  duration?: number;
  start?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    const root = ref.current;
    if (!root || prefersReducedMotion()) return;
    const gsap = ensureGsap();
    const items = Array.from(root.children) as HTMLElement[];
    if (items.length === 0) return;

    const ctx = gsap.context(() => {
      gsap.set(items, { opacity: 0, y, willChange: "transform" });
      ScrollTrigger.batch(items, {
        start,
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, { opacity: 1, y: 0, duration, stagger, overwrite: true, clearProps: "willChange" }),
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
