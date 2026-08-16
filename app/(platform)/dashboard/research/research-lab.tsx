"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AttachButton } from "../_shell/attach";
import type { Attachment } from "@/lib/ai/attachments";
import { useRouter } from "next/navigation";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import { RevealStagger } from "../../_motion/reveal-stagger";

/*
 * Market Research lab. A founder describes a niche; Urivo returns a market read,
 * audience, positioning, competitor gaps and candidate products. Each product —
 * and the brand direction — can seed a store generation on the dashboard.
 */

interface Report {
  niche: string;
  summary: string;
  demand: { level: "emerging" | "growing" | "established" | "saturated"; rationale: string; seasonality: string | null };
  audience: { segment: string; who: string; pains: string[]; trigger: string }[];
  positioning: { angle: string; why: string }[];
  competitors: { landscape: string; gaps: string[] };
  products: { title: string; description: string; priceRange: string; whyItWins: string }[];
  brand: { name: string; tagline: string; vibe: string };
}

const SUGGESTIONS = ["Premium men's skincare", "Sustainable pet accessories", "Home barista gear", "Heirloom kitchen tools"];

const PHASES = ["Reading the market", "Mapping the audience", "Finding the gaps", "Shortlisting products"];

const DEMAND_STYLE: Record<Report["demand"]["level"], string> = {
  emerging: "border-gold/30 bg-gold/[0.08] text-gold-soft",
  growing: "border-live/30 bg-live/10 text-live",
  established: "border-hair-strong bg-white/[0.04] text-cloud",
  saturated: "border-alert/30 bg-alert/10 text-alert",
};

export function ResearchLab() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState(0);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 1400);
    return () => clearInterval(id);
  }, [busy]);

  const run = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (content.length < 4 || busy) return;
      setError(null);
      setReport(null);
      setBusy(true);
      setPhase(0);
      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: content,
            attachments: attachments.length ? attachments : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Research is unavailable right now.");
        setReport(data.report);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Research hit a snag. Please try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  function generateFrom(idea: string) {
    router.push(`/dashboard?idea=${encodeURIComponent(idea)}`);
  }

  return (
    <div className="mt-7">
      {/* Input */}
      <div className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
        <div className="rounded-xl border border-hair bg-night transition-colors focus-within:border-gold/50">
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(prompt);
            }}
            disabled={busy}
            placeholder="A niche or idea — e.g. 'minimalist skincare for sensitive skin, made in Switzerland'"
            className="w-full resize-none bg-transparent px-4 pt-3.5 text-sm text-ivory placeholder:text-mist-dim focus:outline-none disabled:opacity-60"
          />
          <div className="px-3 pb-1">
            <AttachButton
              attachments={attachments}
              onChange={setAttachments}
              disabled={busy}
              compact
              hint="Attach competitor screenshots, packaging or landing pages — the research is read off them, not guessed."
            />
          </div>
          <div className="flex items-center justify-between px-3 pb-3">
            <span className="text-[10px] text-mist-dim">⌘↵ to research · {CREDIT_COSTS.marketResearch} credits</span>
            <button
              onClick={() => run(prompt)}
              disabled={busy || prompt.trim().length < 4}
              className="u-gold u-lift rounded-lg px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Researching…" : "Research market"}
            </button>
          </div>
        </div>
        {!report && !busy && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => { setPrompt(s); run(s); }}
                className="u-press rounded-full border border-hair bg-panel/60 px-2.5 py-1 text-[11px] text-cloud transition-colors hover:border-gold/40 hover:text-ivory"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-alert/20 bg-alert/5 px-4 py-3 text-sm text-alert">
          {error}
        </p>
      )}

      {busy && <LoadingState phase={phase} />}

      {report && <ReportView report={report} onGenerate={generateFrom} />}
    </div>
  );
}

function LoadingState({ phase }: { phase: number }) {
  return (
    <div className="u-float mt-5 rounded-2xl border border-hair bg-panel/60 p-8">
      <div className="flex items-center gap-3">
        <span className="h-2 w-2 animate-pulse rounded-full" style={{ backgroundImage: "var(--grad-gold)" }} />
        <span className="text-sm font-medium text-ivory">{PHASES[phase]}…</span>
      </div>
      <div className="mt-5 space-y-2.5">
        <div className="u-skel h-4 w-2/3 rounded" />
        <div className="u-skel h-4 w-1/2 rounded" />
        <div className="u-skel h-24 w-full rounded-xl" />
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">{label}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function ReportView({ report, onGenerate }: { report: Report; onGenerate: (idea: string) => void }) {
  const brandIdea = `${report.brand.name} — ${report.brand.vibe}. ${report.summary}`;
  return (
    <RevealStagger className="mt-6">
      {/* Overview */}
      <div className="u-float rounded-2xl border border-hair bg-panel/70 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">{report.niche}</p>
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${DEMAND_STYLE[report.demand.level]}`}>
            {report.demand.level} demand
          </span>
        </div>
        <p className="mt-3 text-lg leading-relaxed text-ivory">{report.summary}</p>
        <p className="mt-3 text-sm leading-relaxed text-mist">{report.demand.rationale}</p>
        {report.demand.seasonality && (
          <p className="mt-2 text-xs text-mist-dim">Seasonality — {report.demand.seasonality}</p>
        )}
        <p className="mt-4 text-[10px] uppercase tracking-[0.14em] text-mist-dim">AI assessment · not live market data</p>
      </div>

      {/* Audience */}
      <Section label="Who buys">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {report.audience.map((a) => (
            <div key={a.segment} className="u-float rounded-xl border border-hair bg-panel/60 p-4">
              <p className="text-sm font-semibold text-ivory">{a.segment}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">{a.who}</p>
              <ul className="mt-3 space-y-1">
                {a.pains.map((p) => (
                  <li key={p} className="flex gap-1.5 text-xs text-cloud">
                    <span className="text-gold-soft">·</span> {p}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-mist-dim">
                <span className="font-semibold text-mist">Buys when</span> — {a.trigger}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Positioning + competitors */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Angles to win</h2>
          <div className="mt-3 space-y-2.5">
            {report.positioning.map((p) => (
              <div key={p.angle} className="u-float rounded-xl border border-hair bg-panel/60 p-4">
                <p className="text-sm font-semibold text-ivory">{p.angle}</p>
                <p className="mt-1 text-xs leading-relaxed text-mist">{p.why}</p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">The landscape &amp; the gaps</h2>
          <div className="u-float mt-3 rounded-xl border border-hair bg-panel/60 p-4">
            <p className="text-xs leading-relaxed text-mist">{report.competitors.landscape}</p>
            <ul className="mt-3 space-y-1.5">
              {report.competitors.gaps.map((g) => (
                <li key={g} className="flex gap-2 text-xs text-cloud">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundImage: "var(--grad-gold)" }} />
                  {g}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Winning products */}
      <Section label="Products worth launching">
        <div className="grid gap-3 sm:grid-cols-2">
          {report.products.map((p) => (
            <div key={p.title} className="u-float flex flex-col rounded-xl border border-hair bg-panel/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-ivory">{p.title}</p>
                <span className="shrink-0 font-mono text-xs text-gold-soft">{p.priceRange}</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">{p.description}</p>
              <p className="mt-2 flex-1 text-[11px] leading-relaxed text-cloud">
                <span className="font-semibold text-mist">Why it wins</span> — {p.whyItWins}
              </p>
              <button
                onClick={() => onGenerate(`${report.brand.vibe}. Hero product: ${p.title} — ${p.description}. Market: ${report.niche}.`)}
                className="u-lift mt-3 rounded-lg border border-hair bg-panel px-3 py-2 text-xs font-medium text-ivory transition-colors hover:border-gold/40 active:scale-[0.98]"
              >
                Generate a store from this
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Brand direction */}
      <Section label="A brand to build">
        <div className="u-float flex flex-col items-start gap-4 rounded-2xl border border-gold/25 bg-gold/[0.04] p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-2xl font-semibold tracking-tight text-ivory">{report.brand.name}</p>
            <p className="mt-1 text-sm italic text-mist">{report.brand.tagline}</p>
            <p className="mt-2 text-xs text-mist-dim">{report.brand.vibe}</p>
          </div>
          <button onClick={() => onGenerate(brandIdea)} className="u-gold u-lift shrink-0 rounded-xl px-5 py-3 text-sm font-semibold">
            Generate this store
          </button>
        </div>
      </Section>
    </RevealStagger>
  );
}
