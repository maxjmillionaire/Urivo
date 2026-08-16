# Urivo V1 — Screen Inventory & Layout Specifications

> **Note (2026-07).** Colour references in this document have been updated to
> **Design System v2 (light Slate/Gold)** — see `design-system.md`, the single
> source of truth for visual identity. Some typography language (serif display)
> predates v2 and is historical; the screen inventory, layout, and state
> requirements below remain valid.

Scope: the 6-day launch build. Every screen listed here ships in V1; anything not
listed (Evolution Engine, creator dashboard, admin panel, i18n) is deliberately
post-launch. Visual rules come from `design-system.md`. Spec sources noted per screen.

Status legend: every screen must define its **loading, empty, error and success
states** before implementation — engineers never guess (UEOS Book IV, Phase V).

---

## 1. Landing page `/` (spec 1, 6.5, 6.8)

Purpose: convert cold traffic into Free signups and launch-priced subscriptions.

- **Hero:** display-xl serif headline, one-line subhead, primary CTA ("Start free"),
  secondary ghost CTA ("See pricing"). Canvas, ink type, mark top-left.
- **Product proof:** looping silent demo of the generation experience (video/animated),
  framed as a glass card. This is the screen-recordable moment pre-Evolution-Engine.
- **How it works:** 3 steps (Describe → Generate → Sell), micro-caps eyebrows, ✦ bullets.
- **Pricing:** 3-tier grid per design-system pricing table. Core visually elevated
  ("Most popular"). Launch countdown chip during the window. Free tier CTA = signup.
- **FAQ:** 6–8 items, accordion, plain language (billing, credits, lifetime pricing, cancellation).
- **Footer:** legal links (Impressum, Datenschutz, AGB), contact, © Urivo.
- States: countdown hides automatically outside 23 Jul–15 Aug window (server-driven flag).

## 2. Authentication `/login` `/signup` `/reset-password` (spec 6.7)

Purpose: zero → building in under 30 seconds.

- Centered panel (max 420px) on canvas; badge mark; "Welcome to Urivo".
- **Continue with Google** (primary, first), divider "or", email + password.
- Password rules: min 8, 1 upper, 1 lower, 1 number — validated inline while typing,
  strength indicator, never only on submit.
- Links: Forgot password / Create account / Sign in toggle.
- Reset flow: email → Resend link → new password → auto-redirect to sign-in with toast.
- States: submitting (button spinner ≤300ms feedback), invalid credentials (calm inline
  error), unverified email prompt, OAuth failure fallback message.
- Legal: signup requires AGB + Datenschutz checkbox (DSGVO, spec 6.4 §46).

## 3. Onboarding — first login (spec 6.7)

- Brief welcome animation (600ms, skippable, reduced-motion aware).
- Workspace auto-provisioned silently (user, workspace, credits, preferences — no forms).
- Single question, full-screen, serif display: **"What would you like to sell?"**
  Free-text prompt input + 3 example chips. Submit → generation experience (§5).
- Skippable ("Take me to the dashboard").

## 4. Dashboard `/dashboard` (specs 2, 4, 6.5)

Purpose: mission control. Loads < 2s (spec 6.3 §30).

- **Sidebar (256px, canvas):** mark + wordmark, nav (Console ✦, Stores, Billing,
  Settings), bottom credit card on slate showing live credit balance + plan badge,
  user email, logout.
- **Main (canvas):** header "Merchant Workspace" + primary CTA "✦ Generate new store".
- **Stores table:** brand name, `subdomain.urivo.ai` (mono, links out), status badge,
  actions (Design / Products / View).
- States: **empty state is the hero** — first-run users see an invitation panel
  ("Your first store is one sentence away") with the generate CTA, not an empty table.
  Loading: skeleton rows. Error: retry panel, no stack traces.

## 5. Generation experience (specs 3, 6.3, 6.5)

Purpose: the signature moment. AI acknowledgement < 300ms; progress is honest
(driven by real job states from the queue, not a fake timer).

- Full-screen overlay: canvas/95 blur; top status line; center serif display headline
  cycling real pipeline stages (Researching your market → Naming your brand →
  Designing your identity → Writing your catalog → Deploying your store);
  1px gold shimmer progress bar; understated telemetry lines beneath.
- Input: prompt + desired subdomain (validated live: `[a-z0-9-]`, availability check).
- Success: full-bleed reveal — store name in serif display, palette swatches, live URL,
  CTAs "Open store" / "Edit products". Confetti: none. Restraint.
- Failure: credits are never lost on failure (atomic transaction, spec 6.2 §19);
  message offers retry; queue position shown if providers are degraded.

## 6. Store detail `/dashboard/stores/[id]` (specs 3, 4)

- Header: store name, live URL, status, "View live" button.
- **Products panel:** table (title, description truncated, price €, stock, actions),
  add-product modal, delete with confirm. Instant optimistic CRUD (spec 6.5).
- **Design panel (slide-over, 480px):** store name, tagline, palette pickers
  (hex + swatch, live preview strip), typography display. Save = "Commit changes".
- States: unsaved-changes guard, per-field validation, optimistic update with rollback toast on failure.

## 7. Billing `/dashboard/billing` (specs 6.2, 6.8)

- Current plan card: tier, price **with origin explanation** ("Founder Pricing — locked
  for life" / standard), renewal date, cancel/manage via Stripe Customer Portal link.
- Credits: balance, this-month usage, ledger list (delta, reason, date) — the visible
  face of the credit ledger.
- Upgrade cards: Free→Core→Pro with launch pricing during window; checkout via Stripe.
- **Out-of-credits modal (global):** appears on any insufficient-credits response —
  balance, what the action costs, single upgrade CTA. Calm, never punishing.

## 8. Settings `/dashboard/settings`

- Profile (name, email, avatar from Google), workspace name, password change
  (email accounts), sign-out-everywhere, delete account (double confirm + typed
  confirmation; DSGVO right-to-erasure).

## 9. Generated storefront `https://{subdomain}.urivo.ai` (specs 1, 4)

Purpose: the merchant's product — must look premium with zero merchant effort.
First render < 1.5s (spec 6.3 §30).

- Rendered server-side from `theme_config` + products. **All merchant/AI content
  HTML-escaped** (spec 4 File 30 pattern — XSS is a launch blocker).
- Layout: editorial header (brand serif name, italic tagline), product grid
  (2-col desktop / 1-col mobile), product cards (title, copy, €price, CTA),
  minimal footer ("Powered by Urivo" on Free tier — removable on paid).
- V1 purchase CTA: configurable external link / contact — **no checkout processing
  for merchant customers in V1** (Urivo bills merchants; merchant payments are post-launch scope).
- States: store deactivated → branded 404; empty catalog → "coming soon" mode.

## 10. Legal & compliance (spec 5 §2, 6.4 §46)

- `/impressum`, `/datenschutz`, `/agb` — static, canvas, readable serif/sans mix.
  Content: founder-provided. Linked from footer + signup.
- Cookie/consent banner: PostHog analytics only after consent; canvas bar,
  Accept / Necessary-only. No dark patterns.

## 11. Transactional emails (Resend, spec 6.9)

Welcome · verify email · password reset · payment success · payment failed ·
subscription confirmed (with pricing-origin line) · subscription cancelled.
Template per design-system §Emails. Plain-text part always.

## 12. System states

- Branded 404 and 500 (serif headline, one CTA home; no internals exposed).
- Maintenance page (static, servable from Cloudflare).
- Global toast system; offline indicator in dashboard.

---

## Build order for the design→build handoff

1. Design tokens + Tailwind config (from design-system.md) — everything else consumes this.
2. §2 Auth, §4 Dashboard shell — unlocks all authenticated work.
3. §5 Generation + §9 Storefront — the product core.
4. §6 Store detail, §7 Billing — completes the money loop.
5. §1 Landing, §10 Legal, §11 Emails, §12 System states — launch wrap.
