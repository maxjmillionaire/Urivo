"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GenerationCinema, type CinemaResult } from "./generation-cinema";

/*
 * Store generation entry point. Collects the idea + address, then hands off to
 * the Generation Cinema (the signature creation sequence). The real API request
 * runs while the cinema plays; the reveal uses the real generated store.
 */

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export function GenerateStorePanel({ canGenerate }: { canGenerate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Cinema state
  const [cinema, setCinema] = useState<{ prompt: string } | null>(null);
  const [result, setResult] = useState<CinemaResult | null>(null);
  const [cinemaError, setCinemaError] = useState<string | null>(null);

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

    // Launch the cinema and fire the real request in parallel.
    const p = prompt.trim();
    setOpen(false);
    setResult(null);
    setCinemaError(null);
    setCinema({ prompt: p });

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
      setCinemaError(err instanceof Error ? err.message : "Generation failed. Please try again.");
    }
  }

  function closeCinema() {
    setCinema(null);
    setResult(null);
    setCinemaError(null);
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
        className="rounded-lg bg-gold-500 px-5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-forest-900 transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-champagne"
      >
        ✦ Generate store
      </button>

      {/* Idea form */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-ivory-100/10 bg-forest-900 p-8 sm:p-10">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
                  New storefront
                </p>
                <h2 className="mt-3 font-serif text-3xl font-normal tracking-tight text-ivory-100">
                  What would you like to sell?
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ivory-100/40 transition-colors hover:text-ivory-100"
              >
                ✕
              </button>
            </div>

            {!canGenerate && (
              <p className="mt-6 rounded-lg border border-gold-500/30 bg-gold-500/10 px-4 py-3 text-sm text-gold-300">
                You don't have enough credits for a new store. Upgrade to keep building.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-6 rounded-lg border border-danger-dark/30 bg-danger-dark/10 px-4 py-3 text-sm text-danger-dark">
                {error}
              </p>
            )}

            <form onSubmit={submit} className="mt-6 space-y-5">
              <div>
                <label htmlFor="gen-prompt" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/60">
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
                  className="w-full resize-none rounded-lg border border-ivory-100/15 bg-ivory-100/5 px-4 py-3.5 text-sm font-light text-ivory-100 placeholder:text-ivory-100/30 focus:border-gold-500 focus:bg-ivory-100/10 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="gen-subdomain" className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/60">
                  Store address
                </label>
                <div className="flex items-center rounded-lg border border-ivory-100/15 bg-ivory-100/5 focus-within:border-gold-500">
                  <input
                    id="gen-subdomain"
                    type="text"
                    required
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="yourbrand"
                    className="w-full bg-transparent px-4 py-3.5 text-sm font-light text-ivory-100 placeholder:text-ivory-100/30 focus:outline-none"
                  />
                  <span className="whitespace-nowrap pr-4 font-mono text-xs text-ivory-100/40">.urivo.ai</span>
                </div>
              </div>
              <button
                type="submit"
                disabled={!canGenerate}
                className="w-full rounded-lg bg-gold-500 px-4 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-forest-900 transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-champagne disabled:translate-y-0 disabled:opacity-50"
              >
                Generate my store
              </button>
            </form>
          </div>
        </div>
      )}

      {/* The cinematic creation sequence */}
      {cinema && (
        <GenerationCinema
          prompt={cinema.prompt}
          result={result}
          error={cinemaError}
          onOpenStore={(url) => {
            if (url.startsWith("/")) window.location.href = url;
            else window.open(url, "_blank", "noreferrer");
          }}
          onClose={closeCinema}
        />
      )}
    </>
  );
}
