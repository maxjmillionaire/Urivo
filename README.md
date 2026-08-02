# Urivo

**The AI Commerce Operating System.** Describe a business in one sentence and
Urivo designs the brand, writes the catalogue, generates the product
photography, builds a live storefront and keeps optimising it — research,
branding, generation, commerce, marketing and analytics in one platform.

## Status

Pre-launch. The application is built and the database layer is verified
end-to-end against a real Postgres. Remaining work before revenue is tracked in
[`LAUNCH.md`](./LAUNCH.md) — infrastructure, Stripe Connect merchant onboarding,
and one full run-through against live keys.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js (App Router), React, TypeScript |
| Styling | Tailwind, custom design tokens ("Midnight") |
| Data | Supabase — Postgres, Auth, Storage; RLS on every table |
| AI | Anthropic (generation, editing, research, ads), Higgsfield/Gemini (imagery) |
| Payments | Stripe — subscriptions + credit packs; Connect for storefront orders |
| Email | Resend |
| Hosting | Railway, with Cloudflare DNS (incl. wildcard subdomains) |

## Getting started

```bash
npm install
cp .env.example .env      # fill in at minimum: Supabase, Anthropic, APP_URL
npm run dev
```

For the database, paste [`supabase/setup_all.sql`](./supabase/setup_all.sql)
into the Supabase SQL Editor once — it contains every migration in order.

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest
npm run build       # production build
npm run db:build    # regenerate setup_all.sql after adding a migration
```

Open `/api/health` to see which dependencies are configured; `launchReady: true`
means every required key is present.

## Layout

```
app/(platform)      dashboard, admin, auth, legal — the dark "Midnight" product
app/(store)         generated merchant storefronts, served per subdomain
app/api             route handlers (generation, AI, billing, webhooks, cron)
lib/ai              generation, editing, research, ads, naming, imagery
lib/finance         cost model, usage ledger, KPIs, simulator
lib/notifications   merchant events + the notification feed
lib/platform        platform settings, spend alerting, weekly digest
supabase/migrations the schema, applied in order
specifications/     the product specifications (the source of truth)
```

## Documentation

- [`LAUNCH.md`](./LAUNCH.md) — the launch runbook: what to configure, what to
  verify, and what is still missing.
- [`PROJECT.md`](./PROJECT.md) — product vision and scope.
- [`CLAUDE.md`](./CLAUDE.md) — engineering standards for this repository.
- [`specifications/`](./specifications) — the numbered specifications. These are
  authoritative; where anything conflicts, the specification wins.
- [`EVOLUTION_ENGINE_ROADMAP.md`](./EVOLUTION_ENGINE_ROADMAP.md) — the path from
  the labelled simulation to real experimentation.

## Author

Max-Joel Basner
