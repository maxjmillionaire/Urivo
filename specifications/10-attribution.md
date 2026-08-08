# 10 — The Attribution Model

**Status: authoritative.** One model, used identically by the database, the API,
Ad Studio, the Command Center and every report. Where this document and the code
disagree, the code is wrong.

---

## 0. Why this document exists before the code

Attribution is the one subsystem where a bug does not look like a bug. It looks
like an answer. A merchant reads "this ad made €0", switches off an ad that was
profitable, and nothing in the system ever reports an error.

So the rules are decided here, in writing, once — not discovered later from
whatever the query happened to do.

### The governing principle

> **A measurement system must never silently under-report.**
> If attribution is impossible, say so. If it is partial, label it. If it is
> measured, prove it. A merchant must never make a spending decision on a number
> that is more confident than the evidence behind it.

Every rule below is downstream of that sentence. Where a rule costs us credited
revenue, that is the intended trade: an uncredited sale appears as *not
attributable*, never as a zero next to an ad's name.

---

## 1. Two domains that must never be blended

Urivo measures two different things that both get called "attribution". They
share no data, no identifiers and no reports, and conflating them would corrupt
both.

| | **Domain A — Urivo growth** | **Domain B — Merchant ads** |
|---|---|---|
| Question | Who brought this **merchant** to Urivo? | Which ad brought this **shopper** to the store? |
| Mechanism | Creator code at signup | `?uc=<creative_id>` on the storefront link |
| Subject | A named account holder | An anonymous visitor |
| Money | Subscription revenue to Urivo | Order revenue to the merchant |
| Payout | 25% of first payment to the creator | None — it is reporting |
| Spec | `specifications/8.md` (referrals) | This document |

**Creator codes have no effect on ad attribution, and ads have no effect on
creator commission.** A creator code is a fact about an Urivo account; an ad
click is a fact about a stranger visiting a shop. If a future feature needs to
relate them, it gets its own document and its own rule — it does not quietly
reuse either mechanism.

Everything below concerns **Domain B only.**

---

## 2. The identifier

**One first-party commerce session. No marketing identifier exists.**

| Property | Value | Why |
|---|---|---|
| Name | `urivo_cs` | Commerce session |
| Issued by | The server, on the storefront origin | Never generated or reachable by client script |
| Contents | Random UUIDv4 | No PII, no derived data, not a fingerprint |
| Flags | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` | Unreadable by JS, never sent cross-site |
| Lifetime | **7 days**, sliding | See §3 |
| Scope | One storefront origin | A shopper at two Urivo stores is two unrelated sessions |

### What we deliberately do not do

- **No `localStorage` attribution.** Readable by any script on the page,
  survives indefinitely, and is the standard building block of cross-site
  tracking. It is the wrong tool even when it is convenient.
- **No fingerprinting.** No IP matching, no user-agent matching, no
  screen/canvas/font signals. These would improve our numbers and are
  categorically off the table: an identifier the visitor cannot see, clear, or
  refuse is worse than a cookie, not better.
- **No third-party pixel, ever.** Not Meta's, not Google's, not our own on
  anyone else's site.
- **No identity graph.** We never link a shopper across stores, devices, or to
  an Urivo account.

### Legal posture

`urivo_cs` exists because a shop needs to know that the person who filled a cart
is the person who checks out. That is the textbook "strictly necessary"
purpose under §25(2) TTDSG, which is why generated storefronts carry no consent
banner.

Attribution does **not** justify this cookie and must never be used to argue for
extending it. Attribution is a *read* of a session the shop already required —
if the commerce need for the session disappears, the cookie goes with it, and
attribution loses its window rather than the cookie gaining a new purpose.

> **Open item for counsel.** The necessity argument above is the standard
> position for cart/checkout cookies and is the reason no banner is shown. It is
> an engineering position, not legal advice, and must be confirmed before
> merchants outside Urivo's own testing rely on it.

---

## 3. The attribution window

**7 days, click → order paid.**

Measured from the click that carried `?uc=`, to the moment the order reaches
`paid`. Not to checkout start — an abandoned checkout that completes on retry is
still one purchase decision (§9).

### Why 7 and not 30

| | 7 days | 30 days |
|---|---|---|
| Credited revenue | Lower | Higher |
| Causal strength | A purchase within a week plausibly follows the ad | A purchase 26 days later is weakly related to one click |
| Cookie lifetime needed | 7 days — defensible as cart continuity | 30 days — hard to call necessary for a cart |
| Matches | Meta's default click window | Google's default |

The deciding argument is the second row read together with §0. A longer window
mostly manufactures confidence: it moves revenue out of *not attributable* and
into an ad's column without producing any new evidence that the ad caused it.
Because coverage is always reported (§10), a shorter window costs the merchant
nothing in understanding — the revenue is still visible, just honestly labelled.

**This number is a policy, not a constant scattered through the code.** It lives
in one place and changing it re-runs reporting; it does not require a migration,
because raw click events are retained independently (§11).

---

## 4. First touch, and why the raw events are kept anyway

**Within the window, the earliest click that carried a `?uc=` wins.**

Last touch would hand nearly every sale to whatever retargeting ad ran
immediately before checkout. Retargeting intercepts people who had already
decided; crediting it is the most common way a small ad budget gets
misallocated toward the channel that did the least work.

First touch has the opposite bias — it over-credits the top of the funnel — and
we accept that bias knowingly, because our merchants run few ads and the
question they are actually asking is *"which ad introduced this customer"*.

### The architectural rule that matters more than the choice

> **Every click is stored as an event. The attribution rule is applied when the
> report is read, never when the data is written.**

The order row carries the decision for fast reporting, but it is derived, and it
can be recomputed. Moving to last-touch, position-based or time-decay later is a
query change against data we already have — not a migration, and not a year of
history thrown away. Any future model must preserve this property.

---

## 5. Precedence: what wins when several signals are present

Evaluated top to bottom; the first match decides.

| # | Signal | Result | Basis label |
|---|---|---|---|
| 1 | `?uc=` resolving to a creative of **this** store | Attributed to that ad | `creative` |
| 2 | `?uc=` present but unknown, malformed, or from another store | **Not attributed** | `none` |
| 3 | UTM parameters only | **Not attributed** to any ad; source recorded as context | `none` |
| 4 | Referrer only | **Not attributed**; host recorded as context | `none` |
| 5 | Nothing | Direct | `none` |

### Why UTM never attributes

`utm_source` and `utm_campaign` are free text written by whoever built the link.
Urivo cannot verify that `utm_source=meta` was a Meta ad, that it was this
merchant's, or that it corresponds to any ad we generated. Treating it as
attribution would import an unverified claim into a number we tell merchants to
trust.

UTMs are still stored and shown — as *traffic sources*, in a separate reading
from ad performance. A merchant's own newsletter is real traffic worth seeing;
it is simply not evidence about an ad.

### Why an unknown `?uc=` attributes to nothing

A creative id that does not resolve, or resolves to a different store, is
either a copy-paste error or someone probing. Guessing the "nearest" ad would
be inventing evidence. It records as direct traffic and is counted in the
denominator like everything else.

---

## 6. Repeat purchases are excluded from ad attribution

**A returning customer's order is labelled `returning` and never credited to an
ad**, even when the session is inside the window.

Detected by a prior `paid` order for the same store with the same normalised
customer email — data already processed to fulfil the order, and nothing new.

### Why this costs us a number and is still right

Crediting a repeat purchase to the ad that first found the customer inflates
that ad indefinitely: one good ad from March quietly absorbs a year of loyal
repeat revenue and looks unbeatable. Every subsequent budget decision is then
made against a number that is mostly not about advertising.

Excluding repeats gives the merchant the figure that actually governs ad
spending — **cost to acquire a new customer** — and reports returning revenue
separately, where it belongs, as a retention result rather than an ad result.

---

## 7. Cross-device is intentionally unsupported

Click on a phone, buy on a laptop → **not attributed**, labelled as such.

This is not a gap awaiting a fix. Closing it requires either a login before
purchase, or probabilistic identity matching — fingerprinting, IP clustering, or
an identity graph. §2 rules all of those out, and that ordering is deliberate:
we would rather report less than know more than a visitor agreed to.

**The merchant must be told this exists**, with an estimate of its size, so a
gap in the numbers reads as a known limit of honest measurement rather than a
malfunction. See §10.

---

## 8. Idempotency: every event may arrive more than once

Stripe delivers webhooks at least once, retries on any non-2xx, and may deliver
out of order. Nothing below may double count.

| Event | Rule |
|---|---|
| Click ping | Deduplicated per session+store; clicks count **distinct sessions**, never pageviews |
| Order attribution | **First write wins.** Attributing an order that already carries a decision is a no-op, not an overwrite |
| Order creation | Keyed on the Stripe session id (unique); a retry updates, never inserts a second order |
| Revenue | Summed from order rows, never from webhook events |

The first-write-wins rule matters beyond retries: it makes attribution stable.
A number that changes after the merchant has read it is worse than a number that
is slightly conservative.

---

## 9. Checkout interruptions and payment retries

One purchase decision produces one attributed order, however many attempts it
took.

- **Abandoned then resumed inside the window** → attributed normally. The
  session outlives the tab, so this is the ordinary path, not an edge case.
- **Card declined, retried, then succeeds** → one order, attributed once. The
  window is measured to the *successful* payment.
- **Resumed after the window closes** → not attributed, labelled. We do not
  extend the window to catch it; that would make the window meaningless.
- **Two separate purchases in one session** → both attributed to the same click.
  Two decisions, one introduction — correct, and stated so nobody reads it as
  double counting.

---

## 10. Refunds, and revenue that stays true

**Attributed revenue is always net of refunds.**

| Case | Order stays attributed? | Revenue effect |
|---|---|---|
| Full refund | Yes | Falls to zero |
| Partial refund | Yes | Reduced by the refunded amount |
| Chargeback | Yes | Treated as a full refund |

The order stays attributed because the ad did cause the purchase — that fact did
not change. But an ad's revenue figure must match money the merchant actually
kept, or it will be used to justify spend against income that was returned.

An ad can therefore show orders with near-zero revenue. That is a real and
useful signal: it usually means the ad is attracting the wrong buyer.

---

## 11. Retention and expiry

| Data | Lifetime | Reason |
|---|---|---|
| `urivo_cs` cookie | 7 days, sliding | The attribution window; nothing longer is needed |
| Click events | **90 days**, then deleted | 7-day window + reporting + dispute headroom, with margin for delayed webhooks |
| Attribution decision on an order | Permanent | A business record, and it is only a creative id — no personal data |
| Customer email on orders | Governed by commerce/tax retention, not this document | Attribution reads it; it does not extend its life |

Click events are deleted on a schedule, not "eventually". A retention period
that exists only in a document is not a retention period.

Note the deliberate asymmetry: click events outlive the window by a wide margin
so that a webhook delayed by hours or days still attributes correctly. This is
the concrete advantage of holding the window on the server instead of on the
device — a device that has cleared its storage has destroyed the evidence,
whereas our copy is still there.

---

## 12. Every case, and where it lands

Each row is **handled**, **intentionally unsupported and labelled**, or
**labelled as context**. Nothing is silent.

| Case | Outcome | Rule |
|---|---|---|
| Multiple tabs, one browser | Handled — one session | §2 |
| Return visit, same browser, inside 7 days | Handled | §3 |
| Return visit after 7 days | Unsupported — labelled *outside window* | §3 |
| Different browser, same device | Unsupported — labelled *not attributable* | §7 |
| Mobile → desktop | Unsupported — labelled *not attributable* | §7 |
| Private/incognito window | Unsupported — labelled | §7 |
| Cookies cleared mid-journey | Unsupported — labelled | §7 |
| Abandoned cart, resumed in window | Handled | §9 |
| Checkout interrupted, retried | Handled — one order | §9 |
| Stripe webhook delayed | Handled — events retained 90 days | §11 |
| Stripe webhook duplicated | Handled — first write wins | §8 |
| Payment retried after decline | Handled — one order | §9 |
| Refund, full or partial | Handled — revenue net | §10 |
| Chargeback | Handled — as full refund | §10 |
| Repeat purchase | Excluded — labelled *returning customer* | §6 |
| Two orders in one session | Both attributed — stated explicitly | §9 |
| Creator code present | No interaction — separate domain | §1 |
| UTM parameters only | Labelled as traffic source, not attribution | §5 |
| Unknown or foreign `?uc=` | Not attributed — counted as direct | §5 |
| Direct traffic | Not attributed — counted in denominator | §5 |
| Organic / referral traffic | Not attributed — host shown as context | §5 |
| Bot and preview traffic | Excluded from both numerator and denominator | §13 |

---

## 13. Bots, previews and the merchant's own visits

Excluded from **both** sides of every ratio, so they cannot flatter or depress a
rate:

- Known crawler user agents
- Link unfurlers (Slack, WhatsApp, Meta's own preview fetcher — which requests
  every URL pasted into an ad and would otherwise register as a click)
- The store owner previewing their own storefront while signed in

Meta's unfurler is the one that matters in practice: it hits the tracked link at
the moment the merchant creates the ad, before a single human sees it. Counting
it would give every new ad a phantom click on day zero.

---

## 14. What the merchant is always shown

No ad number is ever displayed alone. Every ad report carries, for the same
period:

1. **Attributed** — orders and revenue joined to a specific ad
2. **Not attributable** — real revenue we cannot honestly assign, split by
   reason (returning customer · outside window · no tracked link · cross-device)
3. **Coverage** — attributed as a share of the total

Coverage is the number that makes the rest trustworthy. A merchant seeing
*"€258 attributed · €340 not attributable · 43% coverage"* reasons correctly. A
merchant seeing *"€258"* concludes their ads produced €258 and is wrong by more
than half.

No advertising platform reports its own blind spots. That is the point: it is
the difference between a dashboard that is confident and one that is right.

---

## 15. Implementation status

This document is the target, not a description of what ships today. Read it as
a specification; the gaps below are real and named so nobody mistakes the two.

| § | Rule | Today |
|---|---|---|
| 2 | Server-issued `urivo_cs` cookie | **Not built.** The session id is client-generated in `sessionStorage` and dies with the tab |
| 3 | 7-day window | **Not built.** The effective window is one browser tab |
| 4 | First touch | Built |
| 4 | Click events kept as events | Partial — `store_visits` holds them; retention is unbounded |
| 5 | `?uc=` validated against **this** store | **Not built.** A foreign creative id currently attributes |
| 6 | Repeat purchases excluded | **Not built.** A repeat purchase in-session attributes to the ad |
| 8 | First write wins | **Not built.** `attribute_order` overwrites on re-run |
| 10 | Revenue net of refunds | Partial — full refunds drop out via status; partial refunds do not reduce revenue |
| 11 | 90-day click retention | **Not built.** Nothing is deleted |
| 13 | Bots and unfurlers excluded | **Not built.** Meta's preview fetch counts as a click |
| 14 | Coverage shown with every metric | **Not built.** Ad numbers are shown alone |

The most consequential gaps are §2/§3 (attribution ends when the tab closes,
under-reporting every considered purchase) and §13 (every new ad gets a phantom
click the moment its link is pasted into Meta).

---

## 16. Invariants

Regressions here are silent by nature, so these are enforced by tests, not by
review.

1. An order is never attributed to a creative belonging to another store.
2. An order's attribution never changes once written.
3. Attributed revenue never exceeds the order's net total.
4. The sum of attributed and not-attributable revenue equals total paid revenue
   for the period — no revenue may go missing between the two.
5. Clicks count distinct sessions; pageviews never inflate them.
6. Every displayed ad metric has a stated coverage figure.
7. No attribution path reads any client-supplied identifier as authoritative.
8. Click events older than the retention period do not exist.
