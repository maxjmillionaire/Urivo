import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isStripeConfigured, stripe } from "@/lib/commerce/stripe";

/*
 * Launch preflight — what /api/health could not tell you.
 *
 * The old health check listed which environment variables were set. Every
 * failure that actually takes a launch down passes that check:
 *
 *   - Stripe TEST keys in production. Every checkout "succeeds", no money ever
 *     arrives, and nothing looks wrong for hours. STRIPE_SECRET_KEY is set, so
 *     a presence check reports green.
 *   - A migration nobody pasted. The variable is set, the database answers, and
 *     one feature 500s the first time a real user touches it.
 *   - An invalid or revoked key. Present, non-empty, and dead.
 *   - APP_URL still on localhost. Stripe return URLs and every email link point
 *     at a machine that is not on the internet.
 *
 * So this probes instead of listing: it talks to the database, compares the
 * deployed schema against the functions the code actually calls, asks Stripe
 * who it is, and reads the URLs for sense. It is the difference between "the
 * config looks plausible" and "this deployment can take money".
 *
 * Every check is read-only and safe to run against production.
 */

export type Severity = "blocker" | "warning" | "info";

export interface Check {
  name: string;
  ok: boolean;
  severity: Severity;
  /** Written for a person mid-deploy: what is true, and what to do about it. */
  detail: string;
}

export interface PreflightReport {
  ok: boolean;
  checkedAt: string;
  blockers: string[];
  warnings: string[];
  checks: Check[];
}

/*
 * Every database function the application calls, derived from the source rather
 * than remembered — `rpcNamesInSource()` in the test re-derives this list and
 * fails if the two disagree. A missing entry here is a feature that breaks in
 * front of a user instead of in this report.
 */
export const REQUIRED_RPCS = [
  "ad_performance",
  "attribute_order",
  // Spec 10 §14. Without it the ad figures render without a coverage share,
  // which is the one state the model forbids: a number more confident than
  // the evidence behind it.
  "attribution_coverage",
  // Spec 10 §11. Retention that is documented but not callable is not retention.
  "expire_click_events",
  "attribute_store_outcome",
  "comped_accounts",
  "creator_payout_summary",
  "credit_balance",
  "credit_expiry_summary",
  "dashboard_store_stats",
  "expire_comped_access",
  "feedback_inbox",
  "finance_cost_per_action",
  "finance_margin_by_plan",
  "finance_overview",
  "finance_plan_distribution",
  "finance_revenue",
  "finance_today",
  "finance_top_users",
  "first_sale_cohorts",
  "first_sale_funnel",
  // The hero action. It was missing from this list on the first draft, because
  // the call is wrapped across lines and a one-line grep never saw it — which
  // is precisely why the list is re-derived by a test rather than typed once.
  "generate_store_atomic",
  "grant_comped_access",
  "is_email_domain_blocked",
  "monthly_paid_orders",
  "pay_out_creator",
  "publish_store",
  "record_ai_decision",
  "rebase_image_costs",
  "record_product_outcome",
  "referral_overview",
  "referral_top_creators",
  "resolve_feedback",
  "revoke_comped_access",
  "spend_credits",
  "store_for_domain",
  "store_payout_account",
  "store_subscriber_counts",
  "submit_feedback",
  "subscribe_to_store",
  "weekly_digest_data",
] as const;

const isProd = () => process.env.NODE_ENV === "production";

/** A deployment on a real domain — the state where localhost URLs are fatal. */
function looksLocal(value: string | undefined): boolean {
  if (!value) return false;
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(value);
}

async function checkDatabase(): Promise<Check> {
  const started = Date.now();
  try {
    const { error } = await supabaseAdmin()
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .limit(1);
    if (error) {
      return {
        name: "database",
        ok: false,
        severity: "blocker",
        detail: `Supabase rejected a read: ${error.message}. Check the service-role key and whether the project is paused (free projects pause after ~7 days idle and look exactly like a network fault).`,
      };
    }
    const ms = Date.now() - started;
    return {
      name: "database",
      ok: true,
      severity: "info",
      detail: `Reachable, responded in ${ms} ms.`,
    };
  } catch (e) {
    return {
      name: "database",
      ok: false,
      severity: "blocker",
      detail: `Could not reach Supabase at all: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/*
 * Ask PostgREST what the deployed database actually exposes and compare it with
 * what the code calls. This is the check that catches a migration nobody pasted
 * — the single most likely way this launch breaks, because applying them is a
 * manual step in a browser.
 */
async function checkSchema(): Promise<Check> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      name: "schema",
      ok: false,
      severity: "blocker",
      detail: "Cannot inspect the schema without NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    };
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        name: "schema",
        ok: false,
        severity: "blocker",
        detail: `PostgREST returned ${res.status} when asked for the schema. The service-role key is probably wrong.`,
      };
    }
    const spec = (await res.json()) as { paths?: Record<string, unknown> };
    const exposed = new Set(
      Object.keys(spec.paths ?? {})
        .filter((p) => p.startsWith("/rpc/"))
        .map((p) => p.slice(5)),
    );
    const missing = REQUIRED_RPCS.filter((fn) => !exposed.has(fn));
    if (missing.length > 0) {
      return {
        name: "schema",
        ok: false,
        severity: "blocker",
        detail: `${missing.length} database function(s) the app calls are not deployed: ${missing.join(", ")}. Paste the outstanding migrations into Supabase → SQL Editor (see supabase/catch_up_from_*.sql).`,
      };
    }
    return {
      name: "schema",
      ok: true,
      severity: "info",
      detail: `All ${REQUIRED_RPCS.length} required database functions are deployed.`,
    };
  } catch (e) {
    return {
      name: "schema",
      ok: false,
      severity: "blocker",
      detail: `Schema check failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/*
 * The one that matters most on launch day. A test key in production does not
 * error — checkout completes, the merchant celebrates, and no money exists.
 */
function checkStripeMode(): Check {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return {
      name: "stripe.mode",
      ok: false,
      severity: isProd() ? "blocker" : "warning",
      detail: "STRIPE_SECRET_KEY is unset. Subscriptions, credit packs and storefront checkout are all unavailable.",
    };
  }
  const test = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (!test && !live) {
    return {
      name: "stripe.mode",
      ok: false,
      severity: "warning",
      detail: "STRIPE_SECRET_KEY is not in a recognised format (expected sk_live_… or sk_test_…).",
    };
  }
  if (test && isProd()) {
    return {
      name: "stripe.mode",
      ok: false,
      severity: "blocker",
      detail: "Running TEST Stripe keys in production. Every payment will appear to succeed and no money will arrive. Swap in the live key before taking a single customer.",
    };
  }
  return {
    name: "stripe.mode",
    ok: true,
    severity: "info",
    detail: live ? "Live keys." : "Test keys (not a production deployment).",
  };
}

/** Present and well-formed is not the same as valid — ask Stripe. */
async function checkStripeReachable(): Promise<Check> {
  if (!isStripeConfigured()) {
    return { name: "stripe.reachable", ok: false, severity: "info", detail: "Skipped — no key configured." };
  }
  try {
    const balance = await stripe().balance.retrieve();
    return {
      name: "stripe.reachable",
      ok: true,
      severity: "info",
      detail: `Key accepted${balance.livemode ? " (livemode)" : " (test mode)"}.`,
    };
  } catch (e) {
    return {
      name: "stripe.reachable",
      ok: false,
      severity: "blocker",
      detail: `Stripe rejected the key: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function checkUrls(): Check[] {
  const appUrl = process.env.APP_URL;
  const rootDomain = process.env.ROOT_DOMAIN;
  const checks: Check[] = [];

  if (isProd() && (looksLocal(appUrl) || looksLocal(rootDomain))) {
    checks.push({
      name: "urls",
      ok: false,
      severity: "blocker",
      detail: `APP_URL=${appUrl ?? "unset"} / ROOT_DOMAIN=${rootDomain ?? "unset"} still point at localhost in production. Stripe return URLs, storefront addresses and every email link will be broken.`,
    });
  } else if (!appUrl || !rootDomain) {
    checks.push({
      name: "urls",
      ok: false,
      severity: isProd() ? "blocker" : "warning",
      detail: "APP_URL and ROOT_DOMAIN must both be set — one is used for absolute links, the other for storefront subdomains.",
    });
  } else {
    /*
     * They are two variables describing one deployment, and they are set by
     * hand in a Railway form. A mismatch produces storefronts on a hostname
     * the app never links to, which is very hard to see and very easy to make.
     */
    const host = (() => {
      try {
        return new URL(appUrl).host;
      } catch {
        return "";
      }
    })();
    const consistent = host === rootDomain || host === `www.${rootDomain}`;
    checks.push({
      name: "urls",
      ok: consistent,
      severity: consistent ? "info" : "warning",
      detail: consistent
        ? `APP_URL and ROOT_DOMAIN agree on ${rootDomain}.`
        : `APP_URL host (${host || "unparseable"}) does not match ROOT_DOMAIN (${rootDomain}). Storefront subdomains are built from ROOT_DOMAIN; links are built from APP_URL.`,
    });
  }
  return checks;
}

/** Configuration whose absence degrades the launch without stopping it. */
function checkOptional(): Check[] {
  const set = (v: string | undefined) => Boolean(v && v.length > 0);
  const out: Check[] = [];

  out.push({
    name: "ai",
    ok: set(process.env.ANTHROPIC_API_KEY),
    severity: "blocker",
    detail: set(process.env.ANTHROPIC_API_KEY)
      ? "Configured."
      : "ANTHROPIC_API_KEY is unset — no generation, no assistant, no research, no ads. The product does nothing.",
  });

  const images = set(process.env.HIGGSFIELD_API_KEY) || set(process.env.GOOGLE_AI_API_KEY);
  out.push({
    name: "product_images",
    ok: images,
    severity: "warning",
    detail: images
      ? "Configured."
      : "No image provider. Stores generate, but products fall back to palette planes instead of photographs — the single most visible quality difference in the product.",
  });

  const redis = set(process.env.UPSTASH_REDIS_REST_URL) && set(process.env.UPSTASH_REDIS_REST_TOKEN);
  out.push({
    name: "rate_limiter",
    ok: redis,
    severity: "warning",
    detail: redis
      ? "Upstash Redis — shared across instances."
      : "Falling back to in-memory rate limiting, which is per-instance. Limits multiply by the number of running instances.",
  });

  out.push({
    name: "email",
    ok: set(process.env.RESEND_API_KEY),
    severity: "warning",
    detail: set(process.env.RESEND_API_KEY)
      ? "Configured."
      : "RESEND_API_KEY unset — welcome emails and the weekly digest are logged instead of sent.",
  });

  out.push({
    name: "error_monitoring",
    ok: set(process.env.SENTRY_DSN),
    severity: "warning",
    detail: set(process.env.SENTRY_DSN)
      ? "Configured."
      : "SENTRY_DSN unset. During a test phase this means a tester hits an error and nobody ever finds out.",
  });

  out.push({
    name: "admin_access",
    ok: set(process.env.ADMIN_EMAILS),
    severity: "warning",
    detail: set(process.env.ADMIN_EMAILS)
      ? "Configured."
      : "ADMIN_EMAILS unset — the gate fails closed, so nobody can reach /admin/finance, the feedback inbox or tester access.",
  });

  out.push({
    name: "cron_secret",
    ok: set(process.env.CRON_SECRET),
    severity: "warning",
    detail: set(process.env.CRON_SECRET)
      ? "Configured."
      : "CRON_SECRET unset — the weekly digest endpoint and this deep health check are disabled (both fail closed).",
  });

  const cf = set(process.env.CLOUDFLARE_API_TOKEN) && set(process.env.CLOUDFLARE_ZONE_ID);
  out.push({
    name: "custom_domains",
    ok: cf,
    severity: "warning",
    detail: cf
      ? "Cloudflare configured."
      : "CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID unset — merchants cannot connect their own domain, which is the clearest reason to stay subscribed.",
  });

  return out;
}

export async function runPreflight(): Promise<PreflightReport> {
  const [database, schema, stripeReachable] = await Promise.all([
    checkDatabase(),
    checkSchema(),
    checkStripeReachable(),
  ]);

  const checks: Check[] = [
    database,
    schema,
    checkStripeMode(),
    stripeReachable,
    ...checkUrls(),
    ...checkOptional(),
  ];

  const failed = checks.filter((c) => !c.ok);
  const blockers = failed.filter((c) => c.severity === "blocker").map((c) => `${c.name}: ${c.detail}`);
  const warnings = failed.filter((c) => c.severity === "warning").map((c) => `${c.name}: ${c.detail}`);

  return {
    ok: blockers.length === 0,
    checkedAt: new Date().toISOString(),
    blockers,
    warnings,
    checks,
  };
}
