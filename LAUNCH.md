# Urivo — Launch Runbook

Work top to bottom. After each block, hit `/api/health` to confirm wiring.

**Where the code actually stands.** The application is built and the database
layer is verified end-to-end against a real Postgres — all 25 migrations, the
credit RPCs, RLS grants, and the one-shot `setup_all.sql`. Subscriptions, credit
packs, the billing portal and the storefront checkout are **written and wired**;
they have simply never been run against live Stripe keys. One capability is
genuinely missing: **Stripe Connect merchant onboarding** (Block 4).

What remains is therefore infrastructure, one build task, and a real
run-through — in that order.

---

## Block 1 — Infrastructure & secrets (needed for ANY launch)

1. **Supabase project** — create one at supabase.com.
   - SQL Editor → New query → paste **`supabase/setup_all.sql`** → Run. That
     single file contains every migration (`0001` → `0025`) in order.
     Alternatively run each file in `supabase/migrations/` in order — never a
     subset, later ones depend on earlier ones.
   - Project Settings → API → copy the URL, the `anon` key, and the
     `service_role` key.
   - *If you add a migration later,* regenerate the one-shot file with
     `npm run db:build` so it never drifts behind the folder.
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
5. **Verify:** open `/api/health` → `launchReady: true` and every `required`
   flag `true`. Fix any `false` before continuing.

## Block 2 — Staging smoke-test (click every critical flow once, for real)

The DB layer is proven; these are the flows that only real keys + auth exercise.
Run through them on the deployed staging URL and confirm each:

- [ ] **Sign up** with email + name → confirm the email → land on dashboard,
      greeting shows your name, **20 welcome credits** are granted (they are
      granted on confirmation, not at signup).
- [ ] **Google sign-in** → works, name/avatar populate, credits granted.
- [ ] **Disposable email is refused** at signup (blocklist + domain check).
- [ ] **Generate a store** → real brand + products + **photos** appear; credits
      drop by 20; on a free account the store is a **draft**.
- [ ] **First-store notification** appears in the bell; **credits-low** fires
      once the balance drops below 20.
- [ ] **Preview the draft** (View/Preview) → you see it with the "Preview"
      banner; an incognito visitor gets 404 (not public).
- [ ] **Publish** on a paid plan → store goes live; a "store is live"
      notification appears (and does not re-fire on a re-toggle same day).
- [ ] **Ask Urivo** (needs a paid plan) → streams a reply; footer shows
      `1 credit · N left`; balance drops; at 0 the upgrade/top-up pop-up appears.
- [ ] **Ask Urivo edit** → propose → confirm → the real store changes.
- [ ] **Market research / Ad Studio** → produce output; credits drop (3 / 3).
- [ ] **Out of credits** → generate modal shows the two-path moment.
- [ ] **Settings** → change name / password; **Sign out** from the account menu.
- [ ] **Admin** → `/admin/finance` loads for an `ADMIN_EMAILS` address and 404s
      for anyone else. Cost-per-action and the founding tracker render.
- [ ] **Legal** pages (Impressum / Datenschutz / AGB) load.
- [ ] `/api/health` still green; check Sentry receives a test error.

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

## Block 4 — Stripe Connect merchant onboarding (NOT built — the one real gap)

Storefront checkout already refuses to charge unless the store has a connected
account with charges enabled (`app/api/store/[subdomain]/checkout/route.ts`),
and the `stores` table carries `stripe_account_id` / `stripe_charges_enabled`.
**Nothing creates that account.** Until this ships, merchants cannot be paid.

To build:

- [ ] Decide the account model: one connected account **per user** (simplest,
      recommended) vs **per store**. The schema currently hangs the account off
      the store, so per-store works today and per-user means copying the id onto
      each of the owner's stores.
- [ ] `POST` route that calls `accounts.create` (Express) then
      `accountLinks.create` and redirects the merchant to Stripe onboarding.
- [ ] Return path that re-reads the account and persists `stripe_account_id`
      plus `charges_enabled`.
- [ ] Handle `account.updated` in the existing webhook to keep
      `stripe_charges_enabled` current (a merchant can be de-authorised later).
- [ ] Surface payout status in the dashboard: a store that cannot accept
      payments must say so plainly rather than failing at checkout.

## Block 5 — Phase 2 (Stripe: billing + commerce) — verification, not construction

All of the following is **already written**. This block is about proving it
against live keys, not building it.

- [ ] Stripe account + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- [ ] Create the products/prices and point the plan config at them.
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

## Block 6 — Deferred by decision (do not build before launch)

- **Custom domains** (spec 7) — Cloudflare Registrar + Cloudflare for SaaS path
  is fully specified. Every store lives free on its `*.urivo.ai` subdomain
  until then.
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
