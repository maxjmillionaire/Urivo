import "server-only";

/*
 * Real domain availability — so a founder never receives a brand they can't own.
 *
 * A premium brand needs a premium domain. Before Urivo presents a name, it checks
 * whether the matching domain can actually be registered, prioritising .com and
 * falling back to premium extensions (.ai, .co, .shop, .store, .io).
 *
 * Source: RDAP (Registration Data Access Protocol) — the IETF-standard successor
 * to WHOIS. It's free, keyless and authoritative: rdap.org bootstraps each query
 * to the registry that actually owns the TLD. A 404 means the domain isn't
 * registered (available); a 200 means it is (taken). The provider is behind a
 * seam so a commercial registrar API can be dropped in later for pricing and
 * one-click registration without touching callers.
 *
 * Honesty note: "available" reflects registry registration data. A rare few
 * unregistered names are premium/reserved by the registry; those surface at
 * purchase time. We never present a name whose domain is clearly taken.
 */

export const TLD_PRIORITY = ["com", "ai", "co", "shop", "store", "io"] as const;
export type Tld = (typeof TLD_PRIORITY)[number];

export type DomainStatus = "available" | "taken" | "unknown";

export interface DomainResult {
  domain: string;
  tld: string;
  status: DomainStatus;
}

/** A pluggable registration-data source (RDAP today; a registrar API later). */
export interface DomainProvider {
  readonly name: string;
  check(domain: string): Promise<DomainStatus>;
}

const RDAP_BOOTSTRAP = "https://rdap.org/domain/";
const TIMEOUT_MS = 7000;

class RdapDomainProvider implements DomainProvider {
  readonly name = "rdap";
  async check(domain: string): Promise<DomainStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${RDAP_BOOTSTRAP}${encodeURIComponent(domain)}`, {
        method: "GET",
        redirect: "follow",
        headers: { accept: "application/rdap+json, application/json" },
        signal: controller.signal,
      });
      if (res.status === 404) return "available";
      if (res.status === 200) return "taken";
      // 400/403/429/5xx or a registry without RDAP → don't guess.
      return "unknown";
    } catch {
      return "unknown";
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The active provider. RDAP is the default; a registrar key could swap this. */
function provider(): DomainProvider {
  return new RdapDomainProvider();
}

/** Turn any brand name into a clean domain label — lowercase, no spaces,
 *  accents stripped, alphanumeric only (premium names avoid hyphens/numbers). */
export function domainLabel(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 40);
}

// Small in-process cache so repeated checks (typing, re-ranking) stay cheap and
// gentle on the RDAP endpoint. Short TTL — availability changes rarely, fast.
const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { status: DomainStatus; at: number }>();

async function checkOne(domain: string): Promise<DomainStatus> {
  const key = domain.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.status;
  const status = await provider().check(key);
  // Never cache "unknown" — it's usually a transient network/RDAP hiccup.
  if (status !== "unknown") cache.set(key, { status, at: Date.now() });
  return status;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

/**
 * Check a brand name across the priority TLDs. Returns one result per TLD in
 * priority order, so the UI can show ".com taken · .ai available" at a glance.
 */
export async function checkBrandDomains(name: string, tlds: readonly string[] = TLD_PRIORITY): Promise<{
  label: string;
  results: DomainResult[];
  best: DomainResult | null;
}> {
  const label = domainLabel(name);
  if (!label || label.length < 2) return { label, results: [], best: null };

  const domains = tlds.map((tld) => `${label}.${tld}`);
  const statuses = await mapLimit(domains, 3, checkOne);
  const results: DomainResult[] = domains.map((domain, i) => ({
    domain,
    tld: tlds[i],
    status: statuses[i],
  }));

  // Best = first AVAILABLE in priority order; an "unknown" is a soft fallback.
  const best =
    results.find((r) => r.status === "available") ??
    results.find((r) => r.status === "unknown") ??
    null;

  return { label, results, best };
}

/** True when the name has at least one genuinely-available premium domain. */
export function hasOwnableDomain(results: DomainResult[]): boolean {
  return results.some((r) => r.status === "available");
}

/**
 * Bounded ranking check: walk the priority TLDs in order and STOP at the first
 * available one (so a free .com costs a single lookup). Used when scoring many
 * candidate names at once, where a full 6-TLD sweep each would be too slow.
 */
export async function firstAvailableDomain(
  name: string,
  tlds: readonly string[] = ["com", "ai", "co"],
): Promise<DomainResult | null> {
  const label = domainLabel(name);
  if (!label || label.length < 2) return null;
  let softUnknown: DomainResult | null = null;
  for (const tld of tlds) {
    const domain = `${label}.${tld}`;
    const status = await checkOne(domain);
    if (status === "available") return { domain, tld, status };
    if (status === "unknown" && !softUnknown) softUnknown = { domain, tld, status };
  }
  return softUnknown;
}
