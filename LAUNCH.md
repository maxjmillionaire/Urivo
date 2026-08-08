# Urivo — Launch Runbook

Work top to bottom. After each block, run the **preflight** — not the plain
health check:

```
curl "https://<your-domain>/api/health?deep=1&key=$CRON_SECRET"
```

`/api/health` on its own only reports which environment variables are *present*.
Every failure that actually takes a launch down passes that check: test Stripe
keys in production, a migration nobody pasted, a revoked key, `APP_URL` still on
localhost. The deep mode probes the database, compares the deployed schema
against the functions the code calls, and asks Stripe who it is. It returns
`503` with a list of blockers until the deployment can genuinely take money.

**Where the code actually stands.** The application is built and the database
layer is verified end-to-end against a real Postgres — all 36 migrations, the
credit RPCs, RLS grants, and the one-shot `setup_all.sql`. Subscriptions, credit
packs, the billing portal, storefront checkout and **Stripe Connect merchant
onboarding** are all written and wired; they have simply never been run against
live Stripe keys. Custom domains have their database, provider seam and
middleware in place, and need the API and setup screen once a real domain and a
deployed origin exist.

What remains is therefore infrastructure, live-key verification, and a real
run-through — in that order.

---

## The dated plan

| Date | What happens | Who |
|---|---|---|
| **11 Aug** | Funding lands. Buy the domain, deploy on Railway, point Cloudflare at it, swap in live Stripe keys, apply outstanding migrations. | Founder |
| **11–12 Aug** | Block 1 and Block 2 end to end on the real domain. Nothing else starts until preflight is green. | Founder |
| **12–15 Aug** | Test phase. A handful of real people use Urivo on comped plans; feedback arrives in `/admin/feedback` with the screen attached. Fix what they hit. | Both |
| **15 Aug** | Public launch, marketing on. | Founder |

The test phase is the part most likely to be skipped and the part most worth
protecting. Three days of five people using the product finds things no amount
of internal clicking will, because they do not know where not to press.

---

## Block 0 — Waiting on money (nothing here is an engineering problem)

Three purchases gate everything below, and none of them can be worked around
in code. Everything that is buildable without them is already built, tested
and pushed; the items here are blocked on access, not on effort.

| # | Purchase | Unblocks | State of the code |
|---|---|---|---|
| 1 | **Domain** | Custom-domain routes · canonical URLs · Stripe return URLs · owner-preview exclusion (spec 10 §13) | Routing and middleware are written and pass locally; none of it can be verified against a real host until the domain exists |
| 2 | **Railway** | Deployment · the two cron schedules in `railway.json` — daily `/api/cron/expire-clicks` (retention, spec 10 §11) and weekly digest | Both endpoints are built and callable; retention that is never scheduled is not retention |
| 3 | **Higgsfield API key** | Visual ad creative — the image or video that *is* the ad · real image cost replacing the estimate everywhere | Ad Studio writes, measures, learns and exports; only the visual is missing. `rebase_image_costs` (0037) is waiting to replace every estimated figure with the real one |

### Why the visual is last and not first

Ad Studio is already a marketing system rather than a copywriter: it writes
platform-correct ads, gives each one a tracked link, measures clicks, orders
and revenue exactly, feeds those results into the next generation, and exports
files Google and Meta import directly. What it cannot do is produce the picture.

That is deliberately the last thing built, because Urivo's own rule applies to
Urivo: **no AI action ships without its real cost known.** Estimating the price
of image generation and then optimising against the estimate is exactly the
habit this company decided not to have. The moment the key exists, the estimate
is replaced everywhere by measurement.

### One open item that is not about money

Owner-preview exclusion (spec 10 §13): a merchant loading their own published
storefront currently counts as a visitor and depresses their conversion rate.
The clean fix depends on whether the platform's auth cookie is visible on a
storefront subdomain, which cannot be answered without the real domain — so it
is listed under item 1 rather than guessed at now.

---

## Block 1 — Infrastructure & secrets (needed for ANY launch)

1. **Supabase project** — create one at supabase.com.
   - **On a brand-new, empty project:** SQL Editor → New query → paste
     **`supabase/setup_all.sql`** → Run. That single file contains every
     migration (`0001` → `0036`) in order.
   - **On a project that already has some migrations applied:** do NOT replay
     `setup_all.sql` — migration `0001` creates tables unconditionally and will
     error on the first one that already exists. Instead check what is actually
     there (below), then generate and run a catch-up:
     `npm run db:build -- --from 00NN` → paste `supabase/catch_up_from_00NN.sql`.
   - **To see how far a project has got**, open `<SUPABASE_URL>/rest/v1/` with
     your service-role key as both `apikey` and `Authorization: Bearer`. The
     response lists every table and RPC the project actually exposes. A project
     missing `orders`, `notifications` or `platform_settings` is behind.
   - Project Settings → API → copy the URL, the `anon` key, and the
     `service_role` key.
   - *If you add a migration later,* regenerate the one-shot file with
     `npm run db:build` so it never drifts behind the folder.
   - **Free-tier projects pause after ~7 days idle.** A paused project refuses
     connections and looks exactly like a network fault. Check the dashboard
     before debugging anything else.
2. **Anthropic key** — platform.claude.com → API keys. Without this, no AI
   works at all (generation, Ask Urivo, research, ads).
3. **Set env vars** (see `.env.example`) on **Railway** → your service →
   Variables. Minimum to function:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ROOT_DOMAIN`, `APP_URL`.
   - Strongly recommended: `HIGGSFIELD_API_KEY`/`_SECRET` (product photos),
     `UPSTASH_REDIS_REST_URL`/`_TOKEN` (real rate limiting),
     `RESEND_API_KEY`/`EMAIL_FROM` (emails), `SENTRY_DSN` (error alerts),
     `ADMIN_EMAILS` (without it **nobody** can reach `/admin/finance`),
     `CRON_SECRET` (weekly digest — Block 3).
4. **Deploy on Railway** (connect the GitHub repo → deploy the branch). Use
   Railway's temporary URL first; then manage DNS in **Cloudflare** (incl. the
   wildcard `*.urivo.ai` for storefronts) pointing at Railway, and set
   `ROOT_DOMAIN` / `APP_URL` to the real domain. Domain via a registrar
   (Cloudflare), not Railway.
5. **Verify — with the preflight, not the plain health check:**
   `/api/health?deep=1&key=$CRON_SECRET` must return `200` with
   `"ok": true` and an empty `blockers` array. It will tell you, by name, which
   migrations are missing, whether the Stripe key is live or test, whether the
   key is actually valid, and whether `APP_URL` and `ROOT_DOMAIN` agree. Work
   the blockers to zero before continuing; treat the warnings as a shopping
   list. (Without `CRON_SECRET` set, deep mode does not exist and the endpoint
   answers `404` — it fails closed.)

## Block 2 — Staging smoke-test (click every critical flow once, for real)

The DB layer is proven; these are the flows that only real keys + auth exercise.
Run through them on the deployed staging URL and confirm each:

- [ ] **Sign up** with email + name → confirm the email → land on dashboard,
      greeting shows your name, **25 welcome credits** are granted (they are
      granted on confirmation, not at signup). Count them: the pricing table
      promises 25, and this number is the first promise Urivo makes.
- [ ] **Google sign-in** → works, name/avatar populate, credits granted.
- [ ] **Disposable email is refused** at signup (blocklist + domain check).
- [ ] **Generate a store** → real brand + products + **photos** appear; credits
      drop by 20, leaving 5.
- [ ] **First-store notification** appears in the bell; **credits-low** fires
      once the balance drops below 20.
- [ ] **Publish on the FREE account** → the store goes live on its urivo.ai
      address and an incognito visitor can see it. Free runs one live store on
      purpose; a free user who has never owned anything does not pay to keep it.
- [ ] **Publish a second store on Free** → refused with the capacity message,
      not a crash, and the first store stays live.
- [ ] **Ask Urivo** → streams a reply; footer shows `2 credits · N left`;
      balance drops; at 0 the upgrade/top-up pop-up appears.
- [ ] **Ask Urivo edit** → propose → confirm → the real store changes.
- [ ] **Market research / Ad Studio** → produce output; credits drop (4 / 4).
- [ ] **Out of credits** → generate modal shows the two-path moment.
- [ ] **Settings** → change name / password; **Sign out** from the account menu.
- [ ] **Admin** → `/admin/finance`, `/admin/testers` and `/admin/feedback` all
      load for an `ADMIN_EMAILS` address and **404** for anyone else (sign out
      and check — a 403 would confirm the route exists).
- [ ] **Feedback** → press the Feedback control on a dashboard screen, send one,
      and confirm it appears in `/admin/feedback` with the route attached. Then
      confirm a failure is honest: it must never say "sent" when nothing saved.
- [ ] **First-sale instrumentation** → publish a store and confirm
      `stores.published_at` is stamped; unpublish and republish and confirm it
      does **not** reset. The First sale panel is the number the business is
      steered by — verify it is recording before real merchants arrive.
- [ ] **Legal** pages (Impressum / Datenschutz / AGB) load.
- [ ] Preflight still returns `"ok": true`; check Sentry receives a test error.

## Block 3 — Weekly business digest (scheduled)

The digest aggregates each merchant's week and emails a summary with one
next-best-action. The endpoint is built and secured; it needs a scheduler.

- [ ] Set `CRON_SECRET` on Railway to a long random string.
- [ ] Point a weekly job at `POST /api/cron/weekly-digest` with header
      `Authorization: Bearer <CRON_SECRET>` (Railway cron, Supabase `pg_cron` +
      `net.http_post`, GitHub Actions, or cron-job.org). `GET` also works for
      schedulers that only issue GET.
- [ ] Confirm `/api/health` → `recommended.weeklyDigest: true`.
- [ ] Trigger it once by hand and confirm the JSON summary
      (`eligible` / `emailed` / `notified`) and that a digest lands in the inbox.

Unset `CRON_SECRET` disables the endpoint (503) — it fails closed, so an
unconfigured deployment can never fan out mail.

## Block 4 — Stripe Connect merchant onboarding (built — verify with live keys)

**Model: one connected account per merchant** (founder decision, migration
0026). A merchant onboards once and every store they own sells through that
account. The account lives on `profiles`; the per-store columns from 0005 are
deprecated and no longer read.

Written and waiting on keys:

- `POST /api/connect/onboard` — creates the Express account (idempotent) and
  returns a fresh onboarding link. Once charges are enabled the same endpoint
  returns an Express dashboard link instead, so the button keeps working.
- `GET /api/connect/return` — Stripe's return leg. Re-reads the account rather
  than assuming success, so the dashboard is accurate immediately.
- `GET /api/connect/refresh` — re-mints an expired onboarding link.
- `account.updated` in the webhook — keeps `charges_enabled` honest, and
  notifies the merchant when payouts turn on or get restricted.
- Billing page shows payout state in plain language for all five states.

To verify:

- [ ] Complete Stripe's Express onboarding end to end in test mode.
- [ ] Confirm `profiles.stripe_account_id` / `stripe_charges_enabled` populate,
      and the billing card moves to **Active**.
- [ ] Confirm a second store owned by the same merchant sells through the same
      account without re-onboarding.
- [ ] Abandon onboarding half-way, return, and confirm you resume the same
      account rather than creating a second one.
- [ ] Let an onboarding link expire and confirm `/api/connect/refresh` puts you
      back into the flow.
- [ ] Trigger a restriction in test mode and confirm the store stops accepting
      orders and the merchant is notified.

## Block 5 — Phase 2 (Stripe: billing + commerce) — verification, not construction

All of the following is **already written**. This block is about proving it
against live keys, not building it.

- [ ] Stripe account + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- [ ] **No products or prices to create in Stripe.** Both checkout routes pass
      inline `price_data` built from `lib/plans` and `lib/credit-packs`, so the
      price a customer is charged always comes from the source of truth and can
      never drift from what the pricing page shows. Changing a price is a code
      change, not a dashboard change.
- [ ] **Webhook endpoint** registered at `/api/webhooks/stripe`. The handler
      already covers `checkout.session.completed`,
      `checkout.session.async_payment_succeeded`, `invoice.paid`,
      `customer.subscription.updated` and `customer.subscription.deleted`. The
      raw body is signature-verified before anything is trusted, and every
      handler is idempotent — the same invoice or session cannot grant credits
      twice, so Stripe's retries are safe.
- [ ] **Subscribe** on a real card → `profiles.plan` flips, monthly credits are
      granted, the confirmation email sends, publishing unlocks.
- [ ] **Founding member** → one of the first 50 signups is charged €29/€149 and
      the admin founding tracker increments. Confirm the cap cannot be exceeded.
- [ ] **Credit pack** → purchase completes and credits land exactly once
      (re-send the same webhook event; the balance must not move twice).
- [ ] **Billing portal** → `/api/billing/portal` opens Stripe's portal; a
      cancellation flows back through the webhook and downgrades the plan.
- [ ] **Renewal credits** → confirm `invoice.paid` on a renewal grants the new
      month's credits and that the previous month's plan credits expire (FIFO,
      permanent credits untouched).
- [ ] **Storefront sale** (needs Block 4) — one real test charge on a connected
      account; confirm the order is recorded, the merchant gets the "first sale"
      notification and the email.
- [ ] **Refund** a test charge and confirm the order status updates.

## Block 6 — The test phase (12–15 Aug)

Three days of real people using the product, on real plans, before marketing
turns on. This is the cheapest bug-finding available: testers do not know where
not to press.

**Setup**

- [ ] `ADMIN_EMAILS` set, so `/admin/testers` and `/admin/feedback` open.
- [ ] Each tester **signs up normally first** — access is granted to a real
      account, never created from the admin panel, so email confirmation, the
      disposable-domain blocklist and the signup throttle still apply to them.
      A tester who skipped those is not testing the funnel.
- [ ] Grant each of them Founder or Pro for 14 days from `/admin/testers`. Every
      grant expires by itself; it will refuse an account that already pays,
      because overwriting a Stripe subscriber's plan would desynchronise the
      product from Stripe.
- [ ] Tell them where the Feedback control is. That is the whole briefing —
      the screen, the store and the plan attach themselves.

**Watch daily**

- [ ] `/admin/feedback` — "Where people are getting stuck" ranks open reports by
      screen. The top row is the next thing to fix.
- [ ] `/admin/finance` — free-tier inference spend and the kill switch.
- [ ] Sentry — errors nobody bothered to report.

**The question the test phase actually answers:** did anyone reach a first real
sale, and where did the others stop? The North Star is the share of merchants
who make a first sale, so a test phase that produces five happy testers and zero
sales has told you something important, not nothing.

- [ ] Revoke the comps, or let them lapse, before the public launch.

## Block 7 — Deferred by decision (do not build before launch)

- **Custom domains** (spec 7) — the foundation is in: `store_domains` with a
  platform-wide unique hostname (0031), the Cloudflare provider seam, hostname
  validation, and middleware that routes an unrecognised Host to a 404 instead
  of Urivo's marketing site. What is left needs a real domain and a deployed
  origin: the API routes, the merchant setup screen, and canonical/Stripe return
  URLs on custom hosts. Available on **Founder and Pro**. Until then every store
  lives free on its `*.urivo.ai` subdomain.
- **Urivo Copilot** (spec 8) — post-launch flagship; the grounded assistant and
  the propose→confirm→apply safety model it builds on already exist.
- **Product merchandising** (spec 9) — variants, bundles, galleries, honest
  reviews. Depends on live commerce, so it follows launch.
- **Supplier integration layer** — built, then deliberately shelved. See
  `lib/suppliers/README.md`; it is dormant, not wired, and reversible.
- **Real Evolution engine** — the Lab ships labelled as a simulation. See
  `EVOLUTION_ENGINE_ROADMAP.md`; genuine experimentation needs live traffic.

---

**Note on subdomains:** owner-preview of drafts relies on the Supabase auth
cookie being valid across `*.urivo.ai`. When real subdomains go live, set the
auth cookie domain to `.urivo.ai` so a logged-in owner can preview their draft
on its subdomain.

**Note on cost control:** free-tier generation is the one uncapped expense.
Before opening signups, set `ADMIN_EMAILS` and confirm `/admin/finance` shows
the daily spend split and the free-generation kill switch. The daily spend alert
emails admins at most once per day when free-tier inference crosses the
threshold.
