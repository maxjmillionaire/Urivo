"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { GenerateStorePanel } from "../generate-store-panel";
import { AnimatedNumber } from "./animated-number";
import { Reveal } from "../../_motion/reveal";
import { CREDIT_COSTS } from "@/lib/credit-costs";
import type {
  DashboardOverview,
  Kpi,
  Opportunity,
  TimelineEvent,
  StoreCard,
  HealthSignal,
} from "@/lib/dashboard/overview";
import {
  IconStore,
  IconSpark,
  IconBolt,
  IconCheck,
  IconTrendUp,
  IconTrendDown,
  IconArrow,
  IconClock,
  IconBag,
  IconEye,
  IconCoins,
  IconGlobe,
} from "./icons";

/*
 * The Executive Command Center — Home.
 *
 * Not a navigation page: the moment the founder lands, they see how the
 * business is performing, what Urivo did while they were away, what to do next,
 * and every number is live. A daily briefing, animated executive KPIs, a
 * Business Health gauge, the AI activity feed, ranked opportunities with
 * one-tap Apply, a real activity timeline and a mini-dashboard per store.
 */

const KPI_ICON: Record<string, (p: { width?: number; height?: number; className?: string }) => React.ReactElement> = {
  revenue: IconCoins,
  orders: IconBag,
  visitors: IconEye,
  conversion: IconTrendUp,
  aov: IconBag,
  stores: IconStore,
  credits: IconSpark,
};

export function DashboardHome({ overview }: { overview: DashboardOverview }) {
  const {
    briefing,
    moment,
    kpis,
    health,
    aiStatus,
    opportunities,
    timeline,
    storeCards,
    planLabel,
    hasPlan,
    canGenerate,
    canPublish,
    creditsExpiry,
    storeCount,
    liveWithoutPayments,
  } = overview;

  return (
    <div className="space-y-6">
      {/*
        The most expensive state in the product: a published store turning away
        every shopper who tries to buy. It sits ABOVE the greeting because it
        outranks anything else on this page, and it stays until it is fixed —
        this is not a tip, it is lost revenue happening right now.
      */}
      {liveWithoutPayments > 0 && <PaymentsBlockedBanner liveStores={liveWithoutPayments} />}

      {moment && <MomentRibbon emoji={moment.emoji} text={moment.text} />}

      {/* ── Daily briefing ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ivory sm:text-[30px]">
            {briefing.greeting}
          </h1>
          <div className="mt-2 space-y-1">
            {briefing.lines.map((line, i) => (
              <p
                key={i}
                className="text-[13.5px] leading-relaxed text-mist"
                style={{ animation: `urivo-fade-up 520ms var(--ease-urivo) ${i * 90}ms both` }}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
        <GenerateStorePanel canGenerate={canGenerate} />
      </header>

      {/* ── Signature Ask Urivo command bar ────────────────────────────── */}
      <AskBar hasStore={storeCount > 0} />

      {/* ── Executive KPIs ─────────────────────────────────────────────── */}
      <section aria-label="Business metrics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {kpis.map((k, i) => (
            <Reveal key={k.key} delay={i * 0.05} y={12}>
              <KpiCard kpi={k} creditsExpiry={creditsExpiry} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Health + AI activity ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Reveal>
          <HealthCard score={health.score} band={health.band} signals={health.signals} />
        </Reveal>
        <Reveal delay={0.08}>
          <AiStatusCard items={aiStatus} />
        </Reveal>
      </div>

      {/* ── Opportunities + Timeline ───────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Reveal>
          <OpportunitiesCard opportunities={opportunities} canGenerate={canGenerate} />
        </Reveal>
        <Reveal delay={0.08}>
          <TimelineCard events={timeline} />
        </Reveal>
      </div>

      {/* ── Stores ─────────────────────────────────────────────────────── */}
      <StoresSection
        stores={storeCards}
        canGenerate={canGenerate}
        canPublish={canPublish}
        planLabel={planLabel}
        hasPlan={hasPlan}
      />
    </div>
  );
}

/* ── Moment ribbon ────────────────────────────────────────────────────── */
/*
 * Live, and unable to take a euro.
 *
 * Deliberately not dismissible and deliberately not styled as an error: nothing
 * is broken with the merchant's store, it is simply unfinished, and the fix is
 * two minutes away. Loud enough to be acted on, calm enough not to feel like a
 * failure on the day they published.
 */
function PaymentsBlockedBanner({ liveStores }: { liveStores: number }) {
  const many = liveStores > 1;
  return (
    <div
      role="alert"
      className="u-float flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/35 bg-gold/[0.07] px-5 py-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold/20 text-[13px] font-bold text-gold"
        >
          !
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-ivory">
            {many ? `Your ${liveStores} live stores can't accept payments yet` : "Your store is live but can't accept payments yet"}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-mist">
            Anyone trying to buy right now is turned away at checkout. Connect Stripe and orders start
            flowing — it takes a couple of minutes.
          </p>
        </div>
      </div>
      <Link
        href="/dashboard/billing"
        className="u-gold u-lift shrink-0 rounded-xl px-5 py-2.5 text-[13px] font-semibold"
      >
        Connect Stripe
      </Link>
    </div>
  );
}

function MomentRibbon({ emoji, text }: { emoji: string; text: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div
      className="u-float flex items-center gap-3 rounded-2xl border border-gold/30 bg-gradient-to-r from-gold/[0.10] to-transparent px-4 py-3"
      style={{ animation: "urivo-fade-up 500ms var(--ease-urivo) both" }}
    >
      <span className="text-lg leading-none">{emoji}</span>
      <p className="flex-1 text-[13.5px] font-medium text-ivory">{text}</p>
      <button
        onClick={() => setOpen(false)}
        aria-label="Dismiss"
        className="u-press text-mist-dim transition-colors hover:text-ivory"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/* ── Ask Urivo signature command bar ──────────────────────────────────── */
const ASK_SUGGESTIONS = ["How can I increase revenue?", "Find trending products", "Improve my homepage", "Why is conversion low?"];

function AskBar({ hasStore }: { hasStore: boolean }) {
  const [text, setText] = useState("");

  const ask = (q: string) => {
    const value = q.trim();
    if (!value) return;
    // Hand off to the companion rail's assistant (one brain, two entry points).
    window.dispatchEvent(new CustomEvent("urivo:ask", { detail: value }));
    setText("");
  };

  return (
    <section className="u-float rounded-2xl border border-hair bg-panel/70 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-gold/25 bg-gold/[0.07] text-gold">
          <IconSpark width={14} height={14} />
        </span>
        <div>
          <p className="text-[13px] font-semibold text-ivory">Ask Urivo</p>
          <p className="text-[11px] text-mist-dim">Your business, one question away.</p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(text);
        }}
        className="mt-3 flex items-center gap-2 rounded-xl border border-hair bg-night px-3 py-2 transition-colors focus-within:border-gold/50"
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={hasStore ? "Ask anything about your business…" : "Ask how to launch your first store…"}
          className="min-w-0 flex-1 bg-transparent text-sm text-ivory placeholder:text-mist-dim focus:outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="u-gold flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-transform active:scale-[0.92] disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Ask"
        >
          <IconArrow width={15} height={15} />
        </button>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {ASK_SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => ask(s)}
            className="u-press rounded-full border border-hair bg-panel/60 px-2.5 py-1 text-[11px] text-cloud transition-colors hover:border-gold/40 hover:text-ivory"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ── KPI card ─────────────────────────────────────────────────────────── */
function KpiCard({ kpi, creditsExpiry }: { kpi: Kpi; creditsExpiry?: DashboardOverview["creditsExpiry"] }) {
  const Icon = KPI_ICON[kpi.key] ?? IconTrendUp;
  return (
    <div className="u-float u-hover-card rounded-2xl border border-hair bg-panel/70 p-4 hover:border-hair-strong">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-mist">{kpi.label}</p>
        {kpi.key === "credits" ? (
          <CreditsInfo expiry={creditsExpiry ?? null} />
        ) : (
          <Icon width={14} height={14} className={kpi.gold ? "text-gold" : "text-mist-dim"} />
        )}
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        {kpi.awaiting ? (
          <span className="text-[24px] font-semibold tracking-tight text-mist-dim">—</span>
        ) : (
          <AnimatedNumber
            value={kpi.value}
            display={kpi.display}
            className={`text-[24px] font-semibold tracking-tight ${kpi.gold ? "u-gold-text" : "text-ivory"}`}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        {kpi.awaiting ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-mist-dim">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-mist-dim" />
            Measuring
          </span>
        ) : (
          <>
            <TrendChip deltaPct={kpi.deltaPct} isNew={kpi.isNew} />
            <span className="text-[11px] text-mist-dim">{kpi.sub}</span>
          </>
        )}
      </div>
    </div>
  );
}

function TrendChip({ deltaPct, isNew }: { deltaPct: number | null; isNew: boolean }) {
  if (isNew) {
    return (
      <span className="inline-flex items-center rounded-full bg-live/12 px-1.5 py-0.5 text-[10px] font-semibold text-live">
        New
      </span>
    );
  }
  if (deltaPct == null) return null;
  const up = deltaPct >= 0;
  const Icon = up ? IconTrendUp : IconTrendDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        up ? "bg-live/12 text-live" : "bg-alert/12 text-alert"
      }`}
    >
      <Icon width={11} height={11} />
      {Math.abs(Math.round(deltaPct))}%
    </span>
  );
}

/* ── Credit cost breakdown (radical clarity, no gamification) ─────────────
 * Opaque metering is the category's known sore point. A tap on the credits
 * card shows exactly what every action costs, in plain language — rendered
 * through a portal so it escapes the KPI grid's transformed stacking contexts.
 */
const CREDIT_LINES: { label: string; cost: number }[] = [
  { label: "Generate a store", cost: CREDIT_COSTS.storeGeneration },
  { label: "AI edit or question", cost: CREDIT_COSTS.askMessage },
  { label: "Market research", cost: CREDIT_COSTS.marketResearch },
  { label: "Ad creative", cost: CREDIT_COSTS.adStudio },
  { label: "Product image", cost: CREDIT_COSTS.productImage },
];

function CreditsInfo({ expiry }: { expiry: DashboardOverview["creditsExpiry"] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right) });
  };

  const toggle = () => {
    if (!open) place();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    // Any scroll/resize would drift the anchored position — dismiss instead.
    const onMove = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label="What credits cost"
        aria-expanded={open}
        className="u-press flex h-5 w-5 items-center justify-center rounded-full text-mist-dim transition-colors hover:text-mist"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11.5v4.5" strokeLinecap="round" />
          <path d="M12 7.75h.01" strokeLinecap="round" />
        </svg>
      </button>
      {open &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-label="Credit costs"
            className="fixed z-50 w-64 rounded-xl border border-hair-strong bg-panel-2 p-3.5 text-left shadow-2xl"
            style={{ top: pos.top, right: pos.right, animation: "urivo-fade-up 150ms var(--ease-urivo) both" }}
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mist">What credits buy</p>
            <ul className="mt-2.5 space-y-1.5">
              {CREDIT_LINES.map((l) => (
                <li key={l.label} className="flex items-center justify-between gap-4 text-[12px]">
                  <span className="text-cloud">{l.label}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-ivory">
                    {l.cost} {l.cost === 1 ? "credit" : "credits"}
                  </span>
                </li>
              ))}
            </ul>
            {expiry && (
              <p className="mt-3 rounded-lg border border-gold/20 bg-gold/[0.05] px-2.5 py-2 text-[11px] leading-relaxed text-cloud">
                {expiry.amount} plan credit{expiry.amount === 1 ? "" : "s"} expire on{" "}
                {new Date(expiry.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}.
              </p>
            )}
            <p className="mt-3 border-t border-hair pt-2.5 text-[11px] leading-relaxed text-mist">
              Monthly plan credits are use-it-or-lose-it — they expire at the end of each billing period.
              Purchased packs never expire. You&apos;re only charged when an action finishes.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ── Business Health ──────────────────────────────────────────────────── */
function HealthCard({ score, band, signals }: { score: number; band: string; signals: HealthSignal[] }) {
  return (
    <section className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
      <div className="flex items-center gap-1.5">
        <IconBolt className="text-gold" width={13} height={13} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Business Health</h2>
      </div>
      <div className="mt-4 flex items-center gap-5">
        <HealthRing score={score} />
        <div>
          <p className="text-[26px] font-semibold leading-none tracking-tight text-ivory">
            {score}
            <span className="text-base text-mist-dim"> / 100</span>
          </p>
          <p className={`mt-1 text-sm font-medium ${bandColor(band)}`}>{band}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-1.5">
        {signals.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-[12.5px]">
            {s.soon ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-hair text-mist-dim">
                <IconClock width={10} height={10} />
              </span>
            ) : s.ok ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-live/15 text-live">
                <IconCheck width={11} height={11} />
              </span>
            ) : (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-alert/15 text-alert">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                  <path d="M12 8v5M12 16h.01" />
                </svg>
              </span>
            )}
            <span className={s.ok ? "text-cloud" : s.soon ? "text-mist-dim" : "text-mist"}>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function bandColor(band: string): string {
  if (band === "Excellent") return "text-live";
  if (band === "Strong") return "u-gold-text";
  if (band === "Needs attention") return "text-alert";
  return "text-mist";
}

function HealthRing({ score }: { score: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const target = (Math.max(0, Math.min(100, score)) / 100) * c;

  // The arc sweeps from empty to its score the first time it's on screen —
  // "charts animate once", nothing dramatic. CSS transition does the tween;
  // we only flip the target from 0 → score. Reduced-motion snaps straight there.
  const ref = useRef<SVGCircleElement>(null);
  const [dash, setDash] = useState(0);

  useEffect(() => {
    const el = ref.current;
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || typeof IntersectionObserver === "undefined") {
      setDash(target);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          requestAnimationFrame(() => setDash(target));
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  return (
    <svg width="76" height="76" viewBox="0 0 76 76" className="shrink-0" aria-hidden>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--color-hair)" strokeWidth="6" />
      <circle
        ref={ref}
        cx="38"
        cy="38"
        r={r}
        fill="none"
        stroke="url(#healthGrad)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform="rotate(-90 38 38)"
        style={{ transition: "stroke-dasharray 1100ms var(--ease-urivo)" }}
      />
      <defs>
        <linearGradient id="healthGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f8ecc0" />
          <stop offset="60%" stopColor="#e4c069" />
          <stop offset="100%" stopColor="#b0842f" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── AI activity ──────────────────────────────────────────────────────── */
function AiStatusCard({ items }: { items: DashboardOverview["aiStatus"] }) {
  return (
    <section className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
      <div className="flex items-center gap-1.5">
        <IconSpark className="text-gold" width={13} height={13} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Urivo AI</h2>
      </div>
      <ul className="mt-4 space-y-2.5">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2.5">
            {it.live ? (
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-gold" style={{ animation: "urivo-live 1.6s ease-in-out infinite" }} />
              </span>
            ) : (
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-live/15 text-live">
                <IconCheck width={11} height={11} />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[13px] leading-snug text-cloud">{it.label}</p>
              {it.detail && <p className="text-[11px] text-mist-dim">{it.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Opportunities ────────────────────────────────────────────────────── */
const TONE_STYLE: Record<string, { dot: string; chip: string }> = {
  growth: { dot: "bg-live", chip: "text-live" },
  setup: { dot: "bg-gold", chip: "u-gold-text" },
  risk: { dot: "bg-alert", chip: "text-alert" },
  soon: { dot: "bg-mist-dim", chip: "text-mist-dim" },
};

function OpportunitiesCard({ opportunities, canGenerate }: { opportunities: Opportunity[]; canGenerate: boolean }) {
  return (
    <section className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
      <div className="flex items-center gap-1.5">
        <IconTrendUp className="text-gold" width={14} height={14} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Today&apos;s Opportunities</h2>
      </div>
      <div className="mt-4 space-y-2.5">
        {opportunities.map((o) => (
          <OpportunityRow key={o.id} o={o} canGenerate={canGenerate} />
        ))}
      </div>
    </section>
  );
}

function OpportunityRow({ o, canGenerate }: { o: Opportunity; canGenerate: boolean }) {
  const tone = TONE_STYLE[o.tone] ?? TONE_STYLE.setup;
  const isGenerate = o.id === "first-store";

  return (
    <div className="u-lift group rounded-xl border border-hair bg-night p-3.5 transition-colors hover:border-hair-strong hover:bg-night-2">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium text-ivory">{o.title}</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mist">{o.detail}</p>
          <p className={`mt-1.5 text-[11px] font-semibold ${tone.chip}`}>{o.impact}</p>
        </div>
        <div className="shrink-0 self-center">
          {o.soon ? (
            <span className="rounded-lg border border-hair px-3 py-1.5 text-[11px] font-medium text-mist-dim">Soon</span>
          ) : isGenerate ? (
            <GenerateStorePanel
              canGenerate={canGenerate}
              triggerLabel={o.cta}
              triggerClassName="u-gold u-press rounded-lg px-3 py-1.5 text-[11px] font-semibold"
            />
          ) : (
            <Link
              href={o.href}
              className="u-gold u-press inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold"
            >
              {o.cta}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Timeline ─────────────────────────────────────────────────────────── */
function TimelineCard({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="u-float rounded-2xl border border-hair bg-panel/70 p-5">
      <div className="flex items-center gap-1.5">
        <IconClock className="text-gold" width={13} height={13} />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-mist">Activity</h2>
      </div>
      {events.length === 0 ? (
        <p className="mt-4 text-[12.5px] text-mist-dim">Your activity will appear here as Urivo works and orders arrive.</p>
      ) : (
        <ol className="mt-4 space-y-3.5">
          {events.map((e, i) => (
            <li key={i} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className={`mt-1 h-2 w-2 rounded-full ${eventDot(e.kind)}`} />
                {i < events.length - 1 && <span className="mt-1 w-px flex-1 bg-hair" />}
              </div>
              <div className="min-w-0 pb-0.5">
                <p className="text-[12.5px] font-medium leading-snug text-cloud">{e.label}</p>
                {e.detail && <p className="text-[11px] text-mist-dim">{e.detail}</p>}
                <p className="mt-0.5 text-[10.5px] uppercase tracking-wide text-mist-dim">{relTime(e.at)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function eventDot(kind: TimelineEvent["kind"]): string {
  if (kind === "order") return "bg-live";
  if (kind === "ai") return "bg-gold";
  if (kind === "import") return "bg-gold-soft";
  return "bg-mist";
}

function relTime(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfThen.getTime()) / 86_400_000);
  if (dayDiff === 0) return then.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/* ── Stores (mini dashboards) ─────────────────────────────────────────── */
function StoresSection({
  stores,
  canGenerate,
  canPublish,
  planLabel,
  hasPlan,
}: {
  stores: StoreCard[];
  canGenerate: boolean;
  canPublish: boolean;
  planLabel: string;
  hasPlan: boolean;
}) {
  return (
    <section id="stores">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-ivory">Your stores</h2>
        <div className="flex items-center gap-3">
          <span className="hidden text-[11px] text-mist-dim sm:inline">
            {hasPlan ? `${planLabel} plan` : "No plan yet"}
          </span>
          {stores.length > 0 && <span className="text-xs text-mist">{stores.length} total</span>}
        </div>
      </div>

      {stores.length === 0 ? (
        <EmptyStores canGenerate={canGenerate} />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {stores.map((s, i) => (
            <Reveal key={s.id} delay={i * 0.06} y={16}>
              <StoreMiniCard store={s} canPublish={canPublish} />
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}

function StoreMiniCard({ store, canPublish }: { store: StoreCard; canPublish: boolean }) {
  const conv = store.conversionPct;
  return (
    <Link
      href={`/dashboard/stores/${store.id}`}
      className="u-float u-hover-card group block rounded-2xl border border-hair bg-panel/70 p-4 hover:border-hair-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-hair bg-panel-2 text-mist">
            <IconStore width={16} height={16} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ivory">{store.name}</p>
            <p className="truncate font-mono text-[10.5px] text-mist-dim">{store.subdomain}.urivo.ai</p>
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${
            store.isLive ? "bg-live/10 text-live" : "bg-white/5 text-mist"
          }`}
        >
          {store.isLive && <span className="h-1.5 w-1.5 rounded-full bg-live" />}
          {store.isLive ? "Live" : canPublish ? "Paused" : "Draft"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <MiniStat label="Revenue" value={store.revenueTodayCents > 0 ? euros(store.revenueTodayCents) : "—"} gold />
        <MiniStat label="Orders" value={store.ordersToday > 0 ? String(store.ordersToday) : "—"} />
        <MiniStat label="Visitors" value={store.visitorsToday > 0 ? String(store.visitorsToday) : "—"} />
        <MiniStat label="Conv." value={conv != null ? `${conv.toFixed(1)}%` : "—"} />
      </div>

      <div className="mt-3.5 flex items-center justify-between border-t border-hair pt-3">
        <div className="flex items-center gap-2">
          <HealthDot score={store.health} />
          <span className="text-[11px] text-mist">{store.products} product{store.products === 1 ? "" : "s"}</span>
        </div>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-gold-soft transition-colors group-hover:text-gold">
          Manage <IconArrow width={12} height={12} />
        </span>
      </div>

      {store.latestAction && (
        <p className="mt-2 truncate text-[10.5px] text-mist-dim">
          <span className="text-mist">Latest:</span> {store.latestAction}
        </p>
      )}
    </Link>
  );
}

function MiniStat({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div>
      <p className="text-[9.5px] font-medium uppercase tracking-wide text-mist-dim">{label}</p>
      <p className={`mt-0.5 text-[15px] font-semibold tabular-nums tracking-tight ${gold && value !== "—" ? "u-gold-text" : "text-ivory"}`}>
        {value}
      </p>
    </div>
  );
}

function HealthDot({ score }: { score: number }) {
  const color = score >= 70 ? "bg-live" : score >= 40 ? "bg-gold" : "bg-alert";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[11px] font-medium text-mist">{score}</span>
    </span>
  );
}

function EmptyStores({ canGenerate }: { canGenerate: boolean }) {
  return (
    <div className="u-float mt-4 overflow-hidden rounded-2xl border border-hair bg-panel/60 p-10 text-center sm:p-14">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-gold/20 bg-gold/[0.06] text-gold">
        <IconGlobe width={22} height={22} />
      </span>
      <h3 className="mx-auto mt-6 max-w-md text-[24px] font-semibold tracking-tight text-ivory">
        Your first store is one sentence away.
      </h3>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-mist">
        Describe what you want to sell — Urivo researches the market, designs the brand, writes the
        catalog and builds a complete storefront in under a minute.
      </p>
      <div className="mt-8 flex justify-center">
        <GenerateStorePanel
          canGenerate={canGenerate}
          triggerLabel="Generate your first store"
          triggerClassName="u-gold u-lift inline-flex items-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold"
        />
      </div>
    </div>
  );
}

function euros(cents: number): string {
  const v = Math.round(cents) / 100;
  return v % 1 === 0 ? `€${v.toLocaleString("en-US")}` : `€${v.toFixed(2)}`;
}
