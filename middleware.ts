import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/*
 * 1. Multi-tenant subdomain routing: {sub}.ROOT_DOMAIN → /store/{sub}
 * 2. Session refresh + route protection (spec 6.7)
 */

const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

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
  }

  // --- Auth session + protected routes ------------------------------
  const path = request.nextUrl.pathname;
  const needsAuthHandling =
    path.startsWith("/dashboard") || path === "/login";
  if (!needsAuthHandling) return NextResponse.next();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return NextResponse.next();

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

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|icon.png|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)",
  ],
};
