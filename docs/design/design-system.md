# Urivo Design System — v2 (permanent)

> Consistency is more important than creativity. Every update should
> strengthen the Urivo brand, not change it. — Founder directive, 2026-07

This is the permanent design system and single source of truth for every
page, component, animation and interaction. It supersedes the earlier
forest/ivory/champagne language (and the palette in spec 6.5) by explicit
founder branding decision. Where a spec conflicts with this document on
visual identity, this document wins.

## Brand feeling

Premium · Intelligent · Modern · Minimal · Fast · Confident · Luxurious ·
Trustworthy · AI-first. Users should immediately feel they are using
professional software built for serious businesses. Reference feel:
Linear, Stripe, Vercel, Notion.

## Colour tokens (code: `app/globals.css` `@theme`)

| Token | Utility | Hex | Use |
|---|---|---|---|
| Brand | `brand` | `#1F293B` | Primary buttons, nav, sidebar, active states, key UI |
| Brand hover | `brand-hover` | `#18202F` | Hover on brand surfaces |
| Brand soft | `brand-soft` | `#EEF1F6` | Tinted brand backgrounds |
| Gold accent | `gold` | `#D4AF37` | Logo, premium badges, upgrade, achievements — **never overuse; gold = exclusivity** |
| Gold soft / tint | `gold-soft` / `gold-tint` | `#E6CE85` / `#FAF5E6` | Subtle gold highlights |
| Canvas | `canvas` | `#F8FAFC` | Page background |
| Surface | `surface` | `#FFFFFF` | Cards, panels |
| Surface muted | `surface-muted` | `#F1F5F9` | Secondary surfaces |
| Ink | `ink` | `#0F172A` | Primary text |
| Muted | `muted` | `#64748B` | Secondary text |
| Line | `line` | `#E2E8F0` | Borders |
| Success | `success` | `#22C55E` | |
| Warning | `warning` | `#F59E0B` | |
| Error | `error` | `#EF4444` | |

**Exception — the Generation Cinema** is an intentional dark "stage" moment
(spec 6.6), a deliberate spotlight within the otherwise-light app. It is the
one place the deep-brand dark palette is used, by design.

## Typography

Clean modern sans-serif (Inter), Linear/Stripe/Vercel feel. Large headings,
comfortable spacing, strong hierarchy, excellent readability. Limit font
weights (400/500/600/700). No serif display in v2.

| Role | Size / line | Weight |
|---|---|---|
| Display | 48–60 / 1.05 | 600 |
| H1 | 36 / 1.1 | 600 |
| H2 | 28 / 1.2 | 600 |
| H3 | 20 / 1.3 | 600 |
| Body | 16 / 1.6 | 400 |
| Small | 14 / 1.5 | 400 |
| Label / eyebrow | 12–13, tracking 0.06em | 600 |

## Radius (code tokens `--radius-*`)

Small `rounded-sm` 8px · Buttons `rounded-md` 12px · Cards `rounded-lg` 16px ·
Modals `rounded-xl` 20px. Consistent everywhere.

## Shadows

Soft, never harsh. Large blur, low opacity. Tokens `--shadow-soft` (cards),
`--shadow-lift` (hover/elevated). Cards appear elevated without feeling heavy.

## Spacing

8px scale only: 8 / 16 / 24 / 32 / 40 / 48 / 64 / 80 / 96. No random values.

## Components

- **Button / primary:** `bg-brand` white text, `rounded-md`, `shadow-soft`, smooth hover to `brand-hover` + slight lift.
- **Button / secondary:** `bg-surface`, `border-line`, ink text, minimal.
- **Button / danger / success:** error / success fills.
- **Card:** `bg-surface`, `border-line`, `rounded-lg`, `shadow-soft`, generous padding; never flat.
- **Input:** large, comfortable padding, clear label, `border-line`, focus ring `brand`, instant validation.
- **Icons:** Lucide, single consistent stroke, minimal — never mix icon styles.

## Motion

Premium and smooth: fade, scale, slide, blur on `--ease-urivo`. No bounce,
flash or aggressive motion. Every animation has purpose and guides attention.

## States (mandatory patterns)

- **Loading:** never a bare spinner. Skeletons, animated placeholders, or AI
  progress steps ("✓ Understanding your business…", "✓ Creating your brand…").
- **Empty:** never "No data". Guide the next action ("Create your first store").
- **Success:** celebrate ("🚀 Store launched", "✨ Optimization complete").
- **Error:** never blame the user. "We couldn't complete this request. Please
  try again." Offer a recovery action. Never expose internals.

## Non-negotiables

Fully responsive (mobile quality = desktop, no horizontal scroll, comfortable
touch targets). Accessible (AA contrast, keyboard nav, visible focus, semantic
HTML, screen-reader support). Fast (optimistic updates, lazy loading, code
splitting). Reusable, modular components — no duplicated logic, no unnecessary
dependencies. Every implementation preserves existing functionality and
follows this system at all times.

## Final goal

Urivo should feel like software built by a world-class company. Every screen
reinforces premium quality, simplicity, trust, intelligence, professionalism.
If a decision doesn't improve those, it isn't implemented.
