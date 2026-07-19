import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Store-name availability — the "always land a great, genuinely-free address"
 * capability. One source of truth for what makes a subdomain valid and whether
 * it is actually available (not reserved, not already taken, including inactive
 * stores). Used by the live availability check, the name-suggestion studio and
 * the generation pipeline so the three never disagree.
 *
 * "Available" here is truthful: it queries the real namespace via the service
 * role (RLS hides inactive stores from the anon client, so an honest check must
 * see every store, not just live ones).
 */

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export type Availability =
  | { available: true; subdomain: string }
  | { available: false; subdomain: string; reason: "invalid" | "reserved" | "taken" };

/** Normalize any brand name or free text into a candidate subdomain. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, "") // trim hyphens
    .replace(/-{2,}/g, "-") // collapse runs
    .slice(0, 63)
    .replace(/-+$/g, ""); // re-trim after slice
}

/** True only when the string satisfies the subdomain grammar (3–63 chars). */
export function isValidSubdomain(subdomain: string): boolean {
  return SUBDOMAIN_RE.test(subdomain);
}

/**
 * Real availability check against the live namespace. `admin` must be the
 * service-role client so inactive stores are visible (an honest "taken").
 */
export async function checkSubdomainAvailability(
  admin: SupabaseClient,
  raw: string,
): Promise<Availability> {
  const subdomain = raw.trim().toLowerCase();
  if (!isValidSubdomain(subdomain)) {
    return { available: false, subdomain, reason: "invalid" };
  }

  const [{ data: reserved }, { data: existing }] = await Promise.all([
    admin.from("reserved_subdomains").select("subdomain").eq("subdomain", subdomain).maybeSingle(),
    admin.from("stores").select("id").eq("subdomain", subdomain).maybeSingle(),
  ]);

  if (reserved) return { available: false, subdomain, reason: "reserved" };
  if (existing) return { available: false, subdomain, reason: "taken" };
  return { available: true, subdomain };
}

/**
 * Given candidate names, return each one's best available subdomain. Tries the
 * bare slug first, then a small set of natural, brandable fallbacks (get-, try-,
 * -hq, -shop, -store, -co) so a strong name is never dropped just because the
 * bare slug is taken. Returns only entries that resolved to something free.
 */
export async function resolveAvailableNames(
  admin: SupabaseClient,
  names: { name: string; rationale?: string }[],
): Promise<{ name: string; subdomain: string; rationale?: string }[]> {
  const SUFFIXES = ["", "-shop", "-store", "-co", "-hq"];
  const PREFIXES = ["get-", "try-"];
  const out: { name: string; subdomain: string; rationale?: string }[] = [];
  const claimed = new Set<string>(); // avoid proposing the same slug twice in one batch

  for (const entry of names) {
    const base = slugify(entry.name);
    if (!base) continue;

    const candidates = [
      ...SUFFIXES.map((s) => `${base}${s}`),
      ...PREFIXES.map((p) => `${p}${base}`),
    ]
      .map((c) => c.slice(0, 63).replace(/-+$/g, ""))
      .filter((c) => isValidSubdomain(c) && !claimed.has(c));

    for (const candidate of candidates) {
      const res = await checkSubdomainAvailability(admin, candidate);
      if (res.available) {
        claimed.add(candidate);
        out.push({ name: entry.name, subdomain: candidate, rationale: entry.rationale });
        break;
      }
    }
  }
  return out;
}
