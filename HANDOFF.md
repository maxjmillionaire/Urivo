# Handoff — start here

Entitlement and payment authorization were the open question. They have now been
answered against a real database, and the answer was worse than expected: paid
tiers were reachable three different ways. All three are closed and proven
closed. What remains is external setup — see `LAUNCH.md` Block 0.

---

## What the last session found

The previous attempt failed because it authenticated with `Authorization: Bearer
<access_token>` while the app uses Supabase session cookies, so every
"authenticated" assertion measured an anonymous request. The way past that was
not better cookies: it was to test the layer the cookie only leads to. A local
PostgreSQL with all 46 migrations applied, queried as the `authenticated` role
with a user id in `request.jwt.claim.sub`, is exactly the position a logged-in
visitor holds against PostgREST with the public anon key.

That position could do all of this:

| Attack | Result before |
|---|---|
| `profiles.update({ plan: 'pro' })` | Pro, free, forever |
| `profiles.update({ subscription_status: 'active' })` | Entitlement activated |
| `profiles.update({ comped_until: '2099-01-01' })` | Permanent comp |
| `stores.update({ is_active: true })` | Every store live on Free |
| `stores.insert(...)` | Free stores, born live (`is_active` defaults true) |

RLS was not the problem — every policy was correctly written. RLS decides which
**rows**; it says nothing about which **columns**, and owning the row was
enough. Migration **0045** revokes the blanket UPDATE and grants back only
`full_name` / `marketing_opt_in` on profiles and `store_name` / `theme_config`
on stores.

A fourth way in needed no console: completing Stripe Checkout with a card that
fails authentication still fires `checkout.session.completed` with the
subscription left `incomplete`. The webhook activated on arrival and every gate
read `profiles.plan` alone. `entitledPlan()` (lib/plans.ts) now resolves access
from payment state, and the webhook waits for Stripe to confirm the
subscription is live.

And `publish_store` had never worked: `select count(*) … for update` is invalid
in PostgreSQL, so every publish of a not-already-live store raised and the API
answered "please try again". It hid because generated stores are born live, so
the capacity cap was the one path nobody exercised. **0046** fixes it.

---

## Verified — do not re-audit

| Area | Evidence |
|---|---|
| Privilege escalation | `scripts/adversarial-db.sh` — 25 attacks denied, 0 failures; reopening the grants makes it report 6 |
| Tenant isolation | Read, write and delete of another merchant's stores, products, orders, credits, referrals — all refused |
| Entitlement | `lib/entitlement.test.ts`; resolved against real rows for paid / incomplete / cancelled / comped / expired-comp |
| Live-store capacity | Free 1, Founder 3, Pro unlimited; 5 concurrent publishes against a cap of 3 leave exactly 3 |
| `published_at` | Survives unpublish → republish (first-sale instrumentation) |
| Credits | Two concurrent 20-credit spends against a 25 balance: one succeeds, balance 5, never negative; zero and negative amounts refused |
| Creator commission | Wired to `invoice.paid`; two concurrent writes produce one commission; `referrals.customer_id` is UNIQUE so first-touch cannot be reassigned |
| Storefront checkout | Client-supplied prices ignored, another store's product refused, quantity clamped to stock (`lib/commerce/checkout.test.ts`) |
| Admin | 9/9 admin endpoints and 4/4 admin pages gate on `isAdminEmail` and answer 404 |
| Anonymous | Reads published storefronts only; zero rows writable anywhere |
| Storefront claims | No surface authors a shipping, returns, delivery, environmental or manufacturing promise (`lib/storefront/honest-claims.test.ts`, whole directory) |
| Cart | `lib/client-directive.test.ts` — every component with a handler or hook declares `"use client"` |
| Attribution | 29 integration tests, spec 10 — unchanged, not re-audited |

**Do not reopen the attribution architecture.** The sessionStorage design and the
email-matching proposal were both replaced and are not the current state.

---

## The one guard that has to survive

`entitlement_columns_locked()` (0045) reports whether the dangerous grants are
gone, and `/api/health?deep=1` refuses to call a deployment ready without it. A
missing GRANT has no symptoms — every screen renders, every function answers,
and the only sign is that the tiers are free. If that check ever goes amber,
nothing else about the deployment matters.

---

## Method that produced these results

- Read the repository before calling anything. Routes and columns were guessed
  and wrong repeatedly in earlier sessions; each guess produced a fabricated
  finding. `products.price_eur` is not `price_cents`.
- Test the layer the credential leads to, not the credential. A cookie you
  cannot mint is not a reason to skip authorization testing.
- Prove a guard is not vacuous by reintroducing the bug. Every test added here
  was watched to fail before it was trusted.
- Assert the RPC's status, not only the row afterwards. A 42804 hid for a full
  release because the row looked plausible.
- When a test fails, decide whether the test or the code is wrong first. One
  test here asserted the product page owned its click handler; it does not, it
  composes the component that does.
- Strip comments before judging source. Prose about a retired claim is not the
  claim.

---

## Blocked on purchases, not on effort

See `LAUNCH.md` Block 0. Domain · Railway (deployment + the two scheduled jobs,
which have to be created by hand — `railway.json` only documents the intended
times in inert `//` comments and Railway schedules nothing from it; see
`LAUNCH.md` Block 3) · Higgsfield (visual ad creative, real image cost via
`rebase_image_costs`).

Two things genuinely cannot be checked here and must be done once the project
exists: **run `scripts/adversarial-db.sh` against the real Supabase project**
(it takes a `PGURL`), and confirm `/api/health?deep=1` returns `entitlement.columns` green.

---

## State

372 unit tests · 29 database integration tests (unchanged, need a Supabase
project to run) · 25 adversarial database checks · typecheck clean · production
build compiles · migrations through **0046** · `setup_all.sql` regenerated and
verified to provision a blank database in one paste.
