"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { runEvolution } from "@/lib/evolution/engine";
import { describeVariant, type Candidate } from "@/lib/evolution/candidates";

/*
 * The Generation Cinema — Urivo's signature creation sequence (spec 6.6),
 * rebuilt to keynote level: the Optimization Arena.
 *
 * When a user generates a store, a field of competing storefronts is forged and
 * then judged by a lightning sweep. Losing variants strike RED and dissolve;
 * surviving variants strike GREEN and advance in 3D. Round by round the field
 * halves — 16 → 8 → 4 → 2 → 1 — until a single green champion remains, which
 * blooms into the real AI-generated store (real brand, palette, products).
 *
 * The competing variants are a deterministic visualization (evolution engine);
 * the final reveal is the real generated store. Pure CSS 3D transforms — no 3D
 * library — so it stays fast. Reduced-motion aware.
 *
 * This is the one intentional dark "stage" in an otherwise light app: a
 * Bloomberg-terminal / A/B-arena aesthetic (deep slate, mono type, green = win,
 * red = eliminated, gold reserved for the Urivo mark).
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

const KEEP = [16, 8, 4, 2, 1] as const; // variants alive at round 0..4
const ROUNDS = KEEP.length - 1; // 4 elimination rounds
const ROUND_MS = 1650;
const SEED_MS = 1400;
const BOOT_MS = 700;

const PHASE_TEXT = [
  "Generating the field",
  "Scoring every variant",
  "Eliminating the weak",
  "Refining the finalists",
  "Selecting the champion",
];

const CVR_UPLIFT = [0.4, 1.1, 1.9, 2.6, 3.2];
const CONFIDENCE = [46, 63, 78, 89, 95];
const VISITORS = [120_000, 430_000, 820_000, 1_240_000, 1_700_000];

interface Placed extends Candidate {
  rank: number;
  cvr: number;
}

interface Slot {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
}

// Deterministic layout for a field of `count` cards, centred on the origin.
// As the field shrinks the survivors gather toward centre and advance forward.
function layoutFor(count: number): Slot[] {
  const cfg: Record<number, { cols: number; cw: number; ch: number; z0: number; z1: number; scale: number }> = {
    16: { cols: 4, cw: 236, ch: 144, z0: -320, z1: -60, scale: 0.8 },
    8: { cols: 4, cw: 244, ch: 162, z0: -170, z1: -20, scale: 0.94 },
    4: { cols: 4, cw: 250, ch: 0, z0: -30, z1: -30, scale: 1.04 },
    2: { cols: 2, cw: 330, ch: 0, z0: 70, z1: 70, scale: 1.16 },
    1: { cols: 1, cw: 0, ch: 0, z0: 150, z1: 150, scale: 1.34 },
  };
  const c = cfg[count] ?? cfg[16];
  const rows = Math.ceil(count / c.cols);
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    const col = i % c.cols;
    const row = Math.floor(i / c.cols);
    const colsInRow = Math.min(c.cols, count - row * c.cols);
    const cx = (col - (colsInRow - 1) / 2) * c.cw;
    const cy = rows > 1 ? (row - (rows - 1) / 2) * c.ch : 0;
    const seed = (i * 2654435761) >>> 0;
    const jx = (((seed & 0xff) / 255) - 0.5) * 26;
    const jy = (((seed >>> 8 & 0xff) / 255) - 0.5) * 20;
    const z = rows > 1 ? c.z0 + (row / Math.max(1, rows - 1)) * (c.z1 - c.z0) : c.z0;
    const rot = ((seed >>> 16 & 0xff) / 255 - 0.5) * 14;
    slots.push({ x: Math.round(cx + jx), y: Math.round(cy + jy), z: Math.round(z), scale: c.scale, rot: Math.round(rot) });
  }
  return slots;
}

function cvrFor(score: number): number {
  const v = 4.3 + ((Math.max(45, Math.min(100, score)) - 45) / 55) * 3.3;
  return Math.round(v * 10) / 10;
}

function fmtCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

const LETTERS = "ABCDEFGHIJKLMNOP";

export function GenerationCinema({ prompt, result, error, onOpenStore, onClose }: Props) {
  // Deterministic field of 16 finalists, ranked by fitness.
  const cards = useMemo<Placed[]>(() => {
    const run = runEvolution(prompt || "urivo");
    const ranked = run.generations[0].variants
      .map(describeVariant)
      .sort((a, b) => b.score - a.score)
      .slice(0, KEEP[0]);
    return ranked.map((c, i) => ({ ...c, rank: i, cvr: cvrFor(c.score) }));
  }, [prompt]);

  const slots = useMemo(() => KEEP.map((n) => layoutFor(n)), []);

  // round: -1 boot, 0 seeded field, 1..4 elimination rounds complete
  const [round, setRound] = useState(-1);
  const [revealed, setRevealed] = useState(false);
  const [qHeld, setQHeld] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Choreography.
  useEffect(() => {
    const t = timers.current;
    t.push(setTimeout(() => setRound(0), BOOT_MS));
    let at = BOOT_MS + SEED_MS;
    for (let r = 1; r <= ROUNDS; r++) {
      const rr = r;
      t.push(setTimeout(() => setRound(rr), at));
      at += ROUND_MS;
    }
    return () => t.forEach(clearTimeout);
  }, []);

  // The reveal is earned: the final round has run AND the real store has landed.
  useEffect(() => {
    if (round >= ROUNDS && result && !revealed) {
      const id = setTimeout(() => setRevealed(true), 800);
      return () => clearTimeout(id);
    }
  }, [round, result, revealed]);

  // Voice affordance — hold Q to "describe" (visual language from the keynote).
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

  const stage = Math.max(0, Math.min(round, ROUNDS));
  const inPlay = KEEP[stage];
  const uplift = CVR_UPLIFT[stage];
  const confidence = CONFIDENCE[stage];
  const visitors = VISITORS[stage];
  const progress = round < 0 ? 0 : (stage / ROUNDS) * 100;

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-[#080d16] font-mono text-white"
      style={{ perspective: "1500px" }}
    >
      {/* Ambient + grid + scanline */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 8%, rgba(34,197,94,0.10), rgba(8,13,22,0) 55%), radial-gradient(90% 70% at 50% 120%, rgba(30,41,59,0.6), rgba(8,13,22,0) 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(148,163,184,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 60% at 50% 45%, #000 40%, transparent 100%)",
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-x-0 h-24 opacity-[0.05]"
          style={{ background: "linear-gradient(#fff, transparent)", animation: "urivo-scan 7s linear infinite" }}
        />
      </div>
      <Motes />

      {/* ── Top status bar ─────────────────────────────────────────── */}
      {!revealed && !error && (
        <div className="absolute inset-x-0 top-0 z-30 px-6 pt-5 sm:px-10">
          <div className="flex items-center justify-between pr-16 text-[10px] tracking-[0.2em] sm:pr-24">
            <div className="flex items-center gap-2.5 text-white/60">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#22c55e]"
                style={{ animation: "urivo-live 1.6s ease-in-out infinite", boxShadow: "0 0 8px #22c55e" }}
              />
              <span className="uppercase">Live</span>
              <span className="text-white/25">·</span>
              <span className="uppercase text-white/40">Urivo Optimization Engine</span>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="uppercase text-white/40">Projected CVR uplift</span>
              <span className="tabular-nums text-sm font-semibold tracking-normal text-[#22c55e]">
                +{uplift.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Stat cards */}
          <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
            <Stat label="Simulated visitors" value={fmtCount(visitors)} sub="/ 2.7M sample" />
            <Stat label="Confidence" value={`${confidence}%`} sub="95% target" accent={confidence >= 95} />
            <Stat label="Variants in play" value={String(inPlay)} sub={`of ${KEEP[0]} finalists`} />
          </div>

          {/* Running bar */}
          <div className="mt-4 flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-white/40">
            <span className="h-2 w-2 shrink-0 bg-[#22c55e]" style={{ boxShadow: "0 0 8px #22c55e" }} />
            <span className="shrink-0">Running · {PHASE_TEXT[stage]}</span>
            <span className="h-px flex-1 overflow-hidden bg-white/10">
              <span
                className="block h-full bg-gradient-to-r from-[#22c55e]/40 to-[#22c55e]"
                style={{ width: `${progress}%`, transition: "width 900ms cubic-bezier(0.16,1,0.3,1)" }}
              />
            </span>
            <span className="hidden shrink-0 tabular-nums sm:inline">{fmtCount(visitors)} / 2.7M</span>
          </div>
        </div>
      )}

      {/* Close */}
      {!revealed && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-5 z-40 text-[10px] uppercase tracking-[0.2em] text-white/30 transition-colors hover:text-white sm:right-10"
        >
          Cancel
        </button>
      )}

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && !revealed && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center px-6 text-center">
          <span className="mb-4 text-[10px] uppercase tracking-[0.25em] text-[#f87171]">Generation halted</span>
          <p className="max-w-md text-lg text-white/80">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-8 rounded-md border border-white/15 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/80 transition-colors hover:border-white/30"
          >
            Back
          </button>
        </div>
      )}

      {/* ── The arena ──────────────────────────────────────────────── */}
      {!error && !revealed && (
        <>
          <div
            className="absolute left-1/2 top-1/2 z-20"
            style={{ transformStyle: "preserve-3d", transform: "translate(-50%,-50%)" }}
          >
            {cards.map((c) => {
              const aliveNow = c.rank < KEEP[stage];
              const diedThisRound =
                round > 0 && c.rank >= KEEP[stage] && c.rank < KEEP[Math.max(0, stage - 1)];
              const deadBefore = round > 0 && c.rank >= KEEP[Math.max(0, stage - 1)] && !aliveNow && !diedThisRound;
              if (deadBefore) return null;

              const slot = aliveNow ? slots[stage][c.rank] : slots[Math.max(0, stage - 1)][c.rank];
              const state: CardState =
                round < 0
                  ? "enter"
                  : diedThisRound
                    ? "dying"
                    : stage === ROUNDS && c.rank === 0
                      ? "champion"
                      : round === 0
                        ? "seed"
                        : "win";

              return (
                <ArenaCard
                  key={c.id}
                  card={c}
                  slot={slot}
                  state={state}
                  roundKey={round}
                />
              );
            })}
          </div>

          {/* Lightning beam — replays each round via keyed remount */}
          {round >= 1 && round <= ROUNDS && (
            <div key={round} aria-hidden className="pointer-events-none absolute inset-0 z-[25] overflow-hidden">
              <div
                className="absolute top-0 h-full w-[3px]"
                style={{
                  left: 0,
                  background: "linear-gradient(180deg, transparent, rgba(255,255,255,0.95), rgba(34,197,94,0.6), transparent)",
                  boxShadow: "0 0 24px 6px rgba(255,255,255,0.55), 0 0 60px 18px rgba(34,197,94,0.35)",
                  animation: "urivo-beam 720ms cubic-bezier(0.4,0,0.2,1) both",
                }}
              />
            </div>
          )}

          {/* Voice affordance */}
          <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col items-center gap-4 pb-9 text-center">
            {qHeld ? (
              <div className="flex flex-col items-center gap-3">
                <Waveform />
                <span className="text-[10px] uppercase tracking-[0.22em] text-[#22c55e]">
                  ● Listening · release Q to generate
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-5 text-[10px] uppercase tracking-[0.2em] text-white/30">
                <span className="flex items-center gap-1.5">
                  <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-white/50">Q</kbd> Hold to describe
                </span>
                <span className="hidden sm:inline">◈ Regenerate</span>
                <span className="hidden sm:inline">▲ Manual</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Reveal ─────────────────────────────────────────────────── */}
      {revealed && result && <Reveal result={result} onOpenStore={onOpenStore} onClose={onClose} />}
    </div>
  );
}

type CardState = "enter" | "seed" | "win" | "dying" | "champion";

function ArenaCard({
  card,
  slot,
  state,
  roundKey,
}: {
  card: Placed;
  slot: Slot;
  state: CardState;
  roundKey: number;
}) {
  const [bg, structure, accent] = card.palette;
  const dying = state === "dying";
  const champion = state === "champion";
  const preEnter = state === "enter";

  // Pre-entrance: parked in depth and hidden, so the flip to the slot transform
  // animates the whole field flying in from the dark. Dying cards fall back.
  const transform = preEnter
    ? `translate3d(${Math.round(slot.x * 0.42)}px, ${Math.round(slot.y * 0.42 + 24)}px, -840px) rotateY(${slot.rot}deg) scale(0.55)`
    : dying
      ? `translate3d(${slot.x}px, ${slot.y + 70}px, -520px) rotateY(${slot.rot}deg) scale(${slot.scale * 0.78})`
      : `translate3d(${slot.x}px, ${slot.y}px, ${slot.z}px) rotateY(${slot.rot}deg) scale(${slot.scale})`;

  const glow =
    champion
      ? "urivo-champion 2.4s ease-in-out infinite"
      : state === "win"
        ? "urivo-win 780ms cubic-bezier(0.16,1,0.3,1) both"
        : dying
          ? "urivo-die 900ms cubic-bezier(0.4,0,0.2,1) both"
          : undefined;

  return (
    <div
      className="absolute"
      style={{
        left: 0,
        top: 0,
        transform,
        transformStyle: "preserve-3d",
        transition: "transform 900ms cubic-bezier(0.16,1,0.3,1), opacity 700ms ease-out",
        transitionDelay: preEnter || state === "seed" ? `${(card.rank % 16) * 26}ms` : "0ms",
        zIndex: 1000 + slot.z,
        opacity: preEnter ? 0 : 1,
      }}
    >
      {/* Glow layer — remounts per round so win/die replays */}
      <div
        key={`${card.id}-${roundKey}-${state}`}
        className="w-[150px] overflow-hidden rounded-lg border"
        style={{
          borderColor: champion
            ? "rgba(34,197,94,0.9)"
            : dying
              ? "rgba(239,68,68,0.9)"
              : state === "win"
                ? "rgba(34,197,94,0.55)"
                : "rgba(255,255,255,0.12)",
          background: "rgba(15,23,42,0.72)",
          backdropFilter: "blur(6px)",
          boxShadow: "0 16px 40px -20px rgba(0,0,0,0.85)",
          animation: glow,
        }}
      >
        {/* mini storefront thumbnail using the variant palette */}
        <div className="p-2">
          <div className="overflow-hidden rounded-sm" style={{ background: bg }}>
            <div className="flex items-center justify-between px-2 py-1.5" style={{ background: structure }}>
              <span className="h-1 w-6 rounded-full" style={{ background: bg, opacity: 0.85 }} />
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
            </div>
            <div className="px-2 py-2">
              <div className="h-5 rounded-sm" style={{ background: structure, opacity: 0.18 }} />
              <div className="mt-1.5 grid grid-cols-3 gap-1">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="aspect-square rounded-sm" style={{ background: structure, opacity: 0.12 }}>
                    <div className="mx-auto mt-[70%] h-0.5 w-3/5 rounded-full" style={{ background: accent, opacity: 0.7 }} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {/* label row */}
        <div className="flex items-center justify-between px-2.5 pb-2 pt-0.5 text-[8px] tracking-[0.15em]">
          <span className="uppercase text-white/45">Variant {LETTERS[card.rank] ?? card.rank}</span>
          <span
            className="tabular-nums"
            style={{ color: champion || state === "win" ? "#4ade80" : dying ? "#f87171" : "rgba(255,255,255,0.55)" }}
          >
            {card.cvr.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3">
      <p className="text-[9px] uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p
        className={`mt-1.5 text-lg font-semibold tabular-nums tracking-tight sm:text-xl ${accent ? "text-[#22c55e]" : "text-white"}`}
        style={{ transition: "color 400ms" }}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[9px] tracking-[0.12em] text-white/25">{sub}</p>
    </div>
  );
}

function Waveform() {
  const bars = useMemo(() => Array.from({ length: 34 }, (_, i) => (i * 37) % 100), []);
  return (
    <div className="flex h-10 items-center gap-[3px]">
      {bars.map((s, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-white/80"
          style={{
            height: "100%",
            transformOrigin: "center",
            animation: `urivo-wave ${560 + (s % 240)}ms ease-in-out ${(s % 100) * 4}ms infinite`,
          }}
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
    <div className="absolute inset-0 z-40 flex items-center justify-center px-6">
      <div
        className="w-full max-w-md rounded-2xl border p-9 text-center"
        style={{
          borderColor: "rgba(34,197,94,0.35)",
          background: "linear-gradient(180deg, rgba(15,23,42,0.94), rgba(8,13,22,0.97))",
          boxShadow: "0 60px 140px -40px rgba(0,0,0,0.85), 0 0 70px -18px rgba(34,197,94,0.4)",
          animation: "urivo-bloom 900ms cubic-bezier(0.16,1,0.3,1) both",
        }}
      >
        <p
          className="flex items-center justify-center gap-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[#22c55e]"
          style={{ animation: "urivo-rise 700ms cubic-bezier(0.16,1,0.3,1) 200ms both" }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" style={{ boxShadow: "0 0 8px #22c55e" }} />
          Champion selected
        </p>
        <h2
          className="mt-5 text-4xl font-semibold tracking-tight text-white"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 340ms both" }}
        >
          {result.storeName}
        </h2>
        <p
          className="mt-3 text-sm italic text-white/55"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 480ms both" }}
        >
          {result.tagline}
        </p>

        {/* Winning metrics */}
        <div
          className="mt-6 flex items-center justify-center gap-6 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 600ms both" }}
        >
          <span>
            <span className="text-[#22c55e]">+3.2%</span> CVR
          </span>
          <span className="text-white/20">·</span>
          <span>
            <span className="text-white/80">95%</span> confidence
          </span>
        </div>

        {/* Palette flowing in */}
        <div
          className="mt-6 flex justify-center gap-2"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 700ms both" }}
        >
          {[result.palette.background, result.palette.structure, result.palette.accent].map((c, i) => (
            <span key={i} className="h-9 w-9 rounded-full border border-white/10" style={{ backgroundColor: c }} />
          ))}
        </div>

        {/* Products materializing */}
        <div className="mt-7 space-y-2 text-left">
          {result.products.slice(0, 4).map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5"
              style={{ animation: `urivo-rise 700ms cubic-bezier(0.16,1,0.3,1) ${820 + i * 120}ms both` }}
            >
              <span className="text-sm text-white/85">{p.title}</span>
              <span className="font-mono text-xs text-[#22c55e]">€{p.priceEUR.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div
          className="mt-8 flex flex-col gap-3"
          style={{ animation: "urivo-rise 800ms cubic-bezier(0.16,1,0.3,1) 1300ms both" }}
        >
          <button
            type="button"
            onClick={() => onOpenStore(result.storeUrl)}
            className="rounded-md bg-[#22c55e] px-6 py-3.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#052e16] transition-all duration-200 ease-(--ease-urivo) hover:-translate-y-0.5 hover:bg-[#4ade80]"
          >
            Open your store
          </button>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/45 transition-colors hover:text-white"
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
      Array.from({ length: 18 }, (_, i) => {
        const s = (i * 40503) % 1000;
        return {
          left: (s % 100) + "%",
          top: ((s * 7) % 100) + "%",
          size: 2 + (s % 3),
          dur: 9 + (s % 8),
          delay: s % 6,
          mx: ((s % 60) - 30) + "px",
          my: -(40 + (s % 80)) + "px",
          op: 0.2 + (s % 30) / 100,
        };
      }),
    [],
  );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
      {motes.map((m, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-[#22c55e]"
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
