import type { MetadataRoute } from "next";

/*
 * robots.txt for Urivo and its storefronts. Allows crawling of public pages,
 * disallows the app's private surfaces (dashboard, auth, API), and points to the
 * sitemap. Served for the root domain; storefront subdomains inherit the same
 * app so this applies to them too.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "https://urivo.ai").replace(/\/$/, "");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/login", "/update-password", "/auth/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
