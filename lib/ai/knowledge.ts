import "server-only";

/*
 * The advanced e-commerce knowledge library — Ask Urivo's "deep shelf".
 *
 * The Operator Doctrine (lib/ai/doctrine.ts) is the compact core that rides on
 * EVERY turn. This is the opposite: a library of deeper, niche operator modules
 * that most turns do NOT need, so injecting all of it every time would bloat the
 * prompt and blunt the short, sharp answers we want. Instead a lightweight
 * selector pulls only the one or two modules relevant to THIS question into the
 * turn — retrieval without an embedding store, which at this scale is faster,
 * cheaper and easier to reason about than a vector database.
 *
 * Each module is expert, specific and current: real structures, benchmarks and
 * numbers an operator actually uses. Voice is Urivo's own — hype-free, no course
 * branding. To go deeper, add a module; the selector picks it up by its tags.
 *
 * Cost: a matched module rides UNCACHED on the turn that needs it (it varies by
 * query), capped at two modules, each bounded in size — a few hundred tokens
 * only when the question actually calls for depth. knowledge.test.ts pins the
 * per-module ceiling so the library can't creep into the cost model.
 */

export const KNOWLEDGE_VERSION = "v1";

/** Per-module character ceiling — a card, not a chapter. Test-enforced. */
export const KNOWLEDGE_MODULE_MAX_CHARS = 1_600;

export interface KnowledgeModule {
  /** Stable id (kebab-case), unique across the library. */
  id: string;
  /** Human title, shown as the heading when injected. */
  title: string;
  /** Lowercase match terms; a term found in the question scores the module. */
  tags: string[];
  /** The knowledge itself — dense, expert, Urivo-voiced. */
  content: string;
}

export const KNOWLEDGE_MODULES: KnowledgeModule[] = [
  {
    id: "measurement",
    title: "Measurement & attribution (post-privacy)",
    tags: [
      "attribution", "roas", "tracking", "pixel", "ios", "att", "analytics",
      "blended", "cac", "conversions api", "capi", "server-side", "measure",
      "measurement", "metrics", "data", "mer",
    ],
    content:
      "Since ATT, in-platform ROAS overstates — each channel claims the same sale. Anchor on the numbers your bank can verify. Blended: total revenue divided by total ad spend across all channels. MER (marketing efficiency ratio) for the whole business. New-customer CAC tracked separately from blended, because retargeting flatters the blend. Install server-side tracking (a Conversions API / server events) to recover lost signal, but treat platform-reported conversions as directional, not truth. Triangulate with a post-purchase 'how did you hear about us' survey. Make every scaling decision on contribution margin after all costs, reviewed weekly — not on a good day's in-platform ROAS.",
  },
  {
    id: "creative-testing",
    title: "Creative testing systems",
    tags: [
      "creative", "creatives", "testing", "test", "hook", "hooks", "ugc",
      "iterate", "variations", "concepts", "video ad", "ad fatigue", "fatigue",
    ],
    content:
      "Creative is the majority of paid performance now; the platform handles targeting. Run a dedicated testing campaign, separate from scaling. Broad targeting, new concepts weekly, each given enough budget to exit the learning phase before you judge it. Read leading signals first — 3-second hook rate and click-through — then the deciding one, cost per purchase. Winners graduate into the scaling campaign; losers die at a pre-set threshold. Iterate a winner by changing only the hook and keeping the body — hooks fatigue first, and winners have families, not replacements. Kill a creative when its CPA runs 20-30% over baseline for about three days. Volume and angle diversity beat polish: ten distinct angles beat ten edits of one idea.",
  },
  {
    id: "scaling-structure",
    title: "Paid scaling structures",
    tags: [
      "scaling", "scale", "cbo", "abo", "budget", "advantage", "consolidation",
      "campaign structure", "duplicate", "cost cap", "bid cap", "learning phase",
    ],
    content:
      "Two motions. Vertical: raise the winner's budget in steps of about 20% every few days, or duplicate into a higher-budget campaign to reset learning gently — jumps reset the algorithm and waste spend. Horizontal: the same offer into new creatives, placements, lookalikes and markets. Modern accounts reward consolidation — fewer campaigns, broad or Advantage+ audiences, budget concentrated so ad sets actually exit learning; fragmenting across many tiny ad sets keeps them all in limbo. Use cost or bid caps only once you know your true maximum CPA. Expect CPA to climb as you reach colder audiences — model it, and scale on contribution and new-customer CAC, never on one strong day.",
  },
  {
    id: "offer-engineering",
    title: "Offer engineering",
    tags: [
      "offer", "bundle", "bundles", "guarantee", "discount", "promotion",
      "tripwire", "anchor", "pricing offer", "free shipping", "risk reversal",
    ],
    content:
      "The offer beats the copy and often the product itself. Build the page around one hero offer. Levers: an anchor price shown as reference; volume bundles with a highlighted middle option; a free-shipping threshold set just above current AOV; a genuine risk-reversal guarantee that names the fear ('30 days, keep the gift either way'); and urgency only when it is real. A low-cost tripwire buys a customer you monetise on the back end. Resist reflexive discounting — percent-off trains price-shopping and eats the margin you need to buy traffic; prefer added value (a bonus, a bundle, a better guarantee) over cutting the number.",
  },
  {
    id: "aov-upsell",
    title: "AOV & post-purchase upsells",
    tags: [
      "aov", "average order value", "upsell", "cross-sell", "order bump",
      "cart value", "post-purchase", "one-click", "basket",
    ],
    content:
      "Raising AOV improves every downstream number and lets you outbid rivals for the same click. Stack three moments. Pre-purchase: bundles, volume discounts, 'frequently bought together'. In-cart: a progress bar to the free-shipping threshold and a single order bump. Post-purchase: a one-click upsell on the thank-you step — the highest-converting moment there is, because the buyer already trusts you and re-enters no card details; make it one relevant offer, not a menu. A post-purchase one-click commonly lifts AOV in the mid-single to low-double digits at near-zero acquisition cost. Test a two-pack before you test a new product — it is the cheapest ceiling raise available.",
  },
  {
    id: "retention-ltv",
    title: "Retention, LTV & subscription",
    tags: [
      "retention", "ltv", "lifetime value", "subscription", "subscribe",
      "repeat", "replenishment", "cohort", "churn", "loyalty", "returning",
    ],
    content:
      "Profit lives in orders two and three; a cold first order usually only breaks even. Track LTV by cohort — group customers by the month they first bought and watch each group's 90-day and 12-month value. Rising cohort value is the truest sign the business is genuinely improving. Raise LTV: sell a consumable or replenishment, add a subscribe-and-save that turns one sale into many, and give returning customers a reason that is not only a discount (early access, a bonus, a better tier). Segment buyers, non-buyers and lapsed — sending everything to everyone trains people to ignore you. The list you own is the only audience no platform can take away, so grow it on every order.",
  },
  {
    id: "email-flows",
    title: "Email & SMS flow architecture",
    tags: [
      "email", "sms", "klaviyo", "flow", "flows", "abandoned", "abandonment",
      "welcome", "automation", "newsletter", "campaign email", "broadcast",
    ],
    content:
      "Automated flows earn far more per send than broadcasts because they hit intent. Build them in priority order: abandoned checkout (about an hour later, again next day, again day three), browse abandonment, welcome and first-purchase (deliver the promised offer, set delivery expectations), post-purchase (confirm, reassure, request the review after delivery, then a relevant cross-sell), win-back around day 45-90, and replenishment timed to run-out. Held to benchmark, flows should drive roughly a quarter to 40% of email revenue, and abandoned-checkout alone recovers a meaningful share of carts. Layer a weekly campaign calendar over the flows, sent to segments, mixing value with promotion so the list stays profitable rather than fatigued.",
  },
  {
    id: "cro-pdp",
    title: "Advanced CRO & product page",
    tags: [
      "cro", "conversion", "conversion rate", "product page", "pdp", "landing",
      "above the fold", "reviews", "trust", "checkout", "friction", "funnel",
    ],
    content:
      "The product page is most of the store. Above the fold on mobile: the product, an outcome headline (not a feature), price, buy button and star rating. Sell the outcome the buyer imagines, and stack objections — pre-empt fit, durability, delivery and refund exactly where each arises. Real photos and video beat stock; video lifts conversion more than any copy edit. Put social proof high, photo reviews over text, and keep a few honest three-stars — they raise trust, not lower it. At checkout: guest on, fewest fields, local payment methods and express wallets. Diagnose the funnel precisely — weak clicks are a creative problem, clicks without carts are an offer or page problem, carts without checkouts are friction or trust.",
  },
  {
    id: "sourcing-margin",
    title: "Sourcing: agent to private label",
    tags: [
      "supplier", "suppliers", "sourcing", "agent", "private label", "cogs",
      "fulfilment", "fulfillment", "aliexpress", "factory", "samples", "landed cost",
    ],
    content:
      "The progression is marketplace supplier (for testing only), then a sourcing agent once you have steady daily orders (better price, faster shipping, custom packaging, real quality control), then private label or direct manufacturing once a product is proven. Price on landed cost — product plus shipping plus duties plus packaging — at three times or more. Order samples yourself before a customer does. Ask whether they are the manufacturer or a trader, get tiered pricing at 50, 200 and 500 units in writing, and qualify a backup before you need it. Branded packaging with an insert (a review ask or a repeat-purchase code) is cheap perceived value and the only physical advert you ever send. Never rely on a single supplier at scale.",
  },
  {
    id: "cash-scaling",
    title: "Cash flow & scaling discipline",
    tags: [
      "cash", "cash flow", "reserve", "chargeback", "dispute", "payout",
      "runway", "liquidity", "scale safely", "reserves", "forecast",
    ],
    content:
      "Profitable stores die of cash, not losses. The gap: ad spend and suppliers are paid today, while the processor holds your revenue one to two weeks and raises rolling reserves as volume grows. Never scale ad spend faster than cash comes in. Hold 10-15% of revenue back for refunds and disputes. Keep the dispute rate under 1% — above it, processors freeze funds or close the account, which ends the business in a day; prevent it with clear delivery windows, a recognisable billing descriptor, fast support and refunds you actually honour. Run a thirteen-week cash forecast and update it weekly. Separate the money into operating, tax, profit and owner pay so tax money is never spent by accident.",
  },
  {
    id: "paid-channels",
    title: "Channel choice: Meta, TikTok, Google",
    tags: [
      "tiktok", "google", "google ads", "meta", "facebook", "instagram",
      "channel", "channels", "search ads", "youtube", "pinterest", "platform",
      "where to advertise", "pmax",
    ],
    content:
      "Match the channel to intent and to the creative you can actually make. Meta is the all-round starting point for a new product — broad reach, strong for impulse and problem-aware buyers, entirely creative-led. TikTok is entertainment-first: UGC that does not look like an ad, cheaper reach, a younger audience and great for visually demonstrable products, but expect faster fatigue and a higher creative appetite. Google Search harvests existing demand — run brand terms and high-intent keywords once demand exists, and use Performance Max for scale only with guardrails. Start where your creative is strongest and the buyer already is; add a second channel only after the first is reliably profitable.",
  },
];

/** Format a "PLAIN header, then card" reference to inject into the turn. */
export function renderKnowledge(modules: KnowledgeModule[]): string {
  if (modules.length === 0) return "";
  const cards = modules.map((m) => `## ${m.title}\n${m.content}`).join("\n\n");
  return `RELEVANT PLAYBOOK — deeper knowledge selected for this question. Use what fits the founder's real situation; ignore the rest, and never recite it wholesale.\n\n${cards}`;
}

/**
 * Pick the modules whose tags the question actually touches.
 *
 * A term found in the (lowercased) question scores its module; the highest
 * scorers win, capped so a turn never carries the whole shelf. No match returns
 * nothing — the doctrine alone then answers, which is correct for the many
 * questions that need no deep module. Pure and deterministic, so it is testable
 * and cannot surprise the cost model.
 */
export function selectKnowledge(question: string, max = 2): KnowledgeModule[] {
  const q = ` ${question.toLowerCase()} `;
  const scored = KNOWLEDGE_MODULES.map((m, index) => {
    let score = 0;
    for (const tag of m.tags) if (q.includes(tag.toLowerCase())) score += 1;
    return { m, score, index };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.slice(0, Math.max(0, max)).map((s) => s.m);
}
