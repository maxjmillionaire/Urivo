import type { MetadataRoute } from "next";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const revalidate = 3600; // refresh hourly

/*
 * Dynamic sitemap: Urivo's public marketing/legal pages plus every live
 * storefront (by its absolute URL). Gives search and AI answer engines a real
 * map of the storefronts the SEO module already makes crawlable.
 */
function base(): string {
  return (process.env.APP_URL ?? "https://urivo.ai").replace(/\/$/, "");
}

function rootDomain(): string {
  return (process.env.ROOT_DOMAIN ?? "urivo.ai").toLowerCase();
}

function storeUrl(subdomain: string): string {
  const root = rootDomain();
  if (root.startsWith("localhost")) return `${base()}/store/${subdomain}`;
  return `https://${subdomain}.${root}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const b = base();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${b}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${b}/impressum`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${b}/datenschutz`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${b}/agb`, changeFrequency: "yearly", priority: 0.2 },
  ];

  let stores: MetadataRoute.Sitemap = [];
  try {
    const { data } = await supabaseAdmin()
      .from("stores")
      .select("subdomain, updated_at, created_at")
      .eq("is_active", true)
      .limit(5000);
    stores = (data ?? []).map((s) => ({
      url: storeUrl(s.subdomain as string),
      lastModified: new Date((s.updated_at as string) ?? (s.created_at as string) ?? Date.now()),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    // Admin/DB unavailable at build — the static pages still ship.
  }

  return [...staticPages, ...stores];
}
