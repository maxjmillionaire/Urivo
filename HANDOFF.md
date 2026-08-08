# Handoff — start here

One engineering task remains before external setup. Everything else that could
be verified without a domain, a deployment or a Higgsfield key has been.

---

## The one remaining blocker

**Entitlement and payment authorization is unverified.** Not broken — unverified.
Nobody has yet proven that a Free user cannot reach paid functionality by
calling the API directly.

### Why the last attempt did not settle it

`/tmp/.../scratchpad/sec.mjs` created six users with real database state, read
the route tree from disk, and attacked every protected endpoint. Every call
made "as user X" came back `401 Please sign in` — because it authenticated with
an `Authorization: Bearer <access_token>` header, and **the app uses Supabase
session cookies, not bearer tokens.**

So the run proved only what was already known: anonymous requests are refused.
Every authenticated assertion in it measured something other than its name.

Two smaller artifacts in the same run, for the record: `405` responses came from
calling `GET` on routes that only export `POST` (a safe refusal, but not proof of
authorization), and the credit assertions read `undefined` because the profile
PATCH and the `spend_credits` signature were both guessed rather than read.

### The next step, concretely

1. Log in through the browser as each test user and export the cookies — the
   same way `/tmp/demo-cookies.json` was produced. Playwright context, real
   `/login` submit, `context.cookies()`.
2. Re-run the existing attacks with those cookies. The script is complete apart
   from this: six users with real `plan` / `subscription_status` /
   `stripe_subscription_id`, the route list, and verified cleanup are all there.
3. Read `spend_credits`' real signature from the migration before calling it.
4. Then the untested surfaces: Stripe price-id substitution, forged success URL,
   webhook replay with a repeated `event_id`, creator-code discount manipulation,
   cross-tenant reads and writes with another user's resource ids.
5. For every rejection, assert the **database did not change**. A 403 followed by
   a mutation is still a breach.

---

## Verified — do not re-audit

| Area | Evidence |
|---|---|
| Attribution | 29 integration tests against the real database (`npm run test:db`), spec 10 |
| Anonymous denial | 7 protected routes return 401; webhook refuses missing and invalid signatures |
| RLS | Every table has it enabled; 0 exceptions |
| Admin guards | 5/5 admin API routes and 4/4 admin pages carry `requireAdmin` |
| Rate limits | 0 unprotected public POST routes |
| Cart → checkout | Add to cart, persisted state, counter, drawer, subtotal, checkout call — proven to the payment boundary |
| Pricing | Single source in `lib/plans.ts`; `lib/pricing-drift.test.ts` scans app/ and lib/ |
| Mobile | 6 flows at 390px: no horizontal overflow, no sub-11px text, no JS errors |
| Notifications | No dead email types |

**Do not reopen the attribution architecture.** The sessionStorage design and the
email-matching proposal were both replaced and are not the current state.

---

## Method that produced these results

- Read the repository before calling anything. Routes were guessed three times
  in one session and were wrong three times (`/pricing`, `/legal/terms`,
  `[slug]`); each produced a fabricated finding.
- Assert the RPC's status, not only the row afterwards. A 42804 hid for a full
  release because the row looked plausible and nobody read the 400.
- Give every test case its own identity. Reusing one email turned six
  malformed-input cases into six returning-customer cases.
- When a test fails, decide whether the test or the code is wrong before
  reporting. In this session most failures were the test.
- Strip comments before judging source. Two tests failed on their own prose.

---

## Blocked on purchases, not on effort

See `LAUNCH.md` Block 0. Domain (custom domains, canonical URLs, Stripe return
URLs, owner-preview exclusion) · Railway (deployment, the two cron schedules in
`railway.json`) · Higgsfield (visual ad creative, real image cost replacing the
estimate via `rebase_image_costs`).

---

## State

349 unit tests · 29 database integration tests · typecheck clean · production
build compiles · migrations through 0044 applied · database left clean after
every run.
