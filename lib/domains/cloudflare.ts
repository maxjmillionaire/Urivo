import "server-only";
import type { DomainProvider, DomainState, DnsRecord } from "./provider";

/*
 * Cloudflare for SaaS.
 *
 * Registers the merchant's hostname as a custom hostname on Urivo's zone.
 * Cloudflare then issues and renews the TLS certificate and routes traffic to
 * the fallback origin, so Urivo never handles a certificate itself.
 *
 * The merchant's side is one CNAME. Everything else — validation, issuance,
 * renewal — happens between Cloudflare and their registrar.
 *
 * Configured by CLOUDFLARE_API_TOKEN (scoped to Zone → SSL and Certificates →
 * Edit on the Urivo zone only), CLOUDFLARE_ZONE_ID and URIVO_FALLBACK_ORIGIN.
 * With none of them set this provider reports itself unconfigured rather than
 * throwing, so the rest of the product runs untouched before DNS exists.
 */

const API = "https://api.cloudflare.com/client/v4";

interface CfOwnershipRecord {
  type?: string;
  name?: string;
  value?: string;
}
interface CfCustomHostname {
  id: string;
  hostname: string;
  status?: string;
  ssl?: { status?: string; validation_errors?: { message?: string }[]; validation_records?: CfOwnershipRecord[] };
  ownership_verification?: CfOwnershipRecord;
  verification_errors?: string[];
}
interface CfResponse<T> {
  success: boolean;
  result: T;
  errors?: { message?: string }[];
}

export function cloudflareConfigured(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN &&
      process.env.CLOUDFLARE_ZONE_ID &&
      process.env.URIVO_FALLBACK_ORIGIN,
  );
}

async function cf<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/zones/${process.env.CLOUDFLARE_ZONE_ID}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = (await res.json()) as CfResponse<T>;
  if (!res.ok || !body.success) {
    throw new Error(body.errors?.map((e) => e.message).filter(Boolean).join("; ") || `Cloudflare ${res.status}`);
  }
  return body.result;
}

/**
 * Translate Cloudflare's two-track state into one answer.
 *
 * A hostname is only usable when BOTH ownership is verified and the
 * certificate is active. Reporting "active" on either alone would send a
 * merchant to a domain that resolves to a TLS warning — worse than pending.
 */
function toState(h: CfCustomHostname, fallbackOrigin: string): DomainState {
  const records: DnsRecord[] = [
    {
      type: "CNAME",
      name: h.hostname,
      value: fallbackOrigin,
      purpose: "Points your domain at your store.",
    },
  ];
  const own = h.ownership_verification;
  if (own?.name && own.value) {
    records.push({
      type: (own.type?.toUpperCase() as DnsRecord["type"]) ?? "TXT",
      name: own.name,
      value: own.value,
      purpose: "Proves to the certificate authority that the domain is yours.",
    });
  }
  for (const v of h.ssl?.validation_records ?? []) {
    if (v.name && v.value) {
      records.push({
        type: (v.type?.toUpperCase() as DnsRecord["type"]) ?? "TXT",
        name: v.name,
        value: v.value,
        purpose: "Lets us issue the HTTPS certificate.",
      });
    }
  }

  const error =
    h.ssl?.validation_errors?.map((e) => e.message).filter(Boolean).join("; ") ||
    h.verification_errors?.filter(Boolean).join("; ") ||
    undefined;

  const live = h.status === "active" && h.ssl?.status === "active";
  const dead = h.status === "moved" || h.status === "deleted" || h.ssl?.status === "timing_out";

  return {
    status: live ? "active" : dead ? "failed" : error ? "verifying" : "pending",
    records,
    error,
  };
}

export function cloudflareProvider(): DomainProvider {
  const fallbackOrigin = process.env.URIVO_FALLBACK_ORIGIN ?? "";

  return {
    name: "cloudflare",

    async add(hostname) {
      const result = await cf<CfCustomHostname>("/custom_hostnames", {
        method: "POST",
        body: JSON.stringify({
          hostname,
          // http validation needs the domain already pointing here, which it
          // cannot be before the cert exists. txt breaks that circle.
          ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } },
        }),
      });
      return { ...toState(result, fallbackOrigin), providerId: result.id };
    },

    async check(providerId, hostname) {
      try {
        const result = await cf<CfCustomHostname>(`/custom_hostnames/${providerId}`);
        return toState(result, fallbackOrigin);
      } catch (err) {
        // A check that cannot reach Cloudflare is unknown, never failed — the
        // merchant's DNS is fine and telling them otherwise sends them to undo
        // correct work.
        return {
          status: "verifying",
          records: [],
          error: err instanceof Error ? err.message : "Could not reach the certificate provider.",
        };
      }
    },

    async remove(providerId) {
      try {
        await cf(`/custom_hostnames/${providerId}`, { method: "DELETE" });
      } catch {
        // Already gone upstream is the desired end state, not an error.
      }
    },
  };
}
