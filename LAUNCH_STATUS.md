# Urivo — Launch Status & Working Memory

> Living doc. Updated after significant work; re-read after any context reset to stay oriented.
> **Snapshot:** `main` @ `15f45a6` · last updated 2026-09-03.

---

## 1. Pricing (DECIDED)
- **Founder €49/mo · Pro €199/mo.** Everyone pays standard.
- **Founding 50 KILLED** (PR #13, on main): no €29/€149 anywhere; `getFoundingOffer()` permanently closed; a legacy `price_type="founding"` resolves to standard.
- **Credit packs** exist as the expansion lever: Boost 20/€19, Studio 60/€49, Scale 150/€99 (priced above subscription on purpose).
- **Post-proof plan:** A/B test €69 vs €49 on new cohorts (judge on conversion×first-sale×retention, grandfather early users). Do NOT raise on "feels amazing" — raise when "price is no longer the bottleneck." Entry digit matters less than expansion/NDR.
- **Creators:** honor GITO (35% first-month, one-time, margin-safe). No NEW *recurring* creator commissions. One-time only, on the higher base.
- **70% Month-2 contribution-margin floor** is the hard rule (guardrail lives in `lib/finance/simulator.ts` → `MONTH2_MARGIN_FLOOR_PCT`). Investor share = 3% (`investorShare = 0.03`).

## 2. Product philosophy (AGREED — governs all UX)
- **"The engine gets deeper so the cockpit gets shallower."** Every gain in intelligence must remove a decision, never add surface.
- **Automate the work, keep the judgment** — earned autonomy: autonomy = f(reversibility, blast radius, confidence, marginal human insight); judgment lives in *policy + exceptions*, not per-action approval clicks; autonomy is *earned/graduated*, a dial.
- **Simplify the experience, not the product surface** — keep real jobs (Research/Stores/Marketing/Audience) visible; intelligence curates *attention*, never *access*.
- **A capability does not automatically deserve a tab** — new subsystems (AutoDS, CAPI, attribution, analytics, win-back) go UNDERNEATH existing jobs / surface via Next Action.
- **Premium via restraint + honesty**, never gamification/upsell/notification spam. Never assert a number the data can't back.

## 3. What's shipped to `main`
- Free-tier gating (no free live stores), generation guard (0059, fail-closed), Pause & Reactivate (0058), Shopify export, Audience + campaigns (0057).
- Finance corrections: investor 3%, GITO 35% (0060), Month-2 margin floor.
- Legal pages finalized + marketing consent (0061/0062/0063) — placeholders gone, opt-in default, weekly digest gated on consent + one-click unsubscribe.
- **Next Action V1** (Home = "what should I do next?"): deterministic activation ladder + one gated performance rec (mobile conversion, honest sample/coverage gates); Opportunities folded in as ≤2 "worth watching"; greeting simplified; AskBar receded.

## 4. Migrations
- **Applied in prod (confirmed by founder):** 0055–0063. `main` is at 0063. Nothing unapplied.

## 5. Environment / infra facts
- **Anthropic key: LIVE in prod.** **Higgsfield image key: NOT set** → product images don't generate yet (stores look half-built). Gemini fallback exists if `GOOGLE_AI_API_KEY` set.
- This sandbox CANNOT reach `urivo.ai` (egress blocked) — founder runs live smoke tests / Stripe dashboard config.
- Railway deploys `main`. Health: `GET /api/health` (deep mode needs `CRON_SECRET`).

## 6. Launch blockers (honest, ranked)
**Tier 1 — blocks credible launch:**
1. Set the **Higgsfield image key** (or confirm Gemini) — no product photos otherwise.
2. **Prove one real end-to-end sale in prod** (generate → publish → connect Stripe → test purchase). Never done yet.
3. Legal pages deployed ✅ (done, on main).

**Tier 2 — product-promise holes:**
4. **Sourcing/fulfillment (AutoDS) is dark** — merchants can't get real products. Decide: wire it, or state "bring your own products."
5. **Retention Loop B (win-back)** not built (see §7).

**Tier 3 — better, not blocking:** analytics (PostHog off), CAPI, Next Action V2 (contextual handoffs, Evolution Lab absorb, nav simplification), withdrawal-consent flow + executed DPAs.

## 7. Retention loops
- **Loop A (involuntary churn / dunning): ALREADY BUILT in code.** `paymentFailedEmail` fires on the `past_due` transition (`subscription.ts`), CTA → billing → Stripe portal; past_due keeps store live. **Remaining = Stripe dashboard config:** enable Smart Retries, avoid double-emailing with Stripe's own dunning, verify portal allows card update.
- **Loop B (voluntary win-back, 30/60/90 on paused stores): NOT built.** Reuses Resend + cron + Pause&Reactivate + consent/unsubscribe (0062). Task #5 in the list. Scope ready when founder says go.

## 8. Credits / out-of-credits
- Fully built already: `out-of-credits.tsx` moment + packs + `/api/credits/checkout` + 402 enforcement across all AI actions. No free-credit drip (deliberate). Do NOT rebuild.

## 9. CAPI (when built)
- Free to connect (Meta/Google/TikTok charge nothing for the API). Per-merchant creds. Cost = engineering + a consent/privacy update. Ad spend is the merchant's own optional budget, never a Urivo bill.

## 10. Open branches (not merged)
- `claude/urivo-codebase-review-w34tu3` (old, superseded).
- Everything else merged. Feature branches after merge are stale.

## 11. Working conventions
- Branch per change → PR → verify CI green + scope → merge to `main` (never push to main directly).
- Verify gate every change: typecheck · relevant tests · full suite · production build. Migrations: pglite/replay validation, apply-before-deploy ordering.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: …`. PR body ends with the Claude Code line + session URL.

## 12. Next actions (when founder returns)
1. Set Higgsfield/Gemini image key; run the first real end-to-end sale.
2. Enable Stripe Smart Retries (Loop A config).
3. Decide the AutoDS sourcing story.
4. Then: Loop B win-back build, or Next Action V2.
