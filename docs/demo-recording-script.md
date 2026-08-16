# Urivo — 30-second demo recording script

For a founder recording on a Mac. Real UI only. Nothing in this document asks
you to show a screen that does not exist or data that is not really there.

---

## What this script is based on

`urivo.ai` is not purchased or connected yet, so there was no running
application to drive. This script is derived from two sources, and it is worth
knowing which is which before you trust a frame of it.

**Screens I inspected as real, rendered captures** (`screenshots/`, captured
from the running app against the live Supabase project):

| Screen | File |
| --- | --- |
| Command Center (merchant home) | `desktop-03-dashboard.png` |
| Store editor | `desktop-04-store-editor.png` |
| Billing | `desktop-06-billing.png` |
| Evolution Lab | `desktop-09-evolution.png` |
| Generated storefront — Lumen Skin | `desktop-14-storefront-light.png` |

**Screens I did NOT open** — they exist and are captured, but every claim I make
about them below is inferred from the route and component code, not seen:
login (`desktop-02-login.png`), Research (`07`), Ad Studio (`08`), the dark
storefront (`16`), the storefront product page (`15`), Settings, Notifications.

Re-check the login frame yourself before you record it — it is your opening
shot and it is the one beat in the sequence I have not actually looked at.

---

## Two things that change what is recordable

Read these before planning the shoot. Both are real and neither is cosmetic.

### 1. There is no Emails screen

The storyboard asks for Login → Home → Stores → Evolution Lab → **Emails** →
Billing → Ask Urivo. There is no Emails screen in the product. The sidebar is
exactly six rows — Home, Research, Stores, Ad Studio, Evolution Lab, Billing —
plus Support and Settings pinned at the bottom
(`app/(platform)/dashboard/_shell/app-sidebar.tsx`).

`store_subscribers` exists as a database table with RLS policies, and nothing in
the application reads it. There is no subscriber list, no campaign composer, no
email screen of any kind. The nearest real thing is the merchant notification
feed (`desktop-11-notifications.png`), which is in-app alerts, not email — do
not label it Emails on camera.

I have dropped the beat rather than substitute something and imply it is email
marketing. That also buys back roughly four seconds, which the sequence needs.

### 2. Products have no photography, and the UI says so out loud

`HIGGSFIELD_API_KEY` is not configured, so every product image renders as the
branded fallback. This is not subtle at 4K:

- On the **storefront**, the collection grid is four near-blank panels with
  faint monograms — `TM`, `BC`, `NR`, `TC`.
- In the **store editor**, every product row shows an empty image placeholder
  with a gold `Generate` link under it.
- The editor's own SEO panel prints **"Product imagery — 4 products without an
  image"** as an amber warning.

So: **do not linger on any product grid, and do not scroll the store editor's
product table on camera.** The script below is built around this — it favours
storefront hero typography, which is genuinely beautiful, over catalogue shots,
which currently read as unfinished.

If you can configure Higgsfield before recording, do that first and re-shoot
beats 3 and 7 with real photography. The close gets dramatically stronger, and
this constraint disappears.

---

## Capture setup

**Record at 3840×2160 (16:9), then deliver 4K.** The app's captured desktop
viewport is 1512×950, which is 1.59:1 — narrower than 16:9. Do not stretch it.

- Set the Mac display to **3840×2160** (or a 1920×1080 logical resolution at 2×
  on a 4K/5K panel — this gives true 4K pixels with UI at a legible size).
- **Browser window: exactly 1920×1080 logical, centred, in fullscreen with no
  browser chrome.** In Chrome, `⌘⇧F` for fullscreen, or use a window manager to
  pin 1920×1080. At 2× that captures as 3840×2160 with no scaling.
- Capture with **ScreenFlow, CleanShot X, or QuickTime** at **60 fps**. 60 fps
  matters: the sidebar hover states, the Evolution Lab animation and the scroll
  reveals are all motion, and 30 fps will judder them.
- **Hide the cursor's click rings** unless your tool draws a subtle one — a
  large animated click halo looks like a tutorial, not a product film.
- Disable notifications (**Focus → Do Not Disturb**), hide the Dock (`⌘⌥D`),
  and hide the menu bar (System Settings → Control Centre → Automatically hide).
- Use a **Pro plan demo account**. The captured account shows `Demo Merchant ·
  Pro plan` with 453 credits and three stores, which is the state everything
  below assumes.

**Colour:** the product is a dark UI with gold accents on near-black
(`desktop-03`). Record in **P3** if your tool offers it and deliver sRGB — the
gold gradient on the primary buttons banks badly if you capture in 8-bit sRGB
and re-grade later.

---

## What must not be on screen

Check every one of these before you hit record. Several are visible in the
existing captures.

- **The URL bar.** Record fullscreen. It leaks the Supabase project ref on any
  redirect and the `?code=` auth parameter after login.
- **Any Stripe identifier** — `acct_…`, `cs_…`, `sub_…`. The Billing screen's
  "Manage subscription" button opens the **Stripe billing portal**, which is a
  Stripe-branded page on `billing.stripe.com`. Do not click it. Stop at the
  Urivo-side card.
- **Real customer email addresses.** The store Orders screen
  (`desktop-05-store-orders.png`) lists `customer_email` per order. That is
  third-party personal data under GDPR and you are publishing it. Either skip
  the Orders screen — the script below does — or blur the column in post.
- **The Activity feed's order amounts**, if any of those orders are real
  people's purchases. On the demo account they are seeded, so this is fine;
  on a real account it is not.
- **Settings** — it shows the account email address.
- **Admin screens** (`/admin/finance`, `/admin/referrals`). These show platform
  unit economics, real inference spend and creator payouts. Never on camera.
- **DevTools, the terminal, your password manager, and the second monitor.**

One honesty note that is not about secrets: the Evolution Lab labels itself
`SIMULATION PREVIEW` and prints *"Scores are a fitness model, not measured
conversion."* **Keep that badge and that footnote in frame.** Cropping them
turns a labelled simulation into an implied performance claim, and that is the
one shot in this film that could be called a lie.

---

## The sequence — 30 seconds

Timings are cumulative. Cursor notes assume you move deliberately: **every
cursor move should take 300–400ms and ease out.** Never snap the pointer, never
move it while nothing is happening, and park it off to the side during holds.

---

### 0:00 – 0:02 · Sign in *(2s)*

*Not inspected — verify the frame before shooting.*

Open on the login card with the **email and password already filled**. Do not
type credentials on camera.

- Cursor is already resting on the submit button when the recording starts.
- **0:00.5** — single click.
- Hold through the transition into the dashboard.

Two seconds. The only job of this beat is to establish that this is a real
product you sign in to. Do not let it run longer — a login form is the least
interesting frame in the film.

> If the redirect exposes a `?code=` parameter or flashes a loading shell, cut
> this beat entirely and open cold on the Command Center. The film loses
> nothing.

---

### 0:02 – 0:08 · Command Center *(6s — the anchor shot)*

**This is the strongest screen in the product.** Give it the most time.

The frame lands on `Good evening, Demo.` with `You have 3 AI recommendations
waiting.`, the gold **Generate store** button top right, the Ask Urivo card, the
KPI row, and — the thing that actually sells it — the **Live Preview rail** down
the right-hand side, showing a real rendered storefront inside browser chrome
with a green `● LIVE` pill.

- **0:02 – 0:04** — hold completely still. Let the viewer read the greeting and
  register the live preview on the right. No cursor movement at all.
- **0:04 – 0:06** — drift the cursor slowly left-to-right across the KPI row.
  Do not click. Stop on **`AI CREDITS 453`**.
- **0:06 – 0:08** — move to the Live Preview rail and hover **Manage**. Do not
  click yet.

**Which numbers to favour, and which to avoid.** The captured demo account shows
`REVENUE TODAY €0`, `ORDERS TODAY 0`, `CONVERSION 0.0%` and `VISITORS TODAY 28`
with a red `↘ 26%`. That row is four weak numbers and one negative trend, and at
4K they are all legible. The strong tiles are **`AVG ORDER VALUE €55.33`**,
**`LIVE STORES 2`** and **`AI CREDITS 453`** — frame the drift so the cursor
draws the eye along the second row, not the first.

> **Worth doing before you record:** seed the demo account so revenue, orders
> and conversion are non-zero. A Command Center showing €0 revenue and 0.0%
> conversion is an honest screenshot of an empty account, and it is the first
> thing a viewer sees. Real seeded numbers change this shot more than any
> camera move will.

---

### 0:08 – 0:12 · Stores — the store editor *(4s)*

- **0:08** — click **Manage** in the Live Preview rail. It lands on the store
  editor for that store.
- **0:08 – 0:10** — hold on the top of the page: `STOREFRONT / Lumen Skin`, the
  subdomain `lumen-skin.urivo.ai`, the three palette swatches, `Edit design`.
- **0:10 – 0:12** — cursor down to the **BRAND NAME** block and rest beside
  **`lumenskin.ai is available · +3 more`**.

That green availability line is the beat. It says the platform checked a real
domain registry for a brand it invented, which no store builder does, and it
takes one second to read.

**Do not scroll further.** The products table is directly below and every row
has an empty image placeholder and a `Generate` link. Stop above it.

---

### 0:12 – 0:17 · Evolution Lab *(5s — the differentiator)*

- **0:12** — click **Evolution Lab** in the sidebar.
- **0:12 – 0:13.5** — hold. The headline reads *"Watch intelligence evolve your
  store."* and the empty state reads *"One hundred storefronts enter. Only the
  strongest survives. Press start and watch it evolve."* The prompt field is
  pre-filled with `A minimalist Scandinavian home fragrance brand`.
- **0:13.5** — click the gold **Start evolution**.
- **0:13.5 – 0:17** — hands off. Let the simulation run and do not touch the
  cursor. Park it outside the panel.

Keep the `ADVANCED` and `SIMULATION PREVIEW` badges and the footnote in frame,
as above.

This is the most cinematic screen in the product — it is the only one with
sustained generative motion, and it is the only feature here that has no
equivalent on Shopify. If any beat deserves an extra second stolen from
elsewhere, it is this one.

> Time the animation before you shoot. If a full generation run is longer than
> 3.5 seconds, either let it play out and take the time from Billing, or cut on
> motion mid-run — a hard cut while the thing is visibly working reads as
> confidence, and a cut the instant it finishes reads as a stopwatch.

---

### 0:17 – 0:21 · Billing *(4s)*

- **0:17** — click **Billing** in the sidebar.
- **0:17 – 0:19** — hold on the top cards: `CURRENT PLAN — Pro`, the subtitle
  **"Founding member — lifetime price, locked forever"**, and `CREDITS 453`.
  That founding-member line is a scarcity beat and it is real.
- **0:19 – 0:21** — scroll down smoothly to **Credit history** and stop with the
  table filling the frame.

The credit history is the quiet proof shot. It reads `Store generation —
Nordwerk −20`, `Market research −3`, `Ad Studio −3`, `Ask Urivo −1`,
`Pro plan — monthly credits +500`. That ledger is the whole product doing real
work, itemised, in one table.

**Two things to avoid on this screen.** Do not stop on the amber
`PAYOUTS · NOT SET UP` card near the top — scroll past it in one motion; it is
an unfinished-setup warning and it is the weakest element on the page. And do
not click **Manage subscription**: it leaves for Stripe.

> The `Buy credits` row (Boost €19 / Studio €49 / Scale €99) is between the two
> holds. Letting it pass through frame during the scroll is good — pricing that
> appears in passing reads as confident. Stopping on it turns the film into a
> pricing page.

---

### 0:21 – 0:27 · Ask Urivo *(6s — the payoff)*

Use the **Ask Urivo panel in the right-hand rail**, not the card on the home
page. The rail sits beside the live preview, which is what makes the point: you
ask, and the thing you are looking at changes.

- **0:21** — click back to **Home**.
- **0:21 – 0:22** — click one of the rail's suggestion chips —
  **`Warm up the palette`** or **`Rewrite my hero headline`**. Use a chip rather
  than typing: typing burns two seconds and risks a typo on camera.
- **0:22 – 0:27** — hold on the response. The panel's own copy sets the
  expectation: *"Ask for a change and I'll propose it — copy, palette, fonts,
  layout, products. You approve before it goes live."*

**This beat depends on live model latency and it is the only real risk in the
shoot.** Plan for it:

- Run the same prompt once before recording to warm the path.
- Record this beat **two or three times separately** and pick the fastest take.
- If the response is slower than ~5s, **speed-ramp the wait to 2× in post** and
  keep the arrival at 1×. Ramping a wait is fair; cutting to a response that
  never arrived in that take is not.
- Have a fallback: if it will not come in under six seconds, drop this beat to
  4s showing only the proposal arriving, and give the two seconds to the close.

The `1 credit · 453 left` line under the input is worth having in frame. It is
honest pricing, visible at the moment of use.

---

### 0:27 – 0:30 · Close on the storefront *(3s)*

Cut — do not navigate — to a **full-bleed generated storefront**, scrolled to
the hero and nothing below it.

Use **Lumen Skin** (`desktop-14`): warm off-white ground, a large serif
`Lumen Skin` wordmark, the line *"Skincare for people who don't like
skincare."*, and a brown `SHOP THE COLLECTION` button. It is the best-looking
frame the platform produces.

- Hold completely still for the full three seconds. No cursor in frame — move
  the pointer off-screen before the cut.
- **Stay above the fold.** The collection grid with the four blank product
  panels begins immediately below. Do not scroll.

**The strongest possible close, if you can shoot it:** hold Lumen Skin for
1.5s, then hard-cut to the **Nordwerk** storefront (`desktop-16`) — dark,
industrial, completely different type and palette — for the final 1.5s. Same
platform, same one-sentence input format, two brands with nothing visually in
common. That contrast is the argument against templates, and it lands in three
seconds with no narration.

Both hero frames are clean of the imagery problem. It is only the grids below
that are empty.

---

## Summary

| Time | Beat | Screen | Action |
| --- | --- | --- | --- |
| 0:00–0:02 | Sign in | Login | One click, pre-filled |
| 0:02–0:08 | **Anchor** | Command Center | Hold, drift across KPIs, hover Manage |
| 0:08–0:12 | Stores | Store editor | Hold on brand + domain availability |
| 0:12–0:17 | **Differentiator** | Evolution Lab | Click Start, hands off |
| 0:17–0:21 | Proof | Billing | Plan, then scroll to credit history |
| 0:21–0:27 | **Payoff** | Ask Urivo rail | Click chip, hold on response |
| 0:27–0:30 | **Close** | Storefront hero | Full-bleed, still, no cursor |

Dropped: **Emails** (does not exist). Deliberately skipped: Orders (customer
email addresses), Research and Ad Studio (no room in 30s), Settings (account
email), product grids (no photography).

---

## If you get more than 30 seconds

At **45 seconds**, in priority order:

1. **+5s to Ask Urivo**, taking it through to applying the change and the live
   preview updating. That is the single most convincing thing the product does
   and six seconds does not do it justice.
2. **+4s for Research** (`desktop-07`) between Stores and Evolution Lab — it is
   the front of the funnel and the sequence currently starts mid-story, with a
   store that already exists.
3. **+3s for Ad Studio** (`desktop-08`) after Billing.
4. **+3s to open on Generate store** — clicking it and cutting away as
   generation begins gives the film a cold open with a promise, and the
   storefront close then pays it off.

At 45s, move the storefront close to **5 seconds** and use the Lumen
Skin → Nordwerk cut as the standard ending rather than the optional one.
