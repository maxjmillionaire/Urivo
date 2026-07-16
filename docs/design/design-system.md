# Urivo Design System — v1

> Luxury is restraint. Every interface should feel expensive. — UEOS Book III

## Purpose

Single source of truth for every visual decision in Urivo V1: the marketing site,
the merchant dashboard, generated storefronts, and transactional emails.
Derived from UEOS Book III (Creative Direction), Book VI (Standards) and
specifications 6.5, 6.7 and 6.9. Where documents conflict, the newest
specification wins (founder decision, 2026-07-16).

## Brand assets

| File | Use |
|---|---|
| `assets/brand/urivo-mark.svg` | Product UI, transparent background (nav, auth, loader) — founder-approved flat design, 2026-07-16 |
| `assets/brand/urivo-mark-badge.svg` | App icon, favicon, social avatars |
| Founder raster exports | Brand master for marketing/media — never scaled up in product UI |

The mark is a flat single-path fill by design (no gradient). Default fill is
champagne `#EDE0C2` for dark surfaces; recolor to forest-900 `#0B2416` on light
surfaces via the `fill` attribute or CSS. Never place the champagne mark on ivory
(contrast); minimum clear space = height of the arrowhead.

## Color tokens

The 60 / 30 / 10 rule (spec 6.5): 60% Forest Green, 30% Warm Ivory, 10% Champagne Gold.

| Token | Hex | Role |
|---|---|---|
| `forest-950` | `#05120B` | Deepest surfaces (sidebar credit card, footers) |
| `forest-900` | `#0B2416` | Primary brand green — sidebars, hero, buttons-inverse, storefront defaults |
| `ivory-100` | `#EFEAD8` | Primary canvas (app + marketing background) |
| `ivory-50` | `#F7F4EA` | Elevated light surfaces |
| `champagne` | `#EDE0C2` | Logo mark on dark surfaces, premium highlights |
| `gold-300` | `#E9D3A0` | Gold gradient highlight |
| `gold-500` | `#C69B3C` | Champagne Gold — CTAs, accents, active states |
| `gold-700` | `#9C7526` | Gold gradient shadow, pressed states |
| `success` | `#047857` (light) / `#34D399` (on dark) | Payments, live status |
| `danger` | `#B91C1C` (light) / `#F87171` (on dark) | Errors, destructive actions |

Glass surfaces (dashboard cards): `rgba(255,255,255,0.4)` + `backdrop-blur` on ivory;
hairline borders `rgba(11,36,22,0.08)`.

**Contrast rules (WCAG AA, mandatory per UEOS Book VI):**
- Ivory on forest-900: passes for all text. Preferred high-contrast pair.
- Gold-500 on forest-900: passes for large text/headings and icons only.
- Gold-500 on ivory: **fails for text** — gold is never body/label text on light
  backgrounds; use it for borders, icons ≥24px, and filled CTAs with forest text.

## Typography

| Role | Font | Notes |
|---|---|---|
| Display / headlines | Playfair Display (serif) | Production stand-in for IvyPresto until a license is purchased — documented decision; the swap is a CSS variable change |
| Body / UI / data | Inter (sans) | Stand-in for BDO Grotesk, same rationale |

Scale (rem-based, 16px root):

| Token | Size / line | Use |
|---|---|---|
| `display-xl` | 64 / 1.0 | Marketing hero only |
| `display` | 48 / 1.05 | Section heroes, generation loader |
| `h1` | 40 / 1.1 | Page titles |
| `h2` | 32 / 1.15 | Section titles |
| `h3` | 24 / 1.2 | Card titles |
| `body` | 16 / 1.6 | Default |
| `sm` | 14 / 1.5 | Table cells, meta |
| `micro-caps` | 11 / 1.2, uppercase, tracking 0.22em, weight 600 | Labels, eyebrows, nav |

Weights: serif 400 (+italic) only. Inter 300 / 400 / 500 / 600. Nothing heavier —
luxury never shouts (UEOS Book III). Negative tracking (−0.02em) on serif ≥40px.

## Spacing, layout, radius

- 4px base unit. Component padding steps: 12 / 16 / 24 / 32. Section rhythm: 96–128px desktop, 64px mobile.
- Content max-width 1152px (marketing), dashboard sidebar fixed 256px, main column max 1152px.
- Whitespace is a feature — when in doubt, add space, remove elements.
- **Radius decision:** early specs use `rounded-none`; spec 6.7 (newest) calls for
  "rounded premium components." Resolution: app surfaces use `r-md` 10px (inputs,
  buttons, cards) and `r-lg` 16px (modals, panels); marketing and generated
  storefronts keep the sharp editorial 0–2px look. Pills/badges: full radius.

## Motion

- Single easing curve everywhere: `cubic-bezier(0.16, 1, 0.3, 1)` (token: `ease-urivo`).
- Durations (UEOS Book VI): fast interactions 150–200ms · standard transitions 250–350ms · complex/entrance 400–600ms.
- Entrances: 16px rise + fade, 50ms stagger between siblings (max 3 staggers).
- Signature moment: the generation loader's gold shimmer line (1px track, sweeping gradient).
- `prefers-reduced-motion` is mandatory: all movement collapses to opacity fades.
- Motion never delays productivity — nothing blocking may exceed 350ms.

## Components

| Component | Spec |
|---|---|
| **Button / primary** | Gold-500 fill, forest-900 text, micro-caps 11, padding 16×24; hover: forest-900 fill, ivory text, −2px translate, soft gold shadow; active: translate 0 |
| **Button / secondary** | 1px forest-900 outline, transparent; hover fills forest-900/ivory (inverts on dark) |
| **Button / ghost** | Text-only micro-caps, gold on hover |
| **Input** | White/60 fill, hairline border, focus: gold border + white fill, 2px gold focus ring (visible keyboard focus mandatory) |
| **Card** | Glass surface, hairline border, r-md; hover lifts to white/80 |
| **Table** | Micro-caps header row on forest-900/5, hairline row dividers, row hover white/50 |
| **Badge** | Live = success tint · Trial = neutral tint · Founder = gold tint |
| **Modal** | Forest-900/20 backdrop blur, ivory panel r-lg, entrance 400ms |
| **Toast** | Bottom-right, ivory on forest-900, auto-dismiss 5s, never stacks >3 |
| **Loader** | Full-screen generation overlay: status headline (serif display), gold shimmer bar, telemetry lines — see screens-v1.md §5 |

Icons: Lucide, 1.5px stroke, 16/20/24px. The `✦` glyph is reserved as the brand
accent marker (nav active state, feature bullets).

## Voice & microcopy

Calm, precise, confident. Short sentences. No exclamation marks in UI.
Banned words (spec 6.5): "Revolutionary", "Unlock", "Dive into", "Game-changing",
"In today's digital world". Errors state what happened and the next step —
never blame the user, never expose internals (spec 6.1 §10).

## Pricing display (locked decisions, 2026-07-16)

Tiers per spec 6.8 **plus a Free tier** (founder decision):

| Tier | Launch (23 Jul – 15 Aug, lifetime) | Standard | Credits |
|---|---|---|---|
| **Free** | €0 | €0 | 15 one-time · 1 store · 5 products · urivo.ai subdomain only |
| **Core** | €49/mo forever | €79/mo | monthly allowance (final number set with unit economics before launch) |
| **Pro** | €199/mo forever | €299/mo | higher allowance + custom domains, priority generation |

Launch pricing UI: standard price struck through, launch price in gold,
"Founder Pricing — yours for life" microcopy, countdown to 15 Aug. Users must
always understand why they got their price (spec 6.8).

## Emails (Resend)

Single column 600px, ivory background, forest-900 header band with the badge mark,
gold CTA button, Inter only (serif via image/fallback), plain-text alternative always.

## Accessibility checklist (blocks release, UEOS Book VI)

Keyboard path through every flow · visible 2px gold focus ring · AA contrast on
all text · semantic HTML + labeled inputs · reduced-motion support ·
screen-reader announcements for async states (generation progress, toasts).
