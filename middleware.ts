import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/*
 * 1. Multi-tenant subdomain routing: {sub}.ROOT_DOMAIN → /store/{sub}
 * 2. Session refresh + route protection (spec 6.7)
 */

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

/*
 * Admin allow-list check. Mirrors lib/admin.ts, which is the canonical
 * definition — it is restated here because middleware runs in the edge runtime
 * and must not pull in `server-only` modules. Keep the two in step.
 *
 * Fail closed: unset ADMIN_EMAILS means nobody is an admin.
 */
function isAdminRequest(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.ADMIN_EMAILS;
  if (!raw) return false;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

/*
 * Is this Host a merchant's own domain?
 *
 * Deliberately strict. An earlier version asked only "does it contain a dot",
 * which made 127.0.0.1 a custom domain and rewrote /login to /store/127.0.0.1 —
 * every non-storefront route on the deployment 404'd. A host qualifies only if
 * it is not ours, not an IP literal, and ends in something that looks like a
 * real TLD.
 */
const IP_LITERAL = /^\d{1,3}(?:\.\d{1,3}){3}$|^\[?[0-9a-f:]+\]?$/i;

function isCustomDomainCandidate(host: string, rootDomain: string): boolean {
  if (!host || host === rootDomain || host === `www.${rootDomain}`) return false;
  if (host.endsWith(`.${rootDomain}`)) return false;
  // Local development never has custom domains, and "localhost" has no dot.
  if (rootDomain.startsWith("localhost") || host === "localhost") return false;
  if (IP_LITERAL.test(host)) return false;
  const labels = host.split(".");
  if (labels.length < 2) return false;
  // A real TLD: letters only, at least two of them.
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

export async function middleware(request: NextRequest) {
  // --- Tenant subdomain rewrite -------------------------------------
  const rootDomain = (process.env.ROOT_DOMAIN ?? "localhost:3000")
    .split(":")[0]
    .toLowerCase();
  const host = (request.headers.get("host") ?? "")
    .split(":")[0]
    .toLowerCase();

  if (
    host &&
    host !== rootDomain &&
    host !== `www.${rootDomain}` &&
    host.endsWith(`.${rootDomain}`)
  ) {
    const subdomain = host.slice(0, -(rootDomain.length + 1));
    if (subdomain !== "www" && SUBDOMAIN_PATTERN.test(subdomain)) {
      const p = request.nextUrl.pathname;
      // API, framework and already-mapped paths pass straight through so that
      // storefront sub-pages (product, order/success) and the checkout API work
      // on a real subdomain — not just the home page.
      if (p.startsWith("/api") || p.startsWith("/_next") || p.startsWith("/store/")) {
        return NextResponse.next();
      }
      const url = request.nextUrl.clone();
      url.pathname = `/store/${subdomain}${p === "/" ? "" : p}`;
      return NextResponse.rewrite(url);
    }
    // Malformed subdomain: fall through to the main site untouched.
  } else if (isCustomDomainCandidate(host, rootDomain)) {
    /*
     * A CUSTOM DOMAIN — a hostname that is not ours at all.
     *
     * Rewritten into the SAME storefront route as a subdomain, carrying the
     * hostname where the subdomain normally goes. Product pages, the cart, the
     * checkout API and the order-success page all come along unchanged, and
     * the resolver distinguishes the two without ambiguity because a subdomain
     * can never contain a dot.
     *
     * The lookup deliberately does NOT happen here: middleware runs on every
     * request in the edge runtime, and a database round trip on the hot path
     * would cost every visitor. The storefront route resolves it in Node, where
     * the result is already cached.
     */
    const p = request.nextUrl.pathname;
    if (!p.startsWith("/api") && !p.startsWith("/_next") && !p.startsWith("/store/")) {
      const url = request.nextUrl.clone();
      url.pathname = `/store/${host}${p === "/" ? "" : p}`;
      return NextResponse.rewrite(url);
    }
  }

  // --- Auth session + protected routes ------------------------------
  const path = request.nextUrl.pathname;
  const needsAuthHandling =
    path.startsWith("/dashboard") || path.startsWith("/admin") || path === "/login";
  if (!needsAuthHandling) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    // Without auth configured we cannot establish who anyone is, so the admin
    // area must stay shut rather than fall through to the page.
    if (path.startsWith("/admin")) return new NextResponse(null, { status: 404 });
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && path.startsWith("/dashboard")) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (user && path === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  /*
   * The admin area must be INVISIBLE, not merely protected. The page itself
   * calls notFound() as defence in depth, but by then the streamed shell has
   * already flushed a 200 (the (platform) group has a loading.tsx), so the
   * response looked like a real page to crawlers and uptime monitors. Deciding
   * here — before any rendering — lets us answer with a true 404.
   *
   * Fail closed: with ADMIN_EMAILS unset, nobody is an admin.
   */
  if (path.startsWith("/admin") && !isAdminRequest(user?.email)) {
    return new NextResponse(null, { status: 404 });
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icon.png|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)",
  ],
};
