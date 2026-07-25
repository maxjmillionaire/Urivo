"use client";

import { useEffect, useRef, useState } from "react";
import type { KpiDisplay } from "@/lib/dashboard/overview";

/*
 * Count-up number for the KPI cards. Eases from 0 to the value once, on mount,
 * then holds. Formats as currency / plain / percent. Honours reduced-motion by
 * snapping straight to the final value. Uses tabular figures so the digits
 * don't jitter as they climb.
 */

function format(value: number, display: KpiDisplay): string {
  if (display === "currency") {
    return value % 1 === 0
      ? `€${Math.round(value).toLocaleString("en-US")}`
      : `€${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (display === "percent") return `${value.toFixed(1)}%`;
  return Math.round(value).toLocaleString("en-US");
}

export function AnimatedNumber({
  value,
  display,
  className,
  durationMs = 900,
}: {
  value: number;
  display: KpiDisplay;
  className?: string;
  durationMs?: number;
}) {
  // Start at the final value on the server / before hydration so there's no
  // flash; the count-up only replaces it once the number scrolls into view.
  const [shown, setShown] = useState(value);
  const raf = useRef<number | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const played = useRef(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value === 0) {
      setShown(value);
      return;
    }

    const run = () => {
      if (played.current) return;
      played.current = true;
      const start = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - start) / durationMs);
        // easeOutExpo — fast then settling, matches the product's motion curve.
        const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
        setShown(value * eased);
        if (p < 1) raf.current = requestAnimationFrame(tick);
      };
      setShown(0);
      raf.current = requestAnimationFrame(tick);
    };

    // Count up the first time the figure is visible (spec: "statistics count up
    // once visible"). IntersectionObserver is cheap and self-disconnecting.
    if (typeof IntersectionObserver === "undefined") {
      run();
    } else {
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            run();
            io.disconnect();
          }
        },
        { threshold: 0.4 },
      );
      io.observe(el);
      return () => {
        io.disconnect();
        if (raf.current) cancelAnimationFrame(raf.current);
      };
    }
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [value, durationMs]);

  return (
    <span ref={host} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {format(shown, display)}
    </span>
  );
}
