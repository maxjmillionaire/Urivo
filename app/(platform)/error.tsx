"use client";

import { useEffect } from "react";
import Link from "next/link";

/*
 * Error boundary for Urivo's product surfaces (marketing, auth, dashboard).
 * Keeps the user inside the brand when a route throws, with a calm recovery.
 */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-night px-6 text-ivory">
      <div className="w-full max-w-md text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold-soft">Something went wrong</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">This page hit a snag</h1>
        <p className="mt-3 text-sm leading-relaxed text-mist">
          The error has been logged. You can try again, or head back to your dashboard.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="u-gold u-lift rounded-xl px-5 py-3 text-sm font-semibold"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="u-lift rounded-xl border border-hair bg-panel px-5 py-3 text-sm font-medium text-ivory transition-colors hover:border-hair-strong"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
