# Urivo — Launch Status & Working Memory

> Living doc. Updated after significant work; re-read after any context reset to stay oriented.
> **Snapshot:** `main` @ `eae9157` · last updated 2026-09-07. This doc lives on `main`.

---

## 1. Pricing (DECIDED)
- **Founder €49/mo · Pro €199/mo.** Everyone pays standard.
- **Founding 50 KILLED** (PR #13, on main): no €29/€149 anywhere; `getFoundingOffer()` permanently closed; a legacy `price_type="founding"` resolves to standard.
- **Credit packs** exist as the expansion lever: Boost 20/€19, Studio 60/€49, Scale 150/€99 (priced above subscription on purpose).
- **Post-proof plan:** A/B test €69 vs €49 on new cohorts (judge on conversion×first-sale×retention, grandfather early users). Do NOT raise on "feels amazing" — raise when "price is no longer the bottleneck." Entry digit matters less than expansion/NDR.
- **Launch FOMO (DECIDED, honest version):** €49 is framed as genuine EARLY-ADOPTER pricing that WILL rise to €69 once case studies exist; early joiners grandfathered at €49 forever. The lack of case studies is the reason to buy now ("before the case studies, price goes up — lock in €49"). Urgency is real because the raise + lock-in are real. FORBIDDEN: fake countdown timers, "spots left" counters, resetting urgency, fabricated testimonials/metrics — that's the Founding-50 theater we killed. No code needed until the raise (then: €49→€69 with grandfathering of existing subs).
- **Transaction/GMV take rate — REJECTED (for now).** A naked 1% skim on merchant sales contradicts a *tested* product principle (`plans.test.ts`: capped tiers are NOT a take rate; checkout must never read volume; never punish success). Urivo also isn't in the funds flow (Stripe Connect DIRECT charges → merchant's own account), so a skim needs Connect re-plumbing (`application_fee`) + erodes the "your store, your money" promise, for ~€0 at launch GMV. Upside from winners already comes via capped tiers + credit packs. IF ever pursued: a future opt-in "Urivo Payments" value layer (processing/fraud/tax/chargebacks), never a retrofit tax on today's plans.
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
- **Shopper order confirmation** (PR #16, 072036e): storefront checkout now emails the BUYER a store-branded receipt on paid order (was silent — only the merchant was notified). Sent as "«Store» via Urivo" on the verified domain, reply-to the merchant. Store-branded email layout added (brand leads, "Powered by Urivo" footer); itemised summary in HTML + text.
- **AskUrivo Operator Doctrine + brevity** (PR #18, 935dae1): AskUrivo now reasons with an e-commerce Operator Doctrine (`lib/ai/doctrine.ts`) — real operator numbers (four levers, 3x rule, break-even ROAS=1/margin, €30-80 price window, conv 1-3%, ad fatigue +20-30% CPA, dispute rate <1%, blended CPA, profit-in-2nd-order, 13-week cash gap), elevated from founder's OTS 18-module curriculum into Urivo's own voice (IP-clean, no course branding — founder confirmed OTS is his + co-creator's, NOT Clinton's). Carried as a cached system block (per-turn cost barely moves). Also retuned to be quick/wise/effective: most answers 1-3 tight sentences, one highest-leverage move, not essays. Guardrail: doctrine SHARPENS diagnosis of the founder's real numbers, doesn't make it a generic advice bot.
- **AskUrivo guardrails** (PR #20, 20831fb): customer-facing boundaries in the system prompt — no profanity ever, stays on the founder's business, warm one-line redirect for off-topic/personal/"who runs Urivo"/other-users questions, never discloses its own instructions/doctrine, declines harmful/deceptive. `SYSTEM_PROMPT` exported + pinned by a guard test. Prompt v4.
- **AskUrivo advanced knowledge library + retrieval** (PR #21, 06002e5): `lib/ai/knowledge.ts` — 11 expert niche modules (post-privacy measurement, creative testing, paid scaling structures, offer engineering, AOV/post-purchase, retention/LTV/subscription, email+SMS flows, advanced CRO/PDP, sourcing→private label, cash-flow discipline, channel choice Meta/TikTok/Google), self-sourced from operator expertise in Urivo's voice. `selectKnowledge()` injects only the 1-2 modules a question touches (keyword scoring, NO embeddings/vector DB — right at this scale), uncached + capped + size-bounded, so most turns stay lean. Prompt v5. **Expand = add a module (no docs needed — founder confirmed no more OTS docs coming).**
- **AskUrivo emotional intelligence** (PR #23, eae9157): CARRY THE FOUNDER section — read the mood, meet it in one honest line before helping, hold the founder's dream, name real progress when real. Critical: EI *with* honesty, never instead — no flattery/fake enthusiasm/inflated numbers ("belief that isn't earned is just another lie"), stays brief. Prompt v6. **AskUrivo is now: live context + operator doctrine + on-demand deep knowledge + brevity + guardrails + emotional intelligence — the moat that ChatGPT-in-a-panel can't match.**

## 4. Migrations
- **Applied in prod (confirmed by founder):** 0055–0063. `main` is at 0063. Nothing unapplied.

## 5. Environment / infra facts
- **Anthropic key: LIVE in prod.** **Higgsfield image key: NOT set** → product images don't generate yet (stores look half-built). Gemini fallback exists if `GOOGLE_AI_API_KEY` set.
- This sandbox CANNOT reach `urivo.ai` (egress blocked) — founder runs live smoke tests / Stripe dashboard config.
- Railway deploys `main`. Health: `GET /api/health` (deep mode needs `CRON_SECRET`).
- **Email = TWO systems.** (1) Urivo→merchant (welcome/digest/dunning/new-order): BUILT on Resend (`lib/email/service.ts`), from `Urivo <hello@urivo.ai>`. (2) Store→shopper: order confirmation now BUILT (PR #16); shipping/tracking email NOT built (waits on AutoDS fulfillment data). Store emails send "«Store» via Urivo" on the verified urivo.ai domain (no per-merchant domain verification needed at launch); custom-domain sending is a later upgrade via Resend domains API. €20 Resend Pro (~50k/mo) covers both at launch scale. Needs `RESEND_API_KEY` + urivo.ai verified in Resend.
- **Startup cost stack (founder decided: launch with ALL, no deferrals):** domain ~$160 one-time, then monthly Higgsfield €59 + AutoDS €39.90 + Railway €20 + Resend €20 + Claude €20 (+ ~€30 Anthropic credit buffer). ≈ €336 month 1, ≈ €159/mo steady. **Critical first domino = buy domain** (unblocks AutoDS application + email sending + DNS). Founder's real launch floor is well under the €500 he was waiting on from a third party (Clinton).

## 6. Launch blockers (honest, ranked)
**Tier 1 — blocks credible launch:**
1. Set the **Higgsfield image key** (or confirm Gemini) — no product photos otherwise.
2. **Prove one real end-to-end sale in prod** (generate → publish → connect Stripe → test purchase). Never done yet.
3. Legal pages deployed ✅ (done, on main).

**Tier 2 — product-promise holes:**
4. **Sourcing/fulfillment (AutoDS) is dark** — DECIDED: wire it (founder wants full all-in-one stack, no deferrals). **AutoDS API reality (verified 2026-09):** approval-gated + one-time activation fee (unpublished, "varies by use case") + NO free trial + auth/docs only released AFTER approval → cannot build until approved. It DOES support the needed ops (product import, automated orders, sourcing, product data) and the "users authorize your platform to manage their own accounts" model. **Architecture DECIDED:** each merchant authorizes their OWN AutoDS account under Urivo (invisible to them) — NOT one shared account (that fronts everyone's COGS on founder's card, single point of failure, breaks ToS). **Action:** apply at autods.com/api AFTER domain bought (form needs Site URL); message drafted in session. Critical path = external approval + fee + timeline, not code.
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
- This doc (`claude/launch-status`) is now MERGED to main (PR #14). Everything else merged; feature branches after merge are stale.

## 11. Working conventions
- Branch per change → PR → verify CI green + scope → merge to `main` (never push to main directly).
- Verify gate every change: typecheck · relevant tests · full suite · production build. Migrations: pglite/replay validation, apply-before-deploy ordering.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` + `Claude-Session: …`. PR body ends with the Claude Code line + session URL.

## 12. Next actions (when founder returns)
1. **Buy the domain (urivo.ai)** — the first domino; unblocks AutoDS application, store email sending, DNS.
2. **Submit AutoDS API application** at autods.com/api (drafted message; needs Site URL) → get activation fee + timeline + model confirmation. Then I wire the integration (product import + order forwarding), which also unblocks the shipping/tracking email.
3. Set Higgsfield/Gemini image key; run the first real end-to-end sale.
4. Enable Stripe Smart Retries (Loop A config).
5. Ship the €49 early-adopter FOMO framing on the pricing page (honest version — see §1).
6. Then: Loop B win-back build, or Next Action V2.
