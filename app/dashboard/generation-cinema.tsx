"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runEvolution } from "@/lib/evolution/engine";
import { describeVariant, type Candidate } from "@/lib/evolution/candidates";

/*
 * The Generation Cinema — Urivo's signature creation sequence (spec 6.6).
 *
 * When a user generates a store, hundreds of possible businesses compete in a
 * 3D field. The weak dissolve into depth, the strong survive and brighten,
 * until — as the real AI result lands — one card blooms into their actual
 * store: real brand, real palette, real products.
 *
 * The competing cards are a deterministic visualization (evolution engine);
 * the final reveal is the real generated store. Pure CSS 3D transforms — no
 * 3D library — so it stays fast and installs nothing. Reduced-motion aware.
 *
 * This is the one intentional dark "stage" moment in an otherwise light app
 * (Design System v2). It uses the deep-brand slate palette with gold accents.
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

// Visible cards per round and the label counts (tied to the engine's cascade).
const KEEP = [28, 16, 9, 5, 3, 1];
const REMAIN_LABEL = [100, 50, 25, 12, 6, 1];
const STAGE_MS = [1200, 2000, 2400, 1800, 1700, 1700, 1600]; // ignite,research,field,c1,c2,c3,finalists

const PHASE_TEXT = [
  "Researching your market",
  "Exploring one hundred directions",
  "Scoring every concept",
  "Refining the survivors",
  "Narrowing to finalists",
  "Selecting the winner",
];

interface PlacedCard extends Candidate {
  rank: number;
  cx: number; // px offset from centre
  cy: number;
  cz: number; // depth
  rot: number; // rotateY deg
  delay: number;
}

// Deterministic scatter so the cloud is stable per prompt.
function place(cands: Candidate[]): PlacedCard[] {
  const ranked = [...cands].sort((a, b) => b.score - a.score).slice(0, KEEP[0]);
  return ranked.map((c, i) => {
    const seed = (i * 2654435761) >>> 0;
    const r1 = ((seed & 0xffff) / 0xffff) * 2 - 1;
    const r2 = (((seed >>> 8) & 0xffff) / 0xffff) * 2 - 1;
    const r3 = (((seed >>> 16) & 0xffff) / 0xffff);
    return {
      ...c,
      rank: i,
      cx: Math.round(r1 * 380),
      cy: Math.round(r2 * 210),
      cz: Math.round(-160 + r3 * 300),
      rot: Math.round(r1 * 16),
      delay: (i % 12) * 55,
    };
  });
}

export function GenerationCinema({ prompt, result, error, onOpenStore, onClose }: Props) {
  const cards = useMemo(() => {
    const run = runEvolution(prompt || "urivo");
    return place(run.generations[0].variants.map(describeVariant));
  }, [prompt]);

  // round: -2 ignite, -1 research, 0..5 selection rounds
  const [round, setRound] = useState(-2);
  const [revealed, setRevealed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Choreography timeline.
  useEffect(() => {
    const seq: { at: number; to: number }[] = [];
    let t = 0;
    t += STAGE_MS[0]; seq.push({ at: t, to: -1 }); // research
    t += STAGE_MS[1]; seq.push({ at: t, to: 0 }); // field
    t += STAGE_MS[2]; seq.push({ at: t, to: 1 });
    t += STAGE_MS[3]; seq.push({ at: t, to: 2 });
    t += STAGE_MS[4]; seq.push({ at: t, to: 3 });
    t += STAGE_MS[5]; seq.push({ at: t, to: 4 }); // finalists
    for (const s of seq) timers.current.push(setTimeout(() => setRound(s.to), s.at));
    return () => timers.current.forEach(clearTimeout);
  }, []);

  // The reveal is earned: only once we've reached finalists AND the real store
  // has landed. Then everything dissolves and the winner blooms.
  useEffect(() => {
    if (round >= 4 && result && !revealed) {
      const id = setTimeout(() => setRevealed(true), 700);
      return () => clearTimeout(id);
    }
  }, [round, result, revealed]);

  const remaining = round < 0 ? REMAIN_LABEL[0] : REMAIN_LABEL[Math.min(round, 5)];
  const keep = round < 0 ? KEEP[0] : KEEP[Math.min(round, 5)];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-[#0b1220] text-white" style={{ perspective: "1400px" }}>
      {/* Ambient volumetric glow */}
      <div
        aria-hidden
        className="urivo-anim-ambient pointer-events-none absolute left-1/2 top-1/2 h-[120vmax] w-[120vmax] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(212,175,55,0.16) 0%, rgba(212,175,55,0.05) 30%, rgba(11,18,32,0) 62%)",
          animation: "urivo-ambient 7s ease-in-out infinite",
        }}
      />
      {/* Drifting motes */}
      <Motes />

      {/* Close */}
      {!revealed && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 z-30 text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40 transition-colors hover:text-white"
        >
          Cancel
        </button>
      )}

      {/* Error */}
      {error && !revealed && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center px-6 text-center">
          <p className="max-w-md text-lg text-white/80">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-8 rounded-md border border-white/15 px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/80 transition-colors hover:border-white/30"
          >
            Back
          </button>
        </div>
      )}

      {/* The 3D field */}
      {!error && !revealed && (
        <>
          {/* Center mark + research rings */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            {round <= -1 &&
              [0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gold/30"
                  style={{ animation: `urivo-ring 3.2s cubic-bezier(0.16,1,0.3,1) ${i * 1}s infinite` }}
                />
              ))}
            <div
              className="urivo-anim-ignite relative flex h-20 w-20 items-center justify-center rounded-2xl"
              style={{
                animation: "urivo-ignite 1200ms cubic-bezier(0.16,1,0.3,1) both",
              }}
            >
              <span
                aria-hidden
                className="absolute inset-0 rounded-2xl"
                style={{
                  background: "radial-gradient(circle, rgba(212,175,55,0.5), rgba(212,175,55,0) 70%)",
                  animation: "urivo-halo 2.4s ease-in-out infinite",
                }}
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.png" alt="Urivo" width={64} height={64} className="relative rounded-xl" />
            </div>
          </div>

          {/* Candidate cloud */}
          <div
            className="absolute left-1/2 top-1/2 z-20"
            style={{
              transformStyle: "preserve-3d",
              transform: `translate(-50%,-50%) scale(${1 + Math.max(0, round) * 0.05})`,
              transition: "transform 1600ms cubic-bezier(0.16,1,0.3,1)",
              opacity: round >= 0 ? 1 : 0,
            }}
          >
            {cards.map((c) => {
              const alive = c.rank < keep;
              const justAdvanced = alive && round >= 1;
              return (
                <div
                  key={c.id}
                  className="absolute"
                  style={{
                    left: 0,
                    top: 0,
                    // @ts-expect-error custom props
                    "--cx": `${c.cx}px`,
                    "--cy": `${c.cy}px`,
                    "--cz": `${c.cz}px`,
                    "--cr": `${c.rot}deg`,
                    transform: `translate3d(${c.cx}px, ${c.cy}px, ${c.cz}px) rotateY(${c.rot}deg)`,
                    animation: alive
                      ? `urivo-card-in 1100ms cubic-bezier(0.16,1,0.3,1) ${c.delay}ms both`
                      : `urivo-card-out 1300ms cubic-bezier(0.16,1,0.3,1) both`,
                    zIndex: 1000 + c.cz,
                  }}
                >
                  <CardFace candidate={c} advanced={justAdvanced} />
                </div>
              );
            })}
          </div>

          {/* Status readout */}
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-3 pb-14 text-center">
            <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold">
              {round < 0 ? "Claude Opus is building" : `${remaining} of 100 remain`}
            </span>
            <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {PHASE_TEXT[Math.max(0, Math.min(round, 5))]}
            </h2>
            <div className="mt-2 h-px w-64 overflow-hidden bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-transparent via-gold to-transparent"
                style={{ width: "40%", animation: "urivo-shimmer 2.2s cubic-bezier(0.16,1,0.3,1) infinite" }}
              />
            </div>
          </div>
        </>
      )}

      {/* The reveal — real store blooms into place */}
      {revealed && result && <Reveal result={result} onOpenStore={onOpenStore} onClose={onClose} />}
    </div>
  );
}

function CardFace({ candidate, advanced }: { candidate: PlacedCard; advanced: boolean }) {
  return (
    <div
      className="w-[150px] rounded-xl border p-3.5 backdrop-blur-md"
      style={{
        background: "rgba(255,255,255,0.06)",
        borderColor: advanced ? "rgba(212,175,55,0.4)" : "rgba(255,255,255,0.12)",
        boxShadow: advanced
          ? "0 22px 55px -22px rgba(0,0,0,0.75)"
          : "0 18px 44px -26px rgba(0,0,0,0.7)",
        animation: advanced ? "urivo-survive 2.4s ease-in-out infinite" : undefined,
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-white">{candidate.name}</span>
        <span className="text-[9px] font-semibold tabular-nums text-gold-soft">
          {candidate.score.toFixed(0)}
        </span>
      </div>
      <p className="mt-1 truncate text-[9px] text-white/50">{candidate.tagline}</p>
      <div className="mt-3 flex gap-1">
        {candidate.palette.map((p, i) => (
          <span key={i} className="h-2.5 flex-1 rounded-full" style={{ backgroundColor: p }} />
        ))}
      </div>
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
    <div className="absolute inset-0 z-40 flex items-center justify-center px-6">
      <div
        className="w-full max-w-md rounded-3xl border border-gold/25 p-10 text-center"
        style={{
          background: "linear-gradient(180deg, rgba(31,41,59,0.92), rgba(11,18,32,0.96))",
          boxShadow: "0 60px 140px -40px rgba(0,0,0,0.8), 0 0 60px -20px rgba(212,175,55,0.35)",
          animation: "urivo-bloom 900ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold"
          style={{ animation: "urivo-rise 700ms cubic-bezier(0.16,1,0.3,1) 200ms both" }}
        >
          Your winner
        </p>
        <h2
          className="mt-5 text-5xl font-semibold tracking-tight text-white"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 350ms both" }}
        >
          {result.storeName}
        </h2>
        <p
          className="mt-3 text-sm italic text-white/60"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 500ms both" }}
        >
          {result.tagline}
        </p>

        {/* Palette flowing in */}
        <div
          className="mt-8 flex justify-center gap-2"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 650ms both" }}
        >
          {[result.palette.background, result.palette.structure, result.palette.accent].map((c, i) => (
            <span
              key={i}
              className="h-9 w-9 rounded-full border border-white/10"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        {/* Products materializing */}
        <div className="mt-8 space-y-2 text-left">
          {result.products.slice(0, 4).map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5"
              style={{ animation: `urivo-rise 700ms cubic-bezier(0.16,1,0.3,1) ${800 + i * 120}ms both` }}
            >
              <span className="text-sm text-white/85">{p.title}</span>
              <span className="font-mono text-xs text-gold-soft">€{p.priceEUR.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div
          className="mt-9 flex flex-col gap-3"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 1300ms both" }}
        >
          <button
            type="button"
            onClick={() => onOpenStore(result.storeUrl)}
            className="rounded-md bg-gold px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-brand transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-gold-soft"
          >
            Open your store
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50 transition-colors hover:text-white"
          >
            Back to workspace · {result.creditsRemaining} credits left
          </button>
        </div>
      </div>
    </div>
  );
}

function Motes() {
  const motes = useMemo(
    () =>
      Array.from({ length: 22 }, (_, i) => {
        const s = (i * 40503) % 1000;
        return {
          left: (s % 100) + "%",
          top: ((s * 7) % 100) + "%",
          size: 2 + (s % 4),
          dur: 9 + (s % 8),
          delay: (s % 6),
          mx: ((s % 60) - 30) + "px",
          my: -(40 + (s % 80)) + "px",
          op: 0.25 + ((s % 40) / 100),
        };
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      {motes.map((m, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-gold-soft"
          style={{
            left: m.left,
            top: m.top,
            width: m.size,
            height: m.size,
            // @ts-expect-error custom props
            "--mote-x": m.mx,
            "--mote-y": m.my,
            "--mote-opacity": m.op,
            filter: "blur(0.5px)",
            animation: `urivo-mote ${m.dur}s linear ${m.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
