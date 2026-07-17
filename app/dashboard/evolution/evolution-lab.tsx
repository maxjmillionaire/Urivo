"use client";

import { useMemo, useRef, useState } from "react";
import { runEvolution, GEN_SIZES, type EvolutionRun } from "@/lib/evolution/engine";

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

export function EvolutionLab() {
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
          className="flex-1 rounded-lg border border-ivory-100/15 bg-ivory-100/5 px-4 py-3 text-sm font-light text-ivory-100 placeholder:text-ivory-100/30 focus:border-gold-500 focus:outline-none disabled:opacity-60"
          placeholder="Describe a business to evolve"
        />
        <button
          type="button"
          onClick={start}
          disabled={phase === "running"}
          className="rounded-lg bg-gold-500 px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-forest-900 transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-champagne disabled:translate-y-0 disabled:opacity-60"
        >
          {phase === "running" ? "Evolving…" : phase === "done" ? "Run again" : "Start evolution"}
        </button>
      </div>

      {/* Live readout */}
      {activeGen && (
        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-gold-500">
              Generation {activeGen.index}
            </span>
            <p className="mt-1 text-sm font-light text-ivory-100/70">{activeGen.commentary}</p>
          </div>
          <div className="text-right">
            <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ivory-100/40">
              Best fitness
            </span>
            <p className="font-serif text-4xl font-light text-gold-300 tabular-nums">
              {activeGen.best.overall.toFixed(1)}
            </p>
          </div>
        </div>
      )}

      {/* The tree */}
      <div className="relative mt-6 overflow-hidden rounded-2xl border border-ivory-100/10 bg-forest-950">
        {!run && (
          <div className="flex h-[560px] items-center justify-center px-6 text-center">
            <p className="max-w-md font-serif text-2xl font-normal text-ivory-100/60">
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
                    stroke={p.survived ? "#C69B3C" : "#EFEAD8"}
                    strokeOpacity={p.survived ? 0.35 : 0.06}
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
                  ? "#EDE0C2"
                  : p.survived
                    ? "#C69B3C"
                    : "#EFEAD8";
                const opacity = isWinner ? 1 : p.survived ? 0.92 : 0.16;
                return (
                  <circle
                    key={p.id}
                    cx={p.x}
                    cy={p.y}
                    r={isWinner ? p.r + 3 : p.r}
                    fill={fill}
                    fillOpacity={opacity}
                    style={{
                      transition: "r 500ms cubic-bezier(0.16,1,0.3,1), fill-opacity 700ms",
                      filter: isWinner
                        ? "drop-shadow(0 0 14px rgba(198,155,60,0.9))"
                        : p.survived && gi === visibleGen - 1
                          ? "drop-shadow(0 0 6px rgba(198,155,60,0.5))"
                          : "none",
                    }}
                  />
                );
              }),
            )}
          </svg>
        )}

        {/* Winner reveal */}
        {phase === "done" && run && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-6">
            <div className="pointer-events-auto rounded-xl border border-gold-500/30 bg-forest-900/90 px-8 py-5 text-center backdrop-blur">
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-gold-500">
                Winner · fitness {run.winner.overall.toFixed(1)}
              </p>
              <p className="mt-2 font-serif text-2xl font-normal text-ivory-100">
                This becomes your Store v1.0
              </p>
            </div>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs font-light text-ivory-100/40">
        Continuous optimization never stops — Urivo keeps running experiments
        after launch to find better conversions.
      </p>
    </div>
  );
}
