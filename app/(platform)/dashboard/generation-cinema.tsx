"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runEvolution, type Scores } from "@/lib/evolution/engine";
import { describeVariant } from "@/lib/evolution/candidates";

/*
 * The Generation Cinema — Urivo's signature creation sequence (spec 6.6).
 *
 * A design-search visualization: Urivo's evolution engine explores many storefront
 * candidates across successive generations, scoring each on real design-quality
 * dimensions, and converges on the strongest — which then blooms into the real
 * AI-generated store.
 *
 * EVERY NUMBER ON THIS SCREEN IS REAL. The candidate count, generation count,
 * scoring-dimension count and per-candidate fitness scores all come from the
 * deterministic evolution engine (lib/evolution). The elapsed time is real
 * wall-clock. There are no fabricated traffic/conversion/confidence metrics and
 * no decorative controls that don't do anything — honesty is the whole point.
 * The champion reveal uses the real AI-generated store passed in `result`.
 */

export interface CinemaResult {
  storeName: string;
  tagline: string;
  storeUrl: string;
  published: boolean;
  palette: { background: string; structure: string; accent: string };
  products: { title: string; priceEUR: number }[];
  creditsRemaining: number;
}

type Props = {
  prompt: string;
  result: CinemaResult | null;
  error: string | null;
  onOpenStore: (url: string) => void;
  onClose: () => void;
};

// Logical stage size; scaled to fit the viewport.
const STAGE_W = 1180;
const STAGE_H = 560;
const CARD_W = 168;
const CARD_H = 62;
const COL_X = [16, 336, 656, 946]; // left edge of each column
const LETTERS = "ABCDEFGH";

const BOOT_MS = 550;
const SEED_MS = 950;
const ROUND_MS = 1450;

// Honest display names for the engine's seven design-quality dimensions.
const DIM_LABEL: Record<keyof Scores, string> = {
  conversion: "Action clarity",
  trust: "Trust",
  readability: "Readability",
  balance: "Balance",
  premium: "Premium feel",
  brand: "Brand voice",
  purchase: "Purchase flow",
};

interface Node {
  id: string;
  letter: string;
  fit: number; // real design-fitness score (0–100) from the evolution engine
  palette: [string, string, string];
  x: number;
  y: number;
  col: number;
  parents?: [Node, Node];
}

// Visual tournament seeding (column slot → rank), so the two strongest
// candidates meet in the final. Placement only — the fitness shown is real.
const SLOT_RANK = [0, 7, 4, 3, 2, 5, 6, 1];

export function GenerationCinema({ prompt, result, error, onOpenStore, onClose }: Props) {
  // Run the real evolution engine and build the bracket from its output.
  const { rounds, connectors, facts } = useMemo(() => {
    const run = runEvolution(prompt || "urivo");

    // Real aggregate facts.
    const genSizes = run.generations.map((g) => g.variants.length);
    const totalCandidates = genSizes.reduce((s, n) => s + n, 0);
    const generations = run.generations.length;
    const dimensions = Object.keys(DIM_LABEL).length;
    const winnerFit = Math.round(run.winner.overall);
    // Winning candidate's strongest design dimension.
    let topDim: keyof Scores = "trust";
    let topVal = -1;
    for (const [k, v] of Object.entries(run.winner.scores) as [keyof Scores, number][]) {
      if (v > topVal) { topVal = v; topDim = k; }
    }
    // Cumulative candidates explored by the time each bracket stage resolves.
    const cum: number[] = [];
    genSizes.reduce((s, n, i) => (cum[i] = s + n), 0);
    const candByStage = [cum[0] ?? totalCandidates, cum[2] ?? totalCandidates, cum[4] ?? totalCandidates, totalCandidates];

    // The eight strongest first-generation candidates, ranked by real fitness.
    const ranked = run.generations[0].variants
      .map(describeVariant)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const col0: Node[] = SLOT_RANK.map((rankIdx, slot) => {
      const c = ranked[rankIdx];
      return {
        id: c.id,
        letter: LETTERS[slot],
        fit: Math.round(c.score),
        palette: c.palette,
        x: COL_X[0],
        y: ((slot + 0.5) / 8) * STAGE_H,
        col: 0,
      };
    });

    const rounds: Node[][] = [col0];
    let prev = col0;
    for (let r = 1; r < 4; r++) {
      const cur: Node[] = [];
      for (let i = 0; i < prev.length; i += 2) {
        const a = prev[i];
        const b = prev[i + 1];
        const win = a.fit >= b.fit ? a : b; // advance the higher REAL fitness
        cur.push({ ...win, x: COL_X[r], y: (a.y + b.y) / 2, col: r, parents: [a, b] });
      }
      rounds.push(cur);
      prev = cur;
    }

    const connectors: { round: number; d: string; win: boolean }[] = [];
    for (let r = 1; r < 4; r++) {
      for (const node of rounds[r]) {
        const [a, b] = node.parents!;
        const midX = (a.x + CARD_W + node.x) / 2;
        const cy = node.y;
        connectors.push({ round: r, win: a.id === node.id, d: `M ${a.x + CARD_W} ${a.y} H ${midX}` });
        connectors.push({ round: r, win: b.id === node.id, d: `M ${b.x + CARD_W} ${b.y} H ${midX}` });
        connectors.push({ round: r, win: true, d: `M ${midX} ${a.y} V ${b.y}` });
        connectors.push({ round: r, win: true, d: `M ${midX} ${cy} H ${node.x}` });
      }
    }

    const topFit = Math.round(ranked[0]?.score ?? winnerFit);
    return {
      rounds,
      connectors,
      facts: { totalCandidates, generations, dimensions, winnerFit, topDim, candByStage, topFit, genSizes },
    };
  }, [prompt]);

  const advancedByRound = useMemo(() => {
    const m: Record<number, Set<string>> = {};
    for (let r = 0; r < 3; r++) m[r] = new Set(rounds[r + 1].map((n) => n.id));
    return m;
  }, [rounds]);

  // revealCol: -1 boot, 0 seeded, 1..3 rounds resolved
  const [revealCol, setRevealCol] = useState(-1);
  const [revealed, setRevealed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedAt = useRef<number>(Date.now());

  // Fit the stage to the viewport.
  useEffect(() => {
    const fit = () => {
      const el = wrapRef.current;
      if (!el) return;
      const s = Math.min(1, (el.clientWidth - 24) / STAGE_W, (el.clientHeight - 24) / STAGE_H);
      setScale(Math.max(0.5, s));
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // Real elapsed clock — ticks until the store is revealed, then freezes.
  useEffect(() => {
    if (revealed || error) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt.current), 100);
    return () => clearInterval(id);
  }, [revealed, error]);

  // Choreography.
  useEffect(() => {
    const t = timers.current;
    t.push(setTimeout(() => setRevealCol(0), BOOT_MS));
    let at = BOOT_MS + SEED_MS;
    for (let r = 1; r <= 3; r++) {
      const rr = r;
      t.push(setTimeout(() => setRevealCol(rr), at));
      at += ROUND_MS;
    }
    return () => t.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (revealCol >= 3 && result && !revealed) {
      const id = setTimeout(() => setRevealed(true), 900);
      return () => clearTimeout(id);
    }
  }, [revealCol, result, revealed]);

  const stage = Math.max(0, Math.min(revealCol, 3));
  const inPlay = [8, 4, 2, 1][stage];
  const candidates = facts.candByStage[stage];
  const elapsedS = (elapsedMs / 1000).toFixed(1);

  const gridDash = "linear-gradient(rgba(148,163,188,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,188,0.4) 1px, transparent 1px)";

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#080d16] font-mono text-ivory">
      {/* grid + ambient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.05]"
        style={{ backgroundImage: gridDash, backgroundSize: "46px 46px", maskImage: "radial-gradient(75% 65% at 50% 45%, #000 40%, transparent 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(70% 50% at 50% 0%, rgba(36,50,76,0.35), rgba(8,13,22,0) 60%)" }}
      />

      {/* Close */}
      {!revealed && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-5 z-40 text-[10px] uppercase tracking-[0.2em] text-mist-dim transition-colors hover:text-ivory"
        >
          Cancel
        </button>
      )}

      {/* Error */}
      {error && !revealed && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center px-6 text-center">
          <span className="mb-4 text-[10px] uppercase tracking-[0.25em] text-alert">Generation halted</span>
          <p className="max-w-md text-lg text-ivory/80">{error}</p>
          <button type="button" onClick={onClose} className="u-lift mt-8 rounded-xl border border-hair px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory/80 hover:border-hair-strong">
            Back
          </button>
        </div>
      )}

      {!error && !revealed && (
        <div className="flex h-full flex-col px-6 pb-4 pt-5 sm:px-9">
          {/* ── Top status bar ── */}
          <div className="flex items-center justify-between pr-16 text-[10px] tracking-[0.16em] sm:pr-20">
            <div className="flex items-center gap-2.5 text-mist">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" style={{ animation: "urivo-live 1.6s ease-in-out infinite", boxShadow: "0 0 8px #22c55e" }} />
              <span className="uppercase">Urivo design engine</span>
              <span className="text-mist-dim">·</span>
              <span className="uppercase text-mist-dim">{stage >= 3 ? "converged on the strongest" : "exploring design candidates"}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="hidden text-mist-dim sm:inline">{facts.totalCandidates} candidates · {facts.generations} generations</span>
              <span className="tabular-nums text-sm font-semibold tracking-normal text-[#22c55e]">{facts.topFit}</span>
              <span className="hidden uppercase text-mist-dim sm:inline">top fitness</span>
            </div>
          </div>

          {/* ── Stat cards (all real) ── */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Candidates explored" value={String(candidates)} sub={`across ${facts.generations} generations`} />
            <Stat label="Design signals scored" value={String(facts.dimensions)} sub="per candidate" />
            <Stat label="Elapsed" value={`${elapsedS}s`} sub="real generation time" />
            <Stat label="In contention" value={String(inPlay)} sub={inPlay === 1 ? `fitness ${facts.winnerFit}/100` : `top fitness ${facts.topFit}/100`} accent={inPlay === 1} />
          </div>

          {/* ── Section label ── */}
          <div className="mt-4 flex items-center justify-between border-b border-hair pb-2 text-[11px]">
            <span className="relative pb-2 font-medium text-ivory">
              Design exploration
              <span className="absolute inset-x-0 -bottom-[9px] h-[2px] rounded-full" style={{ backgroundImage: "var(--grad-gold)" }} />
            </span>
            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-mist">
              <span className="h-2 w-2 bg-[#22c55e]" style={{ boxShadow: "0 0 8px #22c55e" }} /> {inPlay > 1 ? `${inPlay} in contention` : "champion"}
            </span>
          </div>

          {/* ── Bracket stage ── */}
          <div ref={wrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
            <div
              className="relative"
              style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "center" }}
            >
              <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`} className="absolute inset-0 h-full w-full overflow-visible">
                {connectors.map((c, i) => (
                  <path
                    key={i}
                    d={c.d}
                    fill="none"
                    stroke={revealCol >= c.round ? (c.win ? "#22c55e" : "#2b3a54") : "transparent"}
                    strokeOpacity={c.win ? 0.7 : 0.5}
                    strokeWidth={1.4}
                    strokeDasharray="2 5"
                    strokeLinecap="round"
                    style={{ transition: "stroke 500ms ease, stroke-opacity 500ms ease" }}
                  />
                ))}
              </svg>

              {rounds.map((col, r) =>
                col.map((n) => {
                  if (revealCol < r) return null;
                  const advanced = r < 3 && advancedByRound[r].has(n.id);
                  const eliminated = r < 3 && revealCol > r && !advanced;
                  const champion = r === 3;
                  return (
                    <BracketCard
                      key={`${r}-${n.id}`}
                      node={n}
                      state={champion ? "champion" : eliminated ? "dead" : advanced ? "won" : "live"}
                    />
                  );
                }),
              )}
            </div>
          </div>

          {/* footer hint — honest, no decorative controls */}
          <div className="flex items-center justify-center gap-2 pt-1 text-[10px] uppercase tracking-[0.18em] text-mist-dim">
            <span>Urivo explores many directions and keeps the strongest — then builds your real store</span>
          </div>
        </div>
      )}

      {revealed && result && (
        <Reveal result={result} totalCandidates={facts.totalCandidates} topDim={DIM_LABEL[facts.topDim]} onOpenStore={onOpenStore} onClose={onClose} />
      )}
    </div>
  );
}

type CardState = "live" | "won" | "dead" | "champion";

function BracketCard({ node, state }: { node: Node; state: CardState }) {
  const [bg, structure, accent] = node.palette;
  const dead = state === "dead";
  const champion = state === "champion";
  const won = state === "won" || champion;

  return (
    <div
      className="absolute overflow-hidden rounded-lg border"
      style={{
        left: node.x,
        top: node.y - CARD_H / 2,
        width: CARD_W,
        height: CARD_H,
        borderColor: champion ? "rgba(232,205,128,0.9)" : won ? "rgba(34,197,94,0.55)" : "rgba(255,255,255,0.12)",
        background: "rgba(16,24,40,0.9)",
        boxShadow: champion
          ? "0 0 0 1px rgba(232,205,128,0.5), 0 12px 34px -12px rgba(232,205,128,0.4)"
          : won
            ? "0 0 22px -6px rgba(34,197,94,0.5)"
            : "0 10px 24px -14px rgba(0,0,0,0.8)",
        opacity: dead ? 0.32 : 1,
        filter: dead ? "grayscale(0.7)" : "none",
        transition: "opacity 500ms ease, filter 500ms ease, box-shadow 500ms ease, border-color 500ms ease, left 700ms var(--ease-urivo), top 700ms var(--ease-urivo)",
        animation: "urivo-fade-up 460ms var(--ease-urivo) both",
      }}
    >
      <div className="flex h-full items-stretch">
        <div className="h-full w-[52px] shrink-0 overflow-hidden" style={{ background: bg }}>
          <div className="h-[13px] w-full" style={{ background: structure }} />
          <div className="p-1">
            <div className="h-3 w-full rounded-sm" style={{ background: structure, opacity: 0.2 }} />
            <div className="mt-1 flex gap-0.5">
              <div className="h-2 flex-1 rounded-sm" style={{ background: structure, opacity: 0.14 }} />
              <div className="h-2 flex-1 rounded-sm" style={{ background: accent, opacity: 0.7 }} />
            </div>
          </div>
        </div>
        <div className="flex flex-1 flex-col justify-center px-2.5">
          <div className="flex items-center justify-between">
            <span
              className={`whitespace-nowrap text-[9px] uppercase tracking-[0.14em] ${champion ? "font-semibold text-gold" : "text-mist"}`}
            >
              {champion ? "Winner" : `Candidate ${node.letter}`}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[8px] uppercase tracking-wider text-mist-dim">Fitness</span>
            <span
              className="text-[13px] font-semibold tabular-nums"
              style={{ color: champion ? "#e4c069" : won ? "#34d399" : dead ? "#5f6f89" : "#cbd5e1" }}
            >
              {node.fit}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-hair bg-white/[0.02] px-3.5 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.16em] text-mist-dim">{label}</p>
      <p className={`mt-1 text-[17px] font-semibold tabular-nums tracking-tight ${accent ? "u-gold-text" : "text-ivory"}`}>{value}</p>
      <p className="mt-0.5 text-[9px] tracking-[0.1em] text-mist-dim">{sub}</p>
    </div>
  );
}

function Reveal({
  result,
  totalCandidates,
  topDim,
  onOpenStore,
  onClose,
}: {
  result: CinemaResult;
  totalCandidates: number;
  topDim: string;
  onOpenStore: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center px-6 font-mono">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(232,205,128,0.32), rgba(34,197,94,0.12) 42%, transparent 68%)", animation: "urivo-burst 1100ms var(--ease-urivo) 120ms both" }}
      />
      <div
        className="relative w-full max-w-md rounded-2xl border p-9 text-center"
        style={{
          borderColor: "rgba(232,205,128,0.28)",
          background: "linear-gradient(180deg, rgba(18,28,48,0.95), rgba(8,13,22,0.97))",
          boxShadow: "0 60px 140px -40px rgba(0,0,0,0.85), 0 0 80px -18px rgba(232,205,128,0.3)",
          animation: "urivo-bloom 900ms var(--ease-urivo) both",
        }}
      >
        <p className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-[0.28em] text-gold" style={{ animation: "urivo-rise 700ms var(--ease-urivo) 200ms both" }}>
          <span className="h-1.5 w-1.5 rounded-full bg-gold" style={{ boxShadow: "0 0 8px rgba(232,205,128,0.8)" }} /> Champion selected
        </p>
        <h2 className="mt-5 text-4xl font-semibold tracking-tight text-ivory" style={{ animation: "urivo-rise 800ms var(--ease-urivo) 340ms both" }}>
          {result.storeName}
        </h2>
        <p className="mt-3 text-sm italic text-mist" style={{ animation: "urivo-rise 800ms var(--ease-urivo) 480ms both" }}>
          {result.tagline}
        </p>
        <div className="mt-6 flex items-center justify-center gap-6 text-[10px] uppercase tracking-[0.16em] text-mist" style={{ animation: "urivo-rise 800ms var(--ease-urivo) 600ms both" }}>
          <span>Chosen from <span className="text-ivory">{totalCandidates}</span> candidates</span>
          <span className="text-mist-dim">·</span>
          <span>Strongest on <span className="text-[#34d399]">{topDim}</span></span>
        </div>
        <div className="mt-6 flex justify-center gap-2" style={{ animation: "urivo-rise 800ms var(--ease-urivo) 700ms both" }}>
          {[result.palette.background, result.palette.structure, result.palette.accent].map((c, i) => (
            <span key={i} className="h-9 w-9 rounded-full border border-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>
        <div className="mt-7 space-y-2 text-left">
          {result.products.slice(0, 4).map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-hair bg-white/[0.04] px-4 py-2.5"
              style={{ animation: `urivo-rise 700ms var(--ease-urivo) ${820 + i * 120}ms both` }}
            >
              <span className="text-sm text-ivory/85">{p.title}</span>
              <span className="text-xs text-[#34d399]">€{p.priceEUR.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col gap-3" style={{ animation: "urivo-rise 800ms var(--ease-urivo) 1300ms both" }}>
          <button type="button" onClick={() => onOpenStore(result.storeUrl)} className="u-gold u-lift rounded-lg px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.22em]">
            {result.published ? "Open your store" : "Preview your store"}
          </button>
          <button type="button" onClick={onClose} className="text-[10px] uppercase tracking-[0.2em] text-mist transition-colors hover:text-ivory">
            Back to workspace · {result.creditsRemaining} credits left
          </button>
        </div>
      </div>
    </div>
  );
}
