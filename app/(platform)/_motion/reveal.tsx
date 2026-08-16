"use client";

import { useRef, type ElementType, type ReactNode } from "react";
import { ensureGsap, prefersReducedMotion, useIsomorphicLayoutEffect } from "./motion";

/*
 * Reveal — the platform's scroll-in primitive. An element rises and fades in
 * once, the first time it enters the viewport (or immediately, staggered, if
 * it's already on screen at load). Cards, sections and widgets use this so the
 * page assembles itself progressively instead of appearing all at once.
 *
 * Performance: transform + opacity only (compositor-friendly, no layout shift),
 * `once` triggers so nothing re-runs on scroll, and a single gsap.context per
 * element that reverts on unmount. Reduced-motion → rendered visible, no tween.
 * No-JS / SSR → visible by default; the pre-paint layout effect sets the
 * starting state so there's never a flash.
 */

export interface RevealProps {
  children: ReactNode;
  /** Upward travel in px (kept small — this is a whisper, not a slide). */
  y?: number;
  /** Stagger offset; pass index * step from a mapped list. */
  delay?: number;
  duration?: number;
  className?: string;
  as?: ElementType;
  /** Viewport trigger point; default fires just before fully on-screen. */
  start?: string;
}

export function Reveal({
  children,
  y = 14,
  delay = 0,
  duration = 0.6,
  className,
  as: Tag = "div",
  start = "top 90%",
}: RevealProps) {
  const ref = useRef<HTMLElement>(null);

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return; // visible, no motion
    const gsap = ensureGsap();
    const ctx = gsap.context(() => {
      gsap.set(el, { opacity: 0, y, willChange: "transform" });
      gsap.to(el, {
        opacity: 1,
        y: 0,
        duration,
        delay,
        clearProps: "willChange",
        scrollTrigger: { trigger: el, start, once: true },
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
