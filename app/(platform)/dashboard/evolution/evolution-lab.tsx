"use client";

import { useMemo, useRef, useState } from "react";
import { runEvolution, GEN_SIZES, type EvolutionRun, type Scores } from "@/lib/evolution/engine";

/** Advanced-tier readout: the winning storefront's seven fitness signals. */
const DIMENSIONS: [keyof Scores, string][] = [
  ["conversion", "Conversion"],
  ["trust", "Trust"],
  ["premium", "Premium feel"],
  ["brand", "Brand fit"],
  ["readability", "Readability"],
  ["balance", "Visual balance"],
  ["purchase", "Purchase clarity"],
];

/*
 * The Evolution Laboratory (spec 6.6). Watch ~100 storefront variants compete,
 * the weak fade, the strong breed mutated children, until one winner remains.
 * Deterministic engine → runs instantly and free, built to be screen-recorded.
 */

const W = 1000;
const H = 560;
const PAD_X = 36;
const PAD_TOP = 44;
const ROW_GAP = (H - PAD_TOP - 40) / (GEN_SIZES.length - 1);

interface Pos {
  x: number;
  y: number;
  r: number;
  overall: number;
  survived: boolean;
  id: string;
  parentId: string | null;
}

function layout(run: EvolutionRun): { positions: Map<string, Pos>; byGen: Pos[][] } {
  const positions = new Map<string, Pos>();
  const byGen: Pos[][] = [];
  run.generations.forEach((gen, gi) => {
    const n = gen.variants.length;
    const row: Pos[] = gen.variants.map((v, i) => {
      const x = PAD_X + ((i + 0.5) / n) * (W - 2 * PAD_X);
      const y = PAD_TOP + gi * ROW_GAP;
      const r = 3 + ((v.overall - 45) / 55) * 7;
      const p: Pos = {
        x,
        y,
        r: Math.max(2.5, Math.min(11, r)),
        overall: v.overall,
        survived: v.survived,
        id: v.id,
        parentId: v.parentId,
      };
      positions.set(v.id, p);
      return p;
    });
    byGen.push(row);
  });
  return { positions, byGen };
}

export function EvolutionLab({ tier = "standard" }: { tier?: "standard" | "advanced" }) {
  const [prompt, setPrompt] = useState("A minimalist Scandinavian home fragrance brand");
  const [run, setRun] = useState<EvolutionRun | null>(null);
  const [visibleGen, setVisibleGen] = useState(0); // how many generation rows revealed
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const laidOut = useMemo(() => (run ? layout(run) : null), [run]);

  function start() {
    if (timer.current) clearInterval(timer.current);
    const r = runEvolution(prompt.trim() || "urivo");
    setRun(r);
    setVisibleGen(1);
    setPhase("running");
    let g = 1;
    timer.current = setInterval(() => {
      g += 1;
      setVisibleGen(g);
      if (g >= GEN_SIZES.length) {
        if (timer.current) clearInterval(timer.current);
        setPhase("done");
      }
    }, 1900);
  }

  const activeGen = run && visibleGen > 0 ? run.generations[visibleGen - 1] : null;

  return (
    <div className="mt-8">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={phase === "running"}
          className="flex-1 rounded-xl border border-hair bg-night px-4 py-3 text-sm text-ivory placeholder:text-mist-dim transition-colors focus:border-gold/50 focus:outline-none focus:ring-1 focus:ring-gold/20 disabled:opacity-60"
          placeholder="Describe a business to evolve"
        />
        <button
          type="button"
          onClick={start}
          disabled={phase === "running"}
          className="u-gold u-lift rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-60"
        >
          {phase === "running" ? "Evolving…" : phase === "done" ? "Run again" : "Start evolution"}
        </button>
      </div>

      {/* Live readout */}
      {activeGen && (
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-mist">
              Generation {activeGen.index}
            </span>
            <p className="mt-1 text-sm text-mist">{activeGen.commentary}</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mist">
              Best fitness
            </span>
            <p className="text-4xl font-semibold tracking-tight u-gold-text tabular-nums">
              {activeGen.best.overall.toFixed(1)}
            </p>
          </div>
        </div>
      )}

      {/* The tree — an intentional dark "stage" (spec 6.6) where glowing nodes live */}
      <div className="u-float relative mt-6 overflow-hidden rounded-2xl border border-hair bg-[#0a1020]">
        {!run && (
          <div className="flex h-[560px] items-center justify-center px-6 text-center">
            <p className="max-w-md text-2xl font-medium leading-snug text-white/70">
              One hundred storefronts enter. Only the strongest survives. Press
              start and watch it evolve.
            </p>
          </div>
        )}

        {run && laidOut && (
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[560px] w-full">
            {/* Lineage lines between revealed generations */}
            {laidOut.byGen.slice(0, visibleGen).map((row) =>
              row.map((p) => {
                if (!p.parentId) return null;
                const parent = laidOut!.positions.get(p.parentId);
                if (!parent) return null;
                return (
                  <line
                    key={`l-${p.id}`}
                    x1={parent.x}
                    y1={parent.y}
                    x2={p.x}
                    y2={p.y}
                    stroke={p.survived ? "#D4AF37" : "#CBD5E1"}
                    strokeOpacity={p.survived ? 0.35 : 0.07}
                    strokeWidth={p.survived ? 1.1 : 0.6}
                  />
                );
              }),
            )}

            {/* Nodes */}
            {laidOut.byGen.slice(0, visibleGen).map((row, gi) =>
              row.map((p) => {
                const isWinner = phase === "done" && gi === GEN_SIZES.length - 1;
                const fill = isWinner
                  ? "#EBD9A0"
                  : p.survived
                    ? "#D4AF37"
                    : "#CBD5E1";
                const opacity = isWinner ? 1 : p.survived ? 0.92 : 0.18;
                return (
                  <circle
                    key={p.id}
                    cx={p.x}
                    cy={p.y}
                    r={isWinner ? p.r + 3 : p.r}
                    fill={fill}
                    fillOpacity={opacity}
                    style={{
                      transition: "r 500ms var(--ease-urivo), fill-opacity 700ms",
                      filter: isWinner
                        ? "drop-shadow(0 0 14px rgba(212,175,55,0.9))"
                        : p.survived && gi === visibleGen - 1
                          ? "drop-shadow(0 0 6px rgba(212,175,55,0.5))"
                          : "none",
                    }}
                  />
                );
              }),
            )}
          </svg>
        )}

        {/* Winner reveal — a dark glass card spotlit on the stage */}
        {phase === "done" && run && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-6">
            <div className="u-glass u-float pointer-events-auto rounded-2xl border border-gold/25 px-8 py-5 text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-gold" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-soft">
                  Winner · fitness {run.winner.overall.toFixed(1)}
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-ivory">
                This becomes your Store v1.0
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Advanced (Elite) — the winning storefront's full fitness breakdown */}
      {tier === "advanced" && phase === "done" && run && (
        <div className="u-float mt-6 rounded-2xl border border-hair bg-panel/70 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mist">
                Advanced Evolution · winner breakdown
              </p>
            </div>
            <p className="text-xs text-mist">7 fitness signals</p>
          </div>
          <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {DIMENSIONS.map(([key, label]) => {
              const v = run.winner.scores[key];
              return (
                <div key={key}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] text-ivory">{label}</span>
                    <span className="text-[13px] font-semibold tabular-nums u-gold-text">{v.toFixed(1)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(0, Math.min(100, v))}%`, backgroundImage: "var(--grad-gold)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-xs text-mist">
        Continuous optimization never stops — Urivo keeps running experiments
        after launch to find better conversions.
      </p>
    </div>
  );
}
