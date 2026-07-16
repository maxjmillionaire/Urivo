"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/*
 * Store generation experience (screens-v1 §5).
 * Prompt + subdomain → full-screen loader with cycling pipeline stages →
 * success reveal. The generation itself is a single server request; the
 * staged loader is presentational (real queue-driven progress is post-launch).
 */

const STAGES = [
  "Researching your market",
  "Naming your brand",
  "Designing your identity",
  "Writing your catalog",
  "Deploying your store",
];

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

type Success = {
  storeName: string;
  storeUrl: string;
  creditsRemaining: number;
};

export function GenerateStorePanel({ canGenerate }: { canGenerate: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const stageTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stageTimer.current) clearInterval(stageTimer.current);
    };
  }, []);

  function reset() {
    setPrompt("");
    setSubdomain("");
    setError(null);
    setSuccess(null);
    setStage(0);
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
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

    setBusy(true);
    setStage(0);
    stageTimer.current = setInterval(() => {
      setStage((s) => (s < STAGES.length - 1 ? s + 1 : s));
    }, 4000);

    try {
      const res = await fetch("/api/generate-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim(), subdomain: subdomain.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Generation failed. Please try again.");
      setSuccess({
        storeName: data.storeName,
        storeUrl: data.storeUrl,
        creditsRemaining: data.creditsRemaining,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed. Please try again.");
    } finally {
      if (stageTimer.current) clearInterval(stageTimer.current);
      setBusy(false);
    }
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

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/70 px-6 py-10 backdrop-blur-sm">
          {/* Loader */}
          {busy && !success && (
            <div className="w-full max-w-2xl text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
                Urivo is building
              </p>
              <h2 className="mt-6 font-serif text-4xl font-normal tracking-tight text-ivory-100 sm:text-5xl">
                {STAGES[stage]}
              </h2>
              <div className="mx-auto mt-10 h-px w-full max-w-md overflow-hidden bg-ivory-100/10">
                <div className="h-full w-1/3 animate-[urivo-shimmer_2s_var(--ease-urivo)_infinite] bg-gradient-to-r from-transparent via-gold-500 to-transparent" />
              </div>
              <p className="mt-8 text-sm font-light text-ivory-100/50">
                This usually takes under a minute. Your credits are only spent on success.
              </p>
            </div>
          )}

          {/* Success reveal */}
          {success && (
            <div className="w-full max-w-lg rounded-2xl border border-gold-500/20 bg-forest-900 p-10 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
                Your store is live
              </p>
              <h2 className="mt-5 font-serif text-4xl font-normal tracking-tight text-ivory-100">
                {success.storeName}
              </h2>
              <p className="mt-3 text-sm font-light text-ivory-100/60">
                {success.creditsRemaining} credits remaining
              </p>
              <div className="mt-8 flex flex-col gap-3">
                <a
                  href={success.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg bg-gold-500 px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-forest-900 transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-champagne"
                >
                  Open store
                </a>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-ivory-100/15 px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/70 transition-colors duration-200 hover:border-ivory-100/30 hover:text-ivory-100"
                >
                  Back to dashboard
                </button>
              </div>
            </div>
          )}

          {/* Form */}
          {!busy && !success && (
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
                  onClick={close}
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
                <p
                  role="alert"
                  className="mt-6 rounded-lg border border-danger-dark/30 bg-danger-dark/10 px-4 py-3 text-sm text-danger-dark"
                >
                  {error}
                </p>
              )}

              <form onSubmit={submit} className="mt-6 space-y-5">
                <div>
                  <label
                    htmlFor="gen-prompt"
                    className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/60"
                  >
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
                  <label
                    htmlFor="gen-subdomain"
                    className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.2em] text-ivory-100/60"
                  >
                    Store address
                  </label>
                  <div className="flex items-center rounded-lg border border-ivory-100/15 bg-ivory-100/5 focus-within:border-gold-500">
                    <input
                      id="gen-subdomain"
                      type="text"
                      required
                      value={subdomain}
                      onChange={(e) =>
                        setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                      }
                      placeholder="yourbrand"
                      className="w-full bg-transparent px-4 py-3.5 text-sm font-light text-ivory-100 placeholder:text-ivory-100/30 focus:outline-none"
                    />
                    <span className="whitespace-nowrap pr-4 font-mono text-xs text-ivory-100/40">
                      .urivo.ai
                    </span>
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
          )}
        </div>
      )}
    </>
  );
}
