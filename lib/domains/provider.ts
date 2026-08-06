/*
 * The domain provider seam.
 *
 * Custom domains need someone to issue a TLS certificate and route traffic:
 * Cloudflare for SaaS, Vercel's Domains API, or something else later. That
 * choice is an infrastructure decision, and it must not reach into the schema,
 * the API routes or the setup screen — so everything above this line talks to
 * the interface, and only one small file below it knows which vendor is live.
 *
 * Pure (no server-only import) so the whole flow is testable against the fake
 * provider without a live account, a real domain, or a deployed origin.
 */

/** A DNS record the merchant must create at their registrar, verbatim. */
export interface DnsRecord {
  type: "CNAME" | "TXT" | "A";
  name: string;
  value: string;
  /** Shown beside the record — why it exists, in the merchant's language. */
  purpose: string;
}

export type DomainStatus = "pending" | "verifying" | "active" | "failed";

export interface DomainState {
  status: DomainStatus;
  records: DnsRecord[];
  /** The provider's reason, surfaced to the merchant when it helps them act. */
  error?: string;
}

export interface DomainProvider {
  readonly name: string;
  /** Register a hostname and return what the merchant must configure. */
  add(hostname: string): Promise<DomainState & { providerId: string }>;
  /** Current state. Called by the merchant pressing "check now", and by a poll. */
  check(providerId: string, hostname: string): Promise<DomainState>;
  /** Release a hostname. Must succeed even if the provider already dropped it. */
  remove(providerId: string): Promise<void>;
}

/* ------------------------------- validation -------------------------------- */

const HOSTNAME_RE = /^(?=.{4,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;

/**
 * Names that are never a merchant's, independent of the root domain. Urivo's
 * own zone is covered by the rootDomain check below rather than listed here —
 * two places deciding the same thing is how one of them drifts.
 */
const RESERVED = new Set(["localhost", "localhost.localdomain"]);

export type HostnameRejection =
  | "empty"
  | "malformed"
  | "reserved"
  | "own_domain"
  | "apex_unsupported";

export interface HostnameCheck {
  ok: boolean;
  hostname: string;
  reason?: HostnameRejection;
}

/**
 * Normalise and vet a hostname before anything else touches it.
 *
 * Apex domains are rejected on purpose. DNS forbids a CNAME at the zone apex,
 * so `nordwerk.de` can only point here if the merchant's DNS happens to support
 * flattening or ALIAS — which most registrars do not. Accepting it would mean
 * promising something that works for some merchants and mysteriously fails for
 * the rest, and DNS is already where non-technical users get stuck.
 */
export function checkHostname(raw: string, rootDomain = "urivo.ai"): HostnameCheck {
  const hostname = String(raw ?? "")
    .trim()
    .toLowerCase()
    // Tolerate a pasted URL — merchants paste what is in their address bar.
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "");

  if (!hostname) return { ok: false, hostname, reason: "empty" };
  if (!HOSTNAME_RE.test(hostname)) return { ok: false, hostname, reason: "malformed" };
  if (RESERVED.has(hostname)) return { ok: false, hostname, reason: "reserved" };
  // A merchant cannot claim a piece of Urivo itself.
  if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) {
    return { ok: false, hostname, reason: "own_domain" };
  }
  // Two labels = apex (nordwerk.de). Three or more = a subdomain we can CNAME.
  if (hostname.split(".").length < 3) {
    return { ok: false, hostname, reason: "apex_unsupported" };
  }
  return { ok: true, hostname };
}

/** What the merchant reads when a hostname is refused. Never jargon. */
export function rejectionMessage(reason: HostnameRejection, hostname: string): string {
  switch (reason) {
    case "empty":
      return "Enter the domain you'd like to use.";
    case "malformed":
      return `"${hostname}" doesn't look like a domain. It should read like shop.yourbrand.com.`;
    case "reserved":
    case "own_domain":
      return "That address belongs to Urivo. Use a domain you own.";
    case "apex_unsupported":
      return `Use a subdomain such as shop.${hostname} or www.${hostname} — a bare domain can't be pointed here by most registrars.`;
  }
}
