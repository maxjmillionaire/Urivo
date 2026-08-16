import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/ratelimit";
import { captureException } from "@/lib/monitoring";
import { newRequestId } from "@/lib/logger";
import { isStripeConfigured, stripe } from "@/lib/commerce/stripe";
import { loadStoreForCheckout, validateCart } from "@/lib/commerce/checkout";
import { storeSellReadiness, shopperNotice } from "@/lib/commerce/readiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * Storefront checkout (public — shoppers are anonymous). Re-validates the cart
 * against the real catalogue, then opens a Stripe Checkout Session ON THE
 * MERCHANT'S CONNECTED ACCOUNT (direct charge) so the merchant receives their
 * own money. Degrades gracefully when Stripe or the merchant's payout account
 * isn't set up yet.
 */

const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

const BodySchema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(20) }))
    .min(1)
    .max(50),
  /*
   * Legacy field, accepted but no longer trusted.
   *
   * The session now comes from the HttpOnly commerce-session cookie the
   * middleware issues (spec 10 §2). A client-supplied id could be forged to
   * attach a stranger's checkout to someone else's click, so it is only used
   * when no cookie is present — a storefront page served before the cookie
   * existed. Remove once no such page can still be open (7 days after deploy).
   */
  sid: z
    .string()
    .trim()
    .min(6)
    .max(64)
    /*
     * Charset-restricted, not just length-checked. A control character here
     * reaches PostgREST, which refuses a null byte outright (22P05) — the RPC
     * 400s instead of deciding, and the order is left un-assessed for no
     * reason. Rejecting it at the boundary keeps a malformed fallback value
     * from costing a real attribution.
     */
    .regex(/^[A-Za-z0-9._~-]+$/, "session id must be url-safe")
    .optional(),
});

/** Shape of the middleware-issued commerce session (spec 10 §2). */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

function storeOrigin(subdomain: string): string {
  const root = (process.env.ROOT_DOMAIN ?? "localhost:3000").toLowerCase();
  if (root.startsWith("localhost")) return `http://localhost:3000/store/${subdomain}`;
  return `https://${subdomain}.${root}`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ subdomain: string }> }) {
  const { subdomain } = await params;
  if (!SUBDOMAIN_RE.test(subdomain)) return fail(404, "NOT_FOUND", "Store not found.");

  // Rate limit by client IP — anonymous endpoint.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  const limit = await rateLimit(`checkout:${subdomain}:${ip}`, 15, 60_000);
  if (!limit.success) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: "Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return fail(400, "INVALID_INPUT", "Your cart looks invalid. Please refresh and try again.");
  }

  /*
   * The commerce session that carries this sale back to the click that caused
   * it. Server-issued and HttpOnly, so it is the one identifier in the chain
   * that cannot have been written by the page (spec 10 §2).
   */
  const cookieSession = request.cookies.get("urivo_cs")?.value;
  const sessionId = SESSION_ID.test(cookieSession ?? "") ? cookieSession : body.sid;

  const admin = supabaseAdmin();
  const store = await loadStoreForCheckout(admin, subdomain);
  if (!store) return fail(404, "NOT_FOUND", "Store not found.");

  /*
   * Commerce readiness, from the same helper the storefront uses to warn the
   * shopper BEFORE they fill a cart. This is the last line of defence rather
   * than the first thing the customer learns.
   */
  const readiness = await storeSellReadiness(admin, store.id);
  if (!readiness.canSell) {
    const notice = shopperNotice(readiness.blocker ?? "no_account");
    return fail(503, "CHECKOUT_UNAVAILABLE", `${notice.title}. ${notice.detail}`);
  }

  const cart = await validateCart(admin, store.id, body.items, store.currency);
  if (cart.lines.length === 0) {
    return fail(409, "CART_EMPTY", "Those items are no longer available. Please refresh your cart.");
  }

  const requestId = newRequestId();
  const origin = storeOrigin(subdomain);
  try {
    const session = await stripe().checkout.sessions.create(
      {
        mode: "payment",
        line_items: cart.lines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: cart.currency,
            unit_amount: l.unitAmount,
            product_data: {
              name: l.title,
              ...(l.imageUrl ? { images: [l.imageUrl] } : {}),
            },
          },
        })),
        // Compact snapshot so the webhook can map line items back to products.
        metadata: {
          store_id: store.id,
          subdomain,
          cart: JSON.stringify(cart.lines.map((l) => [l.productId, l.quantity])).slice(0, 480),
          /*
           * Rides on the Stripe session so the webhook — which has no browser
           * context — can attribute the order once payment actually clears.
           * The cookie wins over anything the client sent: it is HttpOnly and
           * server-issued, so unlike a request body it cannot be forged to
           * claim someone else's click (spec 10 §16.7).
           */
          ...(sessionId ? { sid: sessionId } : {}),
        },
        success_url: `${origin}/order/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}?checkout=cancelled`,
        billing_address_collection: "auto",
      },
      { stripeAccount: readiness.accountId! },
    );

    if (!session.url) throw new Error("NO_SESSION_URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    captureException(err, { requestId, route: "storefront-checkout", subdomain });
    return fail(502, "CHECKOUT_FAILED", "We couldn't start checkout just now. Please try again.");
  }
}
