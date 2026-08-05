# Urivo — what already exists

A map of what is built, so nothing gets built twice and nothing gets assumed
missing. Regenerate the counts with the commands at the bottom.

**Scale:** 28 migrations · 33 API routes · 19 pages · 10 AI modules · 98 tests

---

## Merchant product

| Capability | Where | State |
| --- | --- | --- |
| Store generation (brand, catalogue, full design system) | `lib/ai/store-generator.ts`, `/api/generate-store` | Shipped |
| AI product photography (Higgsfield → Gemini fallback → branded placeholder) | `lib/ai/image-generator.ts` | Shipped (needs key) |
| Ask Urivo — streaming assistant grounded in real traffic, orders and revenue | `lib/ai/assistant.ts`, `lib/ai/context.ts`, `/api/ask` | Shipped |
| Ask Urivo — propose → confirm → apply a real store edit | `lib/ai/store-editor.ts`, `lib/storefront/apply-edit.ts` | Shipped |
| Market research / product discovery | `lib/ai/market-research.ts`, `/dashboard/research` | Shipped |
| Ad Studio | `lib/ai/ad-studio.ts`, `/dashboard/ads` | Shipped |
| Brand naming + domain availability | `lib/ai/name-studio.ts`, `/api/brand/*` | Shipped |
| Product optimiser | `lib/ai/product-optimizer.ts` | Shipped |
| Generative storefront renderer (nav/hero/card/footer variants) | `app/(store)/.../storefront-renderer.tsx` | Shipped |
| Renderer authors no claims — trust/highlights/story/nav come from the brand or don't render | `lib/storefront/honest-claims.test.ts` | Shipped |
| Product detail pages | `app/(store)/store/[subdomain]/product/[id]` | Shipped |
| Store analytics (visits, devices, referrers) | `lib/analytics/visits.ts`, migration 0017 | Shipped |
| SEO surface | `lib/seo.ts` | Shipped |
| Evolution Lab | `lib/evolution/*`, `/dashboard/evolution` | **Honest simulation** — see `EVOLUTION_ENGINE_ROADMAP.md` |

## Money

| Capability | Where | State |
| --- | --- | --- |
| Credit ledger (append-only, atomic spend) | `lib/credits.ts`, migrations 0001/0008 | Shipped |
| Credit expiry (FIFO, plan credits use-it-or-lose-it) | migration 0022 | Shipped |
| **Credit packs** — Boost 20/€19, Studio 60/€49, Scale 150/€99 | `lib/credit-packs.ts`, `/api/credits/checkout` | Shipped (purchased credits never expire) |
| Out-of-credits moment | `app/(platform)/dashboard/out-of-credits.tsx` | Shipped |
| Subscriptions (Founder €49 / Pro €199) | `lib/billing/subscription.ts`, `/api/checkout` | Written, **unverified** against live Stripe |
| Billing portal | `/api/billing/portal` | Written, unverified |
| Founding members — first 50 at €29/€149, atomic cap | migration 0023 | Shipped |
| Stripe webhook (subs, packs, orders, `account.updated`) | `/api/webhooks/stripe` | Written, unverified |
| Storefront checkout (Connect direct charges) | `/api/store/[subdomain]/checkout` | Written, unverified |
| **Merchant payouts — Connect onboarding, per merchant** | `lib/billing/connect.ts`, `/api/connect/*` | Written, unverified |
| Real cost model + AI usage ledger | `lib/finance/*`, migration 0009 | Shipped |
| Cost-per-action report | migration 0021, `/admin/finance` | Shipped |

## Growth

| Capability | Where | State |
| --- | --- | --- |
| **Creator referral codes + first-touch attribution** | `lib/referral/*`, migrations 0012/0013 | Shipped |
| Commission on first payment (25%) | `lib/referral/service.ts` | Shipped |
| **Creator payouts — owed per creator, settle, audit trail** | `lib/referral/payouts.ts`, migration 0028 | Shipped |
| Referral code entry at signup with live validation | `/api/referral/validate` | Shipped |
| Merchant notifications (low credits, first store, live, orders, payouts) | `lib/notifications/*`, migration 0024 | Shipped |
| Weekly business digest (email + cron endpoint) | `lib/platform/digest.ts`, `/api/cron/weekly-digest` | Shipped |
| Transactional email | `lib/email/*` | Shipped (needs Resend key) |
| **First-sale funnel** — the metric the business steers by | `lib/analytics/first-sale.ts`, migration 0027 | Shipped |

## Platform & safety

| Capability | Where | State |
| --- | --- | --- |
| Auth (email + Google), RLS on every table | migration 0001, `middleware.ts` | Shipped |
| Multi-tenant subdomain routing | `middleware.ts` | Shipped |
| Admin gate (fail-closed, real 404) | `lib/admin.ts`, `middleware.ts` | Shipped |
| Signup guardrails (email-confirm gate, disposable blocklist, IP throttle) | migration 0019 | Shipped |
| Free-generation kill switch + daily spend alert | migration 0020, `/admin/finance` | Shipped |
| Rate limiting (Upstash, in-memory fallback) | `lib/ratelimit.ts` | Shipped |
| Error monitoring | `lib/monitoring.ts` | Shipped (needs Sentry DSN) |
| Model routing seam (per-action env override) | `lib/ai/models.ts` | Shipped |
| Health check | `/api/health` | Shipped |

## Deliberately not built

| | Why |
| --- | --- |
| Custom domains (spec 7) | Needs Cloudflare Registrar + SaaS + Stripe. Post-launch. |
| Urivo Copilot (spec 8) | Post-launch flagship; better designed after watching real usage. |
| Product merchandising (spec 9) | Depends on live commerce. |
| Supplier integration layer | Built, then shelved — `lib/suppliers/README.md`. Dormant, not wired. |
| Real experimentation engine | Needs live traffic. |

## Verification

| Layer | Command | Covers |
| --- | --- | --- |
| Types | `npm run typecheck` | Compilation |
| Units | `npm test` | Pure logic — plans, credits, cost model, referral maths, digest, first-sale |
| Database | `psql -f scripts/verify-db.sql` | RLS isolation, credit atomicity, FIFO expiry, founding cap, payouts, digest |
| Browser | `npm run smoke` | Real rendering, desktop + mobile, no horizontal overflow, no JS errors |

**Known gaps:** no integration tests on API routes; no component tests;
storefronts are `force-dynamic` with no caching.

```bash
# regenerate the counts
ls supabase/migrations/*.sql | wc -l
find app/api -name route.ts | wc -l
find app -name page.tsx | wc -l
npm test
```
