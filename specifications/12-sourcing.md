# 12 — AI Product Discovery & Supplier Intelligence

**Status: SPECIFIED — NOT BUILT.**

Nothing in this document is active. `lib/suppliers/` exists but is dormant and
unreferenced; no route, page, cron or migration in this repository connects to
it, and this specification does not change that. It is the product decision
record for the first post-launch project, written while the analysis was fresh
rather than reconstructed later.

The supplier system will be activated only after the real-world Urivo product
validation and launch.

One finding reframes the whole document, so it goes first.

---

# Part I — What actually exists

## 1. The headline: this is not a design from zero

`lib/suppliers/` already contains a complete, coherent implementation of most of
what this specification is being asked to define:

| File | Lines | What it already does |
|---|---|---|
| `types.ts` | 251 | The full canonical domain + the 8-method `SupplierProvider` contract, including `createOrder` / `getOrder` |
| `registry.ts` | 52 | Provider resolution; `autods` wired, 6 more declared as "one file + one line" |
| `providers/autods.ts` | 252 | A real HTTP client — all 8 contract methods implemented against `platform-api.autods.com/v1` |
| `scoring.ts` | 222 | The Urivo Score: 0–100, 5 weighted signals, explainable breakdown, confidence |
| `intelligence.ts` | 109 | Merchant Intelligence: outcome recording + learned-signal aggregation |
| `import.ts` | 217 | Connections, `suggestProducts`, `importProducts`, EUR normalisation |
| `autopilot.ts` | 332 | `autoSourceStore()` — generate → source → price → publish, end to end |

Migrations `0014_suppliers.sql` (connections + `product_sources`) and
`0015_merchant_intelligence.sql` (`product_outcomes`) are applied.

## 2. And it is completely disconnected

```
grep -rn "suppliers/" app lib components --include=*.ts --include=*.tsx | grep -v "^lib/suppliers/"
→ (no output)
```

Zero imports. No API route, no page, no cron, no button. `README.md` in that
directory says *"DORMANT (not wired into the product). Status: shelved."* It is
an island with a bridge that was never built.

**So this specification is not "design a sourcing system". It is "finish, verify
and connect one that is 80% written and 0% proven."** That is a materially
different — and cheaper — project, and it also carries a specific danger: code
that has never run looks finished.

## 3. What Urivo can do today, precisely

| Capability | Status |
|---|---|
| **A — Ideate** products for a niche (AI invents a catalogue) | ✅ Live, in the store generator |
| **B — Discover** real products that exist and sell | ⚪ Code exists, unreachable |
| **C — Source** them from a supplier at a real cost | ⚪ Code exists, unreachable |
| **D — Fulfil** orders to the supplier automatically | ⚪ Contract exists, never executed |

**No.** If a merchant gives Urivo an idea today, Urivo produces *product
concepts* — invented names, invented descriptions, invented prices, AI images.
It cannot name a real product from a real supplier at a real cost. Every
generated store is currently a beautiful shop with no goods behind the counter.

## 4. The gap that matters commercially

A merchant who pays €49 and receives a store full of products they cannot buy
has not received a business. They have received a mockup. The generated
catalogue is currently a *shopping list*, and the merchant is left to fill it
manually — which is exactly the work they paid to avoid.

`autopilot.ts` states this in its own header: it takes the generated catalogue
"whose AI-invented catalogue is the shopping list" and "turns it into a REAL
business". The intent was always this. It was shelved, not abandoned.

## 5. Three things in the existing code that are already right

These do not need redesigning, and this specification adopts them as fixed:

1. **Provider-agnostic by contract.** Nothing outside `registry.ts` knows a
   vendor name. Adding CJ or Printful is one file plus one line. This survives a
   supplier going hostile, changing pricing, or dying.
2. **Missing data is not punished, it is *reported*.** `scoring.ts` redistributes
   the weight of absent signals and exposes `confidence: 0–1` — "the fraction of
   signal weight actually backed by data". This is structurally the same honesty
   device as the attribution coverage buckets in specification 10. Two
   independent subsystems arriving at the same shape is a good sign it is the
   right shape.
3. **Declining is a supported outcome.** `autopilot.ts` returns `ran: false` with
   a reason (`not_connected`, `insufficient_matches`, `store_not_found`) and
   keeps the generated catalogue rather than shipping a weak store. A sourcing
   engine that always finds something is lying.

## 6. Three things in the existing code that are wrong or unproven

1. **Credentials are stored in plaintext.** `0014_suppliers.sql` says so in its
   own comment: *"Encrypt at rest with pgcrypto/Vault before storing real
   production keys — tracked as a hardening step."* Today the table is empty, so
   nothing is exposed. The moment a merchant connects a supplier, Urivo holds a
   live API key — one capable of *placing orders and spending their money* — in a
   `jsonb` column. **This is a hard prerequisite, not a phase.**
2. **`unique (product_id)` on `product_sources`.** One product may have exactly
   one source. There is no failover when a supplier discontinues an item, and no
   price comparison across suppliers for the same product. Acceptable for v1, but
   it is a schema decision that gets expensive to reverse once there is data.
3. **The AutoDS client has never been executed against the real service.** All 8
   methods are written; none has seen a real response. Field names, pagination,
   rate limits, error shapes and auth flow are *assumptions*. This is the single
   largest unknown in the project.

## 7. What is genuinely missing (not merely disconnected)

- Every API route and every UI surface.
- Inventory/price sync scheduling (the provider methods exist; nothing calls them
  on a timer).
- Order forwarding on payment (the webhook does not know suppliers exist).
- Tracking-number propagation back to the shopper.
- Supplier-cost → profit reporting in the finance views.
- Any test that touches a real supplier.

## 8. Honest scope statement

Roughly: **~70% of the engine, ~0% of the product.** The remaining 30% of the
engine is where all the risk lives, because it is the part that touches other
people's money.

---

# Part II — The product

## 9. The promise

> Describe a business. Urivo finds real products from real suppliers, tells you
> which ones are worth selling and why, builds the store around them, and
> forwards every order automatically.

Not "AI generates a store". **"AI starts your business."**

## 10. Positioning

Shopify gives you a shop and leaves sourcing to you. AutoDS/Spocket give you a
catalogue and leave the business to you. Urivo is the only layer that goes
**idea → validated product → store → order → fulfilment** without the merchant
switching tools. That is the whole thesis of a Commerce OS, and without sourcing,
Urivo is on the Shopify side of that line.

## 11. Primary journey — Autopilot ("Generate → Done")

```
niche prompt
   → store generated (as today)
   → "Source real products"
   → supplier search per intended product
   → Urivo Score each candidate
   → best above threshold chosen
   → placeholders replaced with real products
   → copy rewritten on-brand
   → margin-aware pricing
   → collections grouped
   → decision report: what was chosen, and why
```

`autoSourceStore()` already implements this shape with defaults
`targetCount: 8`, `minScore: 55`, `targetMarginPct: 0.65`, `minMarginPct: 0.45`.

## 12. Secondary journey — Discovery (browse)

A merchant who wants control searches the catalogue directly, sorted by Urivo
Score rather than by vendor relevance. Every card shows score, stars, margin,
shipping window, and the top reasons. `import.ts::suggestProducts` already
returns `ScoredSuggestion`.

## 13. Tertiary journey — Replace

"This product isn't selling." Urivo proposes a better-scoring alternative in the
same collection, at a comparable price point, and explains the swap. This is
where Merchant Intelligence pays off and where Evolution Lab and sourcing meet.

## 14. The decision report is the product

The score is not the deliverable — the *defensible reason* is. A merchant must be
able to read: "68/100. 71% margin at €24.90. Ships from Poland in 4–7 days.
Supplier rated 4.6. Refund rate unknown." and then disagree with it.

## 15. Non-goals for v1

No supplier price negotiation. No private-label / custom manufacturing. No
multi-supplier failover per product. No warehouse or 3PL integration. No
customs/duty calculation. No supplier-side inventory reservation.

## 16. What a merchant must never be told

- A margin computed from a `suggestedRetail` the vendor invented.
- A shipping estimate presented as a delivery guarantee.
- A score whose confidence is low, shown without its confidence.
- "In stock" from a cache older than the sync interval.

## 17. Plan gating

| Plan | Sourcing |
|---|---|
| Free | Discovery browsing + scores; no import |
| Founder €49 | Autopilot + import + order forwarding, one supplier connection |
| Pro €199 | Multiple connections, replace suggestions, full Merchant Intelligence, priority sync |

This makes sourcing the strongest single reason to upgrade from Free — which is
exactly what the 500–1,000 subscriber target needs.

---

# Part III — The engine

## 18. The Urivo Score (as implemented, kept)

```
margin   0.30   shipping 0.25   trust 0.20   refunds 0.15   trend 0.10
```

Weighted sum of present signals; absent signals contribute a neutral value and
are excluded from `confidence`. EU-origin shipping is explicitly favoured (there
is an EU country set in the code) — correct for a German-founded platform selling
into the EU.

## 19. Score honesty rules

- `confidence < 0.5` must be visible in the UI, not buried in a tooltip.
- A score built on two signals and a score built on five are not comparable and
  must not be ranked against each other without showing both confidences.
- Never round a 41 to "solid". The label follows the number, not the sale.

## 20. Merchant Intelligence — the moat

`intelligence.ts` records six outcome types: `import`, `impression`, `order`,
`refund`, `removal`, `repeat`. Aggregated anonymously across every Urivo merchant
selling the same external product, these become `LearnedSignals` with a
`sampleSize` that drives confidence.

The important one is **`removalRatePct`** — the percentage of merchants who
imported a product and then deleted it. No public marketplace metric captures
buyer's remorse at the merchant level. AutoDS cannot compute it. Shopify cannot
compute it. Urivo can, because it sees the whole lifecycle.

## 21. The intelligence transition

As `sampleSize` grows, learned signals progressively override public ones: the
score evolves from *estimated from vendor metrics* to *measured from real
results*. `types.ts` already documents this. The transition must be visible to
the merchant ("based on 340 orders across Urivo" vs "based on supplier metrics
only").

## 22. Cold start

With zero install base, learned signals are empty and the score is purely
public-metric-driven at confidence ~0.6. This is honest and still useful — but it
means **the moat does not exist on launch day and must not be marketed as if it
does.**

## 23. Privacy constraint on intelligence

Aggregates only. Never expose one merchant's performance to another, never a
per-store figure, never a number derived from a sample small enough to identify a
single store. Minimum sample threshold before any learned signal is surfaced:
**5 distinct merchants**. Below that, the signal exists internally but is not
shown or scored.

## 24. Provider strategy

Ship with **AutoDS only** (already written). Add **CJ Dropshipping** second
(largest independent catalogue, real API), **Printful** third (print-on-demand
widens the addressable niche set enormously and has excellent EU fulfilment).
Each is one file plus one registry line.

## 25. Credentials — the blocking prerequisite

Before any merchant connects anything:

- Encrypt `supplier_connections.credentials` at rest (pgcrypto with a key held
  outside the database, or Supabase Vault).
- Service-role access only, as today. No RLS policy that would let a client read
  it, ever.
- Never log credentials, never include them in error payloads, never return them
  from an API route — surface *status* only.
- Credential rotation and explicit disconnect must wipe, not soft-delete.

## 26. Rate limits and cost of search

Autopilot for one store issues one supplier search per intended product (8 by
default) plus detail fetches. Multiply by concurrent generations. Requirements:
per-connection rate limiting, result caching keyed on the normalised query, and a
hard cap on searches per autopilot run. A rate-limited supplier must degrade to
"sourced 5 of 8" — never to a fabricated product.

## 27. Sync

| Job | Interval | Failure behaviour |
|---|---|---|
| Inventory | hourly for published stores | mark `sync_status='stale'`, keep last known, warn merchant after 24h |
| Pricing | daily | never silently re-price the storefront; propose, require confirmation above a threshold |
| Orders | every 15 min while any order is `placed`/`processing` | retry with backoff, escalate to merchant after 3 failures |

`product_sources.sync_status` already has exactly these states:
`synced | stale | out_of_stock | error`.

---

# Part IV — Money, data, law

## 28. The margin definition

`marginPct(cost, retail)` exists. It must be computed on **landed cost** —
supplier cost **plus shipping** — not on item cost alone, or every margin shown
is optimistic by 15–40%. This is the single most likely way this feature quietly
lies to merchants.

## 29. Currency

Supplier costs arrive in USD/CNY; Urivo accounts in EUR (`toEur`). FX moves. A
margin computed at import and never recomputed will drift. Store both original
and EUR (the schema already does) and recompute margin on every price sync.

## 30. Pricing policy

Autopilot targets 65% margin, floors at 45%. Prices must be psychologically
rounded (€24.90, not €24.37) and must never be set below the floor to hit a
target count — declining is better.

## 31. Order forwarding

On `payment_intent.succeeded`, for each line with a `product_sources` row: place
a supplier order via `createOrder`, store the external order id, poll `getOrder`
for tracking. **The merchant's Stripe money has already moved.** A failed
supplier order is therefore a customer-facing incident, not a background error:
it must alert the merchant immediately with the order id, the failure reason, and
a manual-fulfil path.

## 32. Failure semantics, in the language of specification 10

> Sourcing may fail without breaking commerce, but sourcing failure must never
> become invisible.

Concretely: a supplier outage must not block checkout, must not silently cancel,
must not mark an order fulfilled, and must appear in the merchant's dashboard
within one sync cycle.

## 33. Refunds and returns

Dropship returns are the hardest part of this business and Urivo v1 does not
solve them. It must therefore *not imply* that it does. The merchant is told
plainly at connect time: returns are handled between the merchant and the
supplier; Urivo records the refund and feeds it into intelligence.

## 34. Legal (EU/Germany)

Selling third-party goods makes the merchant the seller of record: GPSR
product-safety information, Impressum, right of withdrawal, delivery-time
disclosure. If Urivo imports a product, Urivo must import or require the
safety/origin fields where the supplier exposes them, and must surface honest
delivery windows on the product page — a 4–7 day estimate presented as a fact
when the supplier ships from China is a legal exposure, not a UX detail.

## 35. Data model additions

Minimal, on top of what exists:

- `supplier_connections.credentials_encrypted` (replacing plaintext).
- `product_sources`: `landed_cost_eur`, `shipping_cost_eur`,
  `last_price_change_at`.
- `supplier_orders`: urivo order line → external order id, status, tracking,
  attempts, last error.
- `product_outcomes` already exists (0015) — extend with `niche` for
  `nicheFitScore`.

---

# Part V — Rollout

## 36. Phases

| Phase | Scope | Proves |
|---|---|---|
| **0** | Credential encryption + one real AutoDS sandbox call | The client actually works |
| **1** | Connect UI + Discovery browse + scores (read-only) | Value visible before any risk |
| **2** | Import into a store, `product_sources` written | Catalogue becomes real |
| **3** | Autopilot wired to store generation | The headline promise |
| **4** | Inventory + price sync | The store stays true |
| **5** | Order forwarding + tracking | The business runs itself |
| **6** | Merchant Intelligence surfaced | The moat |

Phases 1 and 2 are shippable value on their own. Nothing before Phase 5 can lose
a merchant money.

## 37. The verification rule this project inherits

Every phase in this specification is judged by a real call to a real supplier,
not by a passing test against a fixture. The recurring failure in this codebase
has been code that looked finished and had never executed — the `attribute_order`
enum cast, the missing `"use client"`, the AutoDS client itself. **A mock that
asserts its own fixture proves nothing here.**

## 38. Acceptance for the headline claim

One niche prompt → generated store → autopilot → at least 6 real products with
real supplier ids, real costs, ≥45% landed margin, and a decision report a
merchant can argue with. Then one real test purchase forwarded to the supplier
and tracked to a tracking number.

Until that has happened once, end to end, the feature is not built.

## 39. Metrics

Sourcing attach rate (stores that source / stores generated), autopilot
completion rate, decline reasons distribution, score-vs-outcome correlation after
90 days, removal rate, supplier order success rate.

The one that matters: **does a sourced store convert better than an ideated
one?** If not, the whole thesis is wrong and we should know within a quarter.

## 40. Risks, ranked

1. **AutoDS API assumptions are wrong** → the whole Phase 0 exists to find this
   out in a day, not a month.
2. **Supplier dependency** → mitigated by the provider contract; the second
   provider should land sooner than feels necessary.
3. **Merchant loses money on a failed fulfilment** → Phase 5 is gated behind
   alerting, not behind a feature flag.
4. **Cold-start scores look generic** → say so, do not dress it up.
5. **Scope creep into a full ERP** → §15 non-goals are binding.

## 41. Cost

Supplier APIs are typically free to the account holder — the merchant supplies
their own key, so Urivo carries no per-search vendor cost. Marginal cost is
compute plus the existing AI credits for copy rewriting, which autopilot already
routes through `optimizeProductCopy`. **This feature does not raise the fixed
monthly cost base.**

## 42. Relationship to the launch

Nothing in this document ships before launch. The launch branch, the store
generator and the dormant layer stay untouched. This is the first
post-validation project.

## 43. Sequencing against Voice

**Sourcing first, unambiguously.** Voice makes Urivo more pleasant. Sourcing
makes Urivo complete. Voice amplifies answers; if the store behind those answers
has no real products, voice amplifies a gap. Specification 11 §0 already makes
Ask Urivo's own validation a precondition — sourcing is what makes that
validation worth doing.

## 44. Prerequisite that outranks both

The one complete real-world product validation that is currently paused. Do not
activate sourcing against an unvalidated generator: if the generated catalogue is
weak, autopilot will faithfully source weak products and the failure will be
blamed on sourcing.

## 45. Success condition

> A merchant describes a business they have never run, and forty minutes later a
> real customer can buy a real product that a real supplier ships — without the
> merchant having sourced anything.

That is the sentence this project either delivers or does not.

---

## Direct answers

- **Can Urivo find a real product from a real supplier today?** No. It generates
  concepts. (§3)
- **Is the supplier layer usable?** The engine largely is; the product entirely
  is not. ~70% engine, 0% product, and the unproven 30% is the part that spends
  money. (§8)
- **Build or activate?** Activate and finish. Designing from scratch would
  discard a correct architecture that already exists. (§1)
- **Biggest unknown?** The AutoDS client has never made a real call. One day of
  Phase 0 answers it. (§6)
- **Biggest danger?** Plaintext supplier credentials that can place orders.
  Blocking prerequisite. (§25)
- **Sourcing or Voice next?** Sourcing. (§43)
- **Before either?** The paused real-world validation. (§44)
