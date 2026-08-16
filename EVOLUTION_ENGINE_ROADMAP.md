# Evolution Lab v2 — Real Experimentation Engine (roadmap)

**Status:** Roadmap. Not scheduled. **Gated on real merchant traffic** — do not build
pre-launch. This document is a plan, not an active specification; it does not
belong in `specifications/` and must not be treated as work to start now.

**Why this document exists:** an external review proposed replacing the current
Evolution Lab with a live statistical A/B‑testing engine (Bayesian evaluation,
bandit allocation, a control baseline, promote‑to‑store, cross‑generation
breeding). The *vision* is right and it is the strongest differentiation
available to Urivo. The *timing* is not now. This captures the design so it is
ready when the precondition is met.

---

## What exists today (and why it stays)

Today's Evolution Lab (`lib/evolution/engine.ts`, `evolution-lab.tsx`,
`champion-reveal.tsx`) is a **deterministic, seeded simulation** — a fast,
free, cinematic demonstration of how variants compete and a champion emerges.
It runs with zero API calls and no traffic. It is now labelled **"Simulation
preview"** in the UI and its copy states plainly that scores are a fitness
model, not measured conversion.

Keep it. It is a genuinely good onboarding/marketing artifact and it becomes
the *preview* mode of the real engine. v2 is **additive** — a new live mode
alongside the simulation, not a rewrite of it.

## Why v2 waits for traffic

1. **No traffic, nothing to test.** A Bayesian/bandit engine needs conversions
   to update on. Pre‑launch, stores have ~0 visitors — the engine would crown
   nothing, forever. The simulation is the honest pre‑traffic experience.
2. **Recurring inference cost with no revenue.** Continuous, AI‑generated
   testing spends per store for the life of the store — exactly the exposure
   the free‑tier cost controls (migrations 0019–0021) were built to contain.
   Turn it on when there is revenue to cover it.
3. **Discipline already accepted.** The prior review's own guidance: *"no new
   Decision Intelligence — a bandit has no data to learn from pre‑launch."*
   v2 wires that bandit into a live loop; it inherits the same precondition.

**Precondition to start v2:** a cohort of published stores with enough real
traffic that a test can resolve in a reasonable window (see §Pre‑test
projection). Until then: simulation only.

---

## v2 design

### 1. Bayesian evaluation (no fixed sample size)
- For each variant vs control, maintain a Beta posterior on conversion rate
  (`Beta(1 + conversions, 1 + non‑conversions)`).
- Compute **P(variant is best)** by Monte‑Carlo over the posteriors.
- **Stop** when the leader crosses a configurable threshold (default proposal:
  95% probability of being best) **or** a "no meaningful difference" region is
  reached. There is no upfront sample requirement — remove that concept
  entirely; do not restyle it.

### 2. Control baseline (mandatory)
- The merchant's **current live page is always in the test as control.**
- Report every variant's **lift relative to control**, with its interval.
- **Never promote a variant that fails to beat control** at threshold. "Nothing
  beat your current page" is a valid, honest outcome — say so.

### 3. Bandit traffic allocation
- Reuse the existing Decision Intelligence ε‑greedy policy engine (migration
  0016) — **do not write a second bandit.** Shift traffic toward variants as
  evidence accumulates instead of a fixed even split. Reduces time‑to‑decision
  and revenue lost to serving losers.

### 4. Fewer, more distinct variants
- Default **3–4 variants** (configurable, with an in‑UI warning when raised —
  more arms slow convergence and inflate false positives).
- Bias generation toward **large structural differences** (different hero
  structure / offer framing / layout), not near‑identical copy tweaks —
  required evidence scales inversely with the square of effect size.

### 5. Honest expectations before starting
- Using the store's **measured visitor rate** (already captured by the
  storefront analytics, migration 0017), show a projection at configuration:
  *"At ~180 visitors/day, expect a result in about 3 weeks."*
- If traffic is too low to resolve, **say so and recommend waiting.** Never
  start a test that cannot conclude.

### 6. Honest numbers everywhere
- Show uplift **only once threshold is met**; before that, show the current
  posterior probability or an explicit "not yet conclusive" state.
- Every reported figure carries its interval: *"+2.7% uplift · 95% probability
  of being best · ±0.8%."* Publishing intervals is correct and a differentiator.
- If any frequentist comparison remains anywhere, apply a
  **multiple‑comparisons correction.**

### 7. Ship the winner
- Explicit **promote** action: apply the winning variant to the live store,
  with a **diff preview** of exactly what changes and **one‑step rollback**
  (leans on the existing design‑system patch + `apply-edit` machinery).
- **Auto‑promote** setting (promote on threshold, notify by email) — **off by
  default.** Autonomous changes to a live storefront must be opt‑in.

### 8. Actually evolutionary
- After each generation, breed new variants from the winners: **crossover**
  (recombine traits across the strongest performers — one variant's hero with
  another's palette/offer) **plus controlled mutation.** (Today's engine already
  mutates + breeds from survivors with elitism; v2 adds true two‑parent
  crossover.)
- Track **which traits correlate with performance**, not just which whole
  variants won.
- **Persist trait‑level learning per store**, so a merchant's second test starts
  smarter than their first. This compounding is the moat.

### 9. Cost model
- Once variants are AI‑generated and testing is continuous, the "deterministic,
  free" property no longer holds. Measure real **per‑generation and per‑cycle**
  cost from the AI usage ledger (the `finance_cost_per_action` report,
  migration 0021, already provides the shape). Report the gap vs credit pricing;
  **do not reprice** — present it. Flag whether **continuous mode needs its own
  credit treatment** separate from a one‑shot test.

---

## Data model sketch (all RLS, service‑role writes)
- `experiments` — store_id, status, threshold, variant_count, control_variant_id,
  started_at, decided_at, outcome.
- `experiment_variants` — experiment_id, traits/design snapshot, is_control.
- `variant_exposures` / `variant_conversions` — append‑only event counts feeding
  the posteriors (reuse the cookieless visit tracking pattern from 0017).
- `store_trait_performance` — per‑store, per‑trait rolling performance for
  cross‑test learning.

## Rollout notes
- v2 is a new **live mode**; the simulation stays as preview. No in‑flight tests
  exist today (the sim persists nothing), so there is no migration of running
  state — the first real experiment is the first row ever written.
- Gate live mode behind a plan/feature flag and the traffic precondition.

## Open commercial decisions (present with data, do not choose)
- Default **confidence threshold** (proposal: 95%).
- Default **variant count** (proposal: 3–4).
- **Auto‑promote** default (proposal: off).
- **Credit pricing** for continuous testing — decide after measuring real
  per‑cycle cost on live volume.

## Dependencies
- Real published‑store traffic (the precondition).
- Storefront analytics (migration 0017) — visitor + conversion signal. ✅ built.
- Decision Intelligence ε‑greedy engine (migration 0016) — the bandit. ✅ built.
- Design‑system patch + apply‑edit — to promote a winner to the live store. ✅ built.
- Product/variant generation — to render structurally distinct variants.
