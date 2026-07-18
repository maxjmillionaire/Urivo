"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GenerationStudio, type StudioResult } from "./generation-studio";

/*
 * Store generation entry point. Collects the idea + address, then flashes to the
 * full-screen Generation Studio — a focused creation experience with a quiet way
 * back to the dashboard. The real API request runs while the studio plays; the
 * reveal uses the real generated store.
 */

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export function GenerateStorePanel({ canGenerate }: { canGenerate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Studio state
  const [studio, setStudio] = useState<{ prompt: string } | null>(null);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);

  function reset() {
    setPrompt("");
    setSubdomain("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (prompt.trim().length < 8) {
      setError("Tell us a little more about your idea.");
      return;
    }
    if (!SUBDOMAIN_RE.test(subdomain.trim().toLowerCase())) {
      setError("Choose an address: 3–63 letters, numbers or hyphens.");
      return;
    }

    // Flash to the studio and fire the real request in parallel.
    const p = prompt.trim();
    setOpen(false);
    setResult(null);
    setStudioError(null);
    setStudio({ prompt: p });

    try {
      const res = await fetch("/api/generate-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: p, subdomain: subdomain.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Generation failed. Please try again.");
      setResult({
        storeName: data.storeName,
        tagline: data.tagline,
        storeUrl: data.storeUrl,
        palette: data.palette,
        products: data.products ?? [],
        creditsRemaining: data.creditsRemaining,
      });
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : "Generation failed. Please try again.");
    }
  }

  function closeStudio() {
    setStudio(null);
    setResult(null);
    setStudioError(null);
    reset();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="u-gold u-lift inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <path d="M12 8.5 13 11l2.5 1-2.5 1-1 2.5-1-2.5L8.5 12 11 11 12 8.5Z" />
        </svg>
        Generate store
      </button>

      {/* Idea form */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-6 backdrop-blur-sm">
          <div className="u-float u-glass w-full max-w-lg rounded-2xl border border-hair p-8 sm:p-10">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
                  New storefront
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ivory">
                  What would you like to sell?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-mist transition-colors hover:text-ivory"
              >
                ✕
              </button>
            </div>

            {!canGenerate && (
              <p className="mt-6 rounded-xl border border-gold/25 bg-gold/[0.06] px-4 py-3 text-sm text-gold-soft">
                You don&apos;t have enough credits for a new store. Upgrade to keep building.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-6 rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">
                {error}
              </p>
            )}

            <form onSubmit={submit} className="mt-6 space-y-5">
              <div>
                <label htmlFor="gen-prompt" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                  Your idea
                </label>
                <textarea
                  id="gen-prompt"
                  rows={3}
                  required
                  maxLength={500}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A minimalist skincare line for sensitive skin, made in Switzerland."
                  className="w-full resize-none rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20"
                />
              </div>
              <div>
                <label htmlFor="gen-subdomain" className="mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                  Store address
                </label>
                <div className="flex items-center rounded-xl border border-hair bg-night transition-colors focus-within:border-gold/50 focus-within:ring-1 focus-within:ring-gold/20">
                  <input
                    id="gen-subdomain"
                    type="text"
                    required
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="yourbrand"
                    className="w-full bg-transparent px-4 py-3 text-sm text-ivory placeholder:text-mist-dim focus:outline-none"
                  />
                  <span className="whitespace-nowrap pr-4 font-mono text-xs text-mist-dim">.urivo.ai</span>
                </div>
              </div>
              <button
                type="submit"
                disabled={!canGenerate}
                className="u-gold u-lift w-full rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-50"
              >
                Generate my store
              </button>
            </form>
          </div>
        </div>
      )}

      {/* The focused, full-screen creation experience */}
      {studio && (
        <GenerationStudio
          prompt={studio.prompt}
          result={result}
          error={studioError}
          onOpenStore={(url) => {
            if (url.startsWith("/")) window.location.href = url;
            else window.open(url, "_blank", "noreferrer");
          }}
          onClose={closeStudio}
        />
      )}
    </>
  );
}
