"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runEvolution } from "@/lib/evolution/engine";
import { describeVariant } from "@/lib/evolution/candidates";

/*
 * The Generation Cinema — Urivo's signature creation sequence (spec 6.6).
 *
 * A live A/B tournament bracket: eight storefront variants are seeded on the
 * left, compete pair by pair along dotted bracket connectors, and converge —
 * 8 → 4 → 2 → 1 — into a single champion on the right, which blooms into the
 * real AI-generated store. Bloomberg-terminal chrome (LIVE, CVR uplift, traffic,
 * confidence) wraps the bracket. Hold Q for voice.
 *
 * Deliberate reference-faithful layout (founder exception); Urivo palette —
 * slate-navy canvas, ivory mono type, gold for the champion + brand, green as
 * the CVR / winning signal. The bracket is a deterministic visualization; the
 * reveal is the real generated store.
 */

export interface CinemaResult {
  storeName: string;
  tagline: string;
  storeUrl: string;
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

interface Node {
  id: string;
  letter: string;
  cvr: number;
  palette: [string, string, string];
  x: number;
  y: number;
  col: number;
  parents?: [Node, Node]; // the two children that fed this node
}

function cvrFor(v: number): number {
  return Math.round(v * 10) / 10;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

const UPLIFT = [1.3, 2.0, 2.7, 3.2];
const CONF = [71, 82, 90, 95];
const TRAFFIC = [0.9e6, 1.3e6, 1.5e6, 1.7e6];
const IN_PLAY = [8, 4, 2, 1];

export function GenerationCinema({ prompt, result, error, onOpenStore, onClose }: Props) {
  // Build the bracket deterministically from the prompt.
  const { rounds, connectors } = useMemo(() => {
    const run = runEvolution(prompt || "urivo");
    const ranked = run.generations[0].variants
      .map(describeVariant)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    // Distinct, realistic CVRs by rank (best → worst), placed into standard
    // tournament seeding so the strongest two meet in the final.
    const SPREAD = [6.9, 6.6, 6.4, 6.1, 5.8, 5.5, 5.2, 4.8];
    const SLOT_RANK = [0, 7, 4, 3, 2, 5, 6, 1]; // column slot → rank index

    const col0: Node[] = SLOT_RANK.map((rankIdx, slot) => {
      const c = ranked[rankIdx];
      const jitter = ((c.id.charCodeAt(c.id.length - 1) % 3) - 1) * 0.1;
      return {
        id: c.id,
        letter: LETTERS[slot],
        cvr: cvrFor(SPREAD[rankIdx] + jitter),
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
        const win = a.cvr >= b.cvr ? a : b;
        cur.push({ ...win, x: COL_X[r], y: (a.y + b.y) / 2, col: r, parents: [a, b] });
      }
      rounds.push(cur);
      prev = cur;
    }

    // Bracket connectors (dotted elbows) keyed by the round they belong to.
    const connectors: { round: number; d: string; win: boolean }[] = [];
    for (let r = 1; r < 4; r++) {
      for (const node of rounds[r]) {
        const [a, b] = node.parents!;
        const midX = (a.x + CARD_W + node.x) / 2;
        const cy = node.y;
        // each child → vertical bus → parent
        connectors.push({ round: r, win: a.id === node.id, d: `M ${a.x + CARD_W} ${a.y} H ${midX}` });
        connectors.push({ round: r, win: b.id === node.id, d: `M ${b.x + CARD_W} ${b.y} H ${midX}` });
        connectors.push({ round: r, win: true, d: `M ${midX} ${a.y} V ${b.y}` });
        connectors.push({ round: r, win: true, d: `M ${midX} ${cy} H ${node.x}` });
      }
    }
    return { rounds, connectors };
  }, [prompt]);

  // advanced ids per round (a node that also appears in the next round)
  const advancedByRound = useMemo(() => {
    const m: Record<number, Set<string>> = {};
    for (let r = 0; r < 3; r++) m[r] = new Set(rounds[r + 1].map((n) => n.id));
    return m;
  }, [rounds]);

  // revealCol: -1 boot, 0 seeded, 1..3 rounds resolved
  const [revealCol, setRevealCol] = useState(-1);
  const [revealed, setRevealed] = useState(false);
  const [qHeld, setQHeld] = useState(false);
  const [scale, setScale] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

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

  // Voice — hold Q.
  useEffect(() => {
    if (revealed || error) return;
    const down = (e: KeyboardEvent) => {
      if ((e.key === "q" || e.key === "Q") && !e.repeat) setQHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "q" || e.key === "Q") setQHeld(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [revealed, error]);

  const stage = Math.max(0, Math.min(revealCol, 3));
  const uplift = UPLIFT[stage];
  const conf = CONF[stage];
  const traffic = TRAFFIC[stage];
  const inPlay = IN_PLAY[stage];

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
              <span className="uppercase">Live</span>
              <span className="text-mist-dim">·</span>
              <span className="uppercase text-mist-dim">CVR uplift since testing began</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="hidden text-mist-dim sm:inline">3 tests · 8 variants each</span>
              <span className="hidden items-center gap-3 text-mist-dim sm:flex">
                <span className="inline-flex items-center gap-1"><span className="h-1 w-1 rounded-full bg-mist" /> Regenerate</span>
                <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${qHeld ? "border-gold/50 text-gold" : "border-hair text-mist"}`}>◈ Voice</span>
                <span>▲ Manual</span>
              </span>
              <span className="tabular-nums text-sm font-semibold tracking-normal text-[#22c55e]">+{uplift.toFixed(1)}%</span>
              <span className="hidden uppercase text-mist-dim sm:inline">Conversion</span>
            </div>
          </div>

          {/* ── Stat cards ── */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Time elapsed" value="433d 15h" sub="since first impression" />
            <Stat label="Traffic collected" value={`${fmtCount(traffic)} / 2.7M`} sub={`${Math.round((traffic / 2.7e6) * 100)}% of required sample`} />
            <Stat label="Est. completion" value="in 247d 11h" sub="at 4.0K visitors / day" />
            <Stat label="Variants in play" value={String(inPlay)} sub={`${conf}% confidence`} accent={inPlay === 1} />
          </div>

          {/* ── Tabs ── */}
          <div className="mt-4 flex items-center justify-between border-b border-hair pb-2 text-[11px]">
            <div className="flex items-center gap-4">
              <span className="relative pb-2 font-medium text-ivory">
                Product page
                <span className="absolute inset-x-0 -bottom-[9px] h-[2px] rounded-full" style={{ backgroundImage: "var(--grad-gold)" }} />
              </span>
              <span className="pb-2 text-mist-dim">Add to cart</span>
            </div>
            <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] text-mist">
              <span className="h-2 w-2 bg-[#22c55e]" style={{ boxShadow: "0 0 8px #22c55e" }} /> Running · {inPlay > 1 ? `${inPlay} variants` : "final"}
            </span>
          </div>

          {/* ── Bracket stage ── */}
          <div ref={wrapRef} className="relative flex flex-1 items-center justify-center overflow-hidden">
            <div
              className="relative"
              style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, transformOrigin: "center" }}
            >
              {/* connectors */}
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

              {/* cards */}
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

            {/* Voice overlay */}
            {qHeld && (
              <div className="absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-3">
                <Waveform />
                <span className="text-[10px] uppercase tracking-[0.2em] text-[#22c55e]">
                  ● Listening · release Q to generate
                </span>
              </div>
            )}
          </div>

          {/* footer hint */}
          <div className="flex items-center justify-center gap-5 pt-1 text-[10px] uppercase tracking-[0.18em] text-mist-dim">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-hair px-1.5 py-0.5 text-mist">Q</kbd> Hold to describe
            </span>
            <span className="hidden sm:inline">◈ Regenerate</span>
            <span className="hidden sm:inline">▲ Manual</span>
          </div>
        </div>
      )}

      {revealed && result && <Reveal result={result} onOpenStore={onOpenStore} onClose={onClose} />}
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
        {/* mini store thumbnail */}
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
        {/* label */}
        <div className="flex flex-1 flex-col justify-center px-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-[0.14em] text-mist">Variant {node.letter}</span>
            {champion && <span className="text-[8px] uppercase tracking-wider text-gold">Winner</span>}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[8px] uppercase tracking-wider text-mist-dim">Seed</span>
            <span
              className="text-[13px] font-semibold tabular-nums"
              style={{ color: champion ? "#e4c069" : won ? "#34d399" : dead ? "#5f6f89" : "#cbd5e1" }}
            >
              {node.cvr.toFixed(1)}%
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

function Waveform() {
  const bars = useMemo(() => Array.from({ length: 40 }, (_, i) => (i * 37) % 100), []);
  return (
    <div className="flex h-12 items-center gap-[3px]">
      {bars.map((s, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-ivory/80"
          style={{ height: "100%", transformOrigin: "center", animation: `urivo-wave ${560 + (s % 240)}ms ease-in-out ${(s % 100) * 4}ms infinite` }}
        />
      ))}
    </div>
  );
}

function Reveal({
  result,
  onOpenStore,
  onClose,
}: {
  result: CinemaResult;
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
          <span><span className="text-[#34d399]">+3.2%</span> CVR</span>
          <span className="text-mist-dim">·</span>
          <span><span className="text-ivory">95%</span> confidence</span>
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
            Open your store
          </button>
          <button type="button" onClick={onClose} className="text-[10px] uppercase tracking-[0.2em] text-mist transition-colors hover:text-ivory">
            Back to workspace · {result.creditsRemaining} credits left
          </button>
        </div>
      </div>
    </div>
  );
}
