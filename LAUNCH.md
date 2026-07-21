# Urivo — Launch Runbook

The product is code-complete and the entire database layer has been verified
end-to-end against a real Postgres (migrations + credit RPCs + RLS grants).
What remains is real infrastructure and a staging run-through. Work top to
bottom. Hit `/api/health` after each block to confirm wiring.

---

## Block 1 — Infrastructure & secrets (needed for ANY launch)

1. **Supabase project** — create one at supabase.com.
   - SQL Editor → run every file in `supabase/migrations/` **in order**
     (`0001` → `0008`). Do not skip any; later ones depend on earlier ones.
   - Project Settings → API → copy the URL, the `anon` key, and the
     `service_role` key.
2. **Anthropic key** — platform.claude.com → API keys. Without this, no AI
     works at all (generation, Ask Urivo, research, ads).
3. **Set env vars** (see `.env.example`) in your host (Vercel → Project →
     Settings → Environment Variables). Minimum to function:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ROOT_DOMAIN`, `APP_URL`.
   - Strongly recommended: `HIGGSFIELD_API_KEY`/`_SECRET` (product photos),
     `UPSTASH_REDIS_REST_URL`/`_TOKEN` (real rate limiting),
     `RESEND_API_KEY`/`EMAIL_FROM` (emails), `SENTRY_DSN` (error alerts).
4. **Deploy** (Vercel). Point the domain / `ROOT_DOMAIN` at it.
5. **Verify:** open `/api/health` → `launchReady: true` and every `required`
     flag `true`. Fix any `false` before continuing.

## Block 2 — Staging smoke-test (click every critical flow once, for real)

The DB layer is proven; these are the flows that only real keys + auth exercise.
Run through them on the deployed staging URL and confirm each:

- [ ] **Sign up** with email + name → land on dashboard, greeting shows your name.
- [ ] **Google sign-in** → works, name/avatar populate.
- [ ] **Generate a store** → real brand + products + **photos** appear; credits
      drop by 10; on a free account the store is a **draft**.
- [ ] **Preview the draft** (View/Preview) → you see it with the "Preview" banner;
      an incognito visitor gets 404 (not public).
- [ ] **Ask Urivo** (needs a paid plan) → streams a reply; footer shows
      `1 credit · N left`; balance drops; at 0 the upgrade/top-up pop-up appears.
- [ ] **Market research / Ad Studio** → produce output; credits drop (3 / 2).
- [ ] **Out of credits** → generate modal shows the two-path moment.
- [ ] **Settings** → change name / password; **Sign out** from the account menu.
- [ ] **Legal** pages (Impressum / Datenschutz / AGB) load.
- [ ] `/api/health` still green; check Sentry receives a test error.

## Block 3 — Phase 2 (Stripe: billing + commerce)

- [ ] Stripe account + `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- [ ] **Subscription webhook** (NOT yet written): on `invoice.paid` /
      `customer.subscription.*`, set `profiles.plan` and call
      `grantMonthlyCredits(userId, plan, invoiceId)` (helper exists in
      `lib/billing/subscription.ts`).
- [ ] **Credit-pack completion** (NOT yet wired): on `checkout.session.completed`
      for a pack, call `grantCreditPack(userId, packId, sessionId)`.
- [ ] Wire `/api/checkout`, `/api/credits/checkout`, `/api/billing/portal` to
      real Stripe sessions (the auth + validation are already in place).
- [ ] Storefront Connect checkout (`/api/store/[subdomain]/checkout`) — one real
      test charge on a connected account; confirm the order is recorded.
- [ ] Custom domains (spec 7) — deferred; Cloudflare path documented.

**Note on subdomains:** owner-preview of drafts relies on the Supabase auth
cookie being valid across `*.urivo.ai`. When real subdomains go live, set the
auth cookie domain to `.urivo.ai` so a logged-in owner can preview their draft
on its subdomain.
