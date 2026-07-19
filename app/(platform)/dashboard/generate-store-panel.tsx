"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GenerationStudio, type StudioResult } from "./generation-studio";
import { GenerationCinema } from "./generation-cinema";
import { track } from "@/lib/analytics";

/*
 * Store generation entry point. Collects the idea + address, then flashes to the
 * full-screen creation experience while the real API request runs; the reveal
 * uses the real generated store.
 *
 * The signature experience is the Generation Cinema — a real design-search
 * visualization (every number comes from the evolution engine, nothing faked).
 * Visitors who prefer reduced motion get the calmer, staged Generation Studio
 * instead. Both are honest and both reveal the same real store.
 */

/*
 * Prefer the calm, vertical Generation Studio when the viewer asked for reduced
 * motion OR is on a narrow screen — the horizontal tournament bracket of the
 * Cinema needs width to breathe, so phones get the Studio instead. Both reveal
 * the same real store.
 */
function usePreferStudio() {
  const [studio, setStudio] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = window.matchMedia("(max-width: 1023px)");
    const on = () => setStudio(reduce.matches || narrow.matches);
    on();
    reduce.addEventListener("change", on);
    narrow.addEventListener("change", on);
    return () => {
      reduce.removeEventListener("change", on);
      narrow.removeEventListener("change", on);
    };
  }, []);
  return studio;
}

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

type AvailabilityState =
  | { status: "idle" | "checking" | "available" | "invalid" }
  | { status: "taken"; reason: "taken" | "reserved" | "invalid" };

interface NameSuggestion {
  name: string;
  subdomain: string;
  rationale?: string;
}

export function GenerateStorePanel({
  canGenerate,
  autoOpenFromIdea = true,
  triggerLabel = "Generate store",
  triggerClassName,
}: {
  canGenerate: boolean;
  autoOpenFromIdea?: boolean;
  triggerLabel?: string;
  triggerClassName?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferStudio = usePreferStudio();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Store-name skill: live availability + brandable, available-only suggestions.
  const [availability, setAvailability] = useState<AvailabilityState>({ status: "idle" });
  const [ideas, setIdeas] = useState<NameSuggestion[]>([]);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);

  // Close the idea modal on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Debounced, live availability as the founder types the address.
  useEffect(() => {
    const value = subdomain.trim().toLowerCase();
    if (!open || value.length === 0) {
      setAvailability({ status: "idle" });
      return;
    }
    if (!SUBDOMAIN_RE.test(value)) {
      setAvailability({ status: "invalid" });
      return;
    }
    setAvailability({ status: "checking" });
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/store-name/check?subdomain=${encodeURIComponent(value)}`, { signal: ctrl.signal });
        const data = await res.json();
        if (data.available) setAvailability({ status: "available" });
        else setAvailability({ status: "taken", reason: data.reason });
      } catch {
        if (!ctrl.signal.aborted) setAvailability({ status: "idle" });
      }
    }, 400);
    return () => {
      ctrl.abort();
      clearTimeout(id);
    };
  }, [subdomain, open]);

  async function getNameIdeas() {
    if (ideasBusy) return;
    setIdeasError(null);
    if (prompt.trim().length < 4) {
      setIdeasError("Add a line about your idea first — then I'll find names.");
      return;
    }
    setIdeasBusy(true);
    try {
      const res = await fetch("/api/store-name/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "Couldn't find names just now.");
      setIdeas(data.suggestions ?? []);
      if ((data.suggestions ?? []).length === 0) setIdeasError("Every name I found was taken — try a more specific idea.");
    } catch (err) {
      setIdeasError(err instanceof Error ? err.message : "Couldn't find names just now.");
    } finally {
      setIdeasBusy(false);
    }
  }

  // Arriving from Market Research with a prefilled idea → open the form ready.
  useEffect(() => {
    if (!autoOpenFromIdea) return;
    const idea = searchParams.get("idea");
    if (idea) {
      setPrompt(idea.slice(0, 500));
      setError(null);
      setOpen(true);
      router.replace("/dashboard", { scroll: false });
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Studio state
  const [studio, setStudio] = useState<{ prompt: string } | null>(null);
  const [result, setResult] = useState<StudioResult | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);

  function reset() {
    setPrompt("");
    setSubdomain("");
    setError(null);
    setAvailability({ status: "idle" });
    setIdeas([]);
    setIdeasError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    track("generate_submitted");
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
      track("store_generated", { subdomain: subdomain.trim().toLowerCase() });
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

  function openStore(url: string) {
    if (url.startsWith("/")) window.location.href = url;
    else window.open(url, "_blank", "noreferrer");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className={triggerClassName ?? "u-gold u-lift inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold"}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
          <path d="M12 8.5 13 11l2.5 1-2.5 1-1 2.5-1-2.5L8.5 12 11 11 12 8.5Z" />
        </svg>
        {triggerLabel}
      </button>

      {/* Idea form */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-night/70 px-6 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gen-modal-title"
            onClick={(e) => e.stopPropagation()}
            className="u-float u-glass w-full max-w-lg rounded-2xl border border-hair p-8 sm:p-10"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
                  New storefront
                </p>
                <h2 id="gen-modal-title" className="mt-3 text-3xl font-semibold tracking-tight text-ivory">
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
                  autoFocus
                  maxLength={500}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="A minimalist skincare line for sensitive skin, made in Switzerland."
                  className="w-full resize-none rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="gen-subdomain" className="block text-xs font-semibold uppercase tracking-[0.12em] text-mist">
                    Store address
                  </label>
                  <button
                    type="button"
                    onClick={getNameIdeas}
                    disabled={ideasBusy}
                    className="u-press inline-flex items-center gap-1 text-[11px] font-semibold text-gold-soft transition-colors hover:text-gold disabled:opacity-50"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
                      <path d="M12 8.5 13 11l2.5 1-2.5 1-1 2.5-1-2.5L8.5 12 11 11 12 8.5Z" />
                    </svg>
                    {ideasBusy ? "Finding names…" : "Find me a name"}
                  </button>
                </div>
                <div
                  className={`flex items-center rounded-xl border bg-night transition-colors focus-within:ring-1 ${
                    availability.status === "available"
                      ? "border-live/50 focus-within:border-live/60 focus-within:ring-live/20"
                      : availability.status === "taken"
                        ? "border-alert/50 focus-within:border-alert/60 focus-within:ring-alert/20"
                        : "border-hair focus-within:border-gold/50 focus-within:ring-gold/20"
                  }`}
                >
                  <input
                    id="gen-subdomain"
                    type="text"
                    required
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="yourbrand"
                    aria-describedby="gen-subdomain-status"
                    className="w-full bg-transparent px-4 py-3 text-sm text-ivory placeholder:text-mist-dim focus:outline-none"
                  />
                  <span className="flex items-center gap-2 whitespace-nowrap pr-4">
                    {availability.status === "checking" && <span className="h-2 w-2 animate-pulse rounded-full bg-mist" />}
                    {availability.status === "available" && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-live" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
                    )}
                    {availability.status === "taken" && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-alert" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                    )}
                    <span className="font-mono text-xs text-mist-dim">.urivo.ai</span>
                  </span>
                </div>
                <p id="gen-subdomain-status" className="mt-1.5 min-h-4 text-[11px] leading-tight" aria-live="polite">
                  {availability.status === "checking" && <span className="text-mist-dim">Checking availability…</span>}
                  {availability.status === "available" && <span className="text-live">Available — {subdomain}.urivo.ai is yours.</span>}
                  {availability.status === "taken" && availability.reason === "reserved" && <span className="text-alert">That address is reserved. Try another or tap “Find me a name”.</span>}
                  {availability.status === "taken" && availability.reason !== "reserved" && <span className="text-alert">Taken — try another or tap “Find me a name”.</span>}
                  {availability.status === "invalid" && <span className="text-mist-dim">3–63 letters, numbers or hyphens.</span>}
                </p>
              </div>

              {/* Name skill — only genuinely-available, brandable names */}
              {(ideas.length > 0 || ideasError) && (
                <div className="u-enter rounded-xl border border-hair bg-night/60 p-4">
                  {ideasError ? (
                    <p className="text-xs text-mist">{ideasError}</p>
                  ) : (
                    <>
                      <p className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-soft">
                        Available names, picked for you
                      </p>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {ideas.map((s) => (
                          <button
                            key={s.subdomain}
                            type="button"
                            onClick={() => setSubdomain(s.subdomain)}
                            title={s.rationale}
                            className={`u-press group flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                              subdomain === s.subdomain ? "border-gold/50 bg-gold/[0.06]" : "border-hair bg-panel/50 hover:border-hair-strong"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-ivory">{s.name}</span>
                              <span className="block truncate font-mono text-[10px] text-mist-dim">{s.subdomain}.urivo.ai</span>
                            </span>
                            <span className="shrink-0 rounded-full border border-live/30 bg-live/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-live">Free</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
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
      {studio &&
        (preferStudio ? (
          <GenerationStudio
            prompt={studio.prompt}
            result={result}
            error={studioError}
            onOpenStore={openStore}
            onClose={closeStudio}
          />
        ) : (
          <GenerationCinema
            prompt={studio.prompt}
            result={result}
            error={studioError}
            onOpenStore={openStore}
            onClose={closeStudio}
          />
        ))}
    </>
  );
}
