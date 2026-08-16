import { readFileSync, existsSync } from "node:fs";

/*
 * Integration-test harness for the attribution subsystem.
 *
 * These tests run against a REAL database, because the thing being tested is
 * SQL. Vitest cannot execute migrations, so the attribution rules — the window,
 * first-write-wins, tenant isolation, the retention predicate — have no
 * meaningful unit test. They were verified once by hand and would have rotted
 * the moment nobody re-ran the script.
 *
 * Three properties make that safe enough to keep in the repository:
 *
 *   OPT-IN. Skipped unless URIVO_INTEGRATION_DB=1 is set explicitly, so `npm
 *   test` stays green with no database and CI cannot wander into one by
 *   accident.
 *
 *   OWNED ROWS ONLY. Every row created here carries a recognisable prefix and
 *   is tracked for deletion. Nothing pre-existing is ever touched.
 *
 *   PROVEN CLEANUP. Table counts are captured before and compared after. A
 *   test suite that leaves debris in a merchant's analytics is worse than no
 *   test suite, so the reconciliation is an assertion, not a hope.
 */

export const PREFIX = "urivo-itest";

export interface Db {
  url: string;
  key: string;
}

/** Loaded from the environment, falling back to .env so a local run just works. */
export function dbFromEnv(): Db | null {
  if (process.env.URIVO_INTEGRATION_DB !== "1") return null;

  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if ((!url || !key) && existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (k === "NEXT_PUBLIC_SUPABASE_URL") url ??= v;
      if (k === "SUPABASE_SERVICE_ROLE_KEY") key ??= v;
    }
  }
  return url && key ? { url, key } : null;
}

export interface RestResult<T = unknown> {
  ok: boolean;
  status: number;
  body: T;
}

export function client(db: Db) {
  const headers = {
    apikey: db.key,
    Authorization: `Bearer ${db.key}`,
    "Content-Type": "application/json",
  };

  async function rest<T = unknown>(path: string, init: RequestInit = {}): Promise<RestResult<T>> {
    const res = await fetch(`${db.url}/rest/v1/${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: (text ? JSON.parse(text) : null) as T };
  }

  /**
   * Call a database function and THROW on a non-2xx.
   *
   * This is the whole reason the harness exists rather than inline fetches. A
   * 42804 raised by attribute_order once survived a full end-to-end run because
   * the check read the row afterwards, found the column default, and called it
   * an answer. Reading a row cannot distinguish "decided" from "crashed".
   */
  async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await rest<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`${fn} returned ${r.status}: ${JSON.stringify(r.body)}`);
    return r.body;
  }

  async function count(path: string): Promise<number> {
    const res = await fetch(`${db.url}/rest/v1/${path}`, {
      headers: { ...headers, Prefer: "count=exact", Range: "0-0" },
    });
    return Number((res.headers.get("content-range") ?? "/0").split("/")[1]) || 0;
  }

  return { rest, rpc, count };
}

/** Rows this run created, deleted in reverse dependency order. */
export class Fixtures {
  readonly creatives: string[] = [];
  readonly orders: string[] = [];
  readonly sessions: string[] = [];

  constructor(private readonly api: ReturnType<typeof client>) {}

  session(label: string): string {
    const id = `${PREFIX}-${label}-${crypto.randomUUID()}`;
    this.sessions.push(id);
    return id;
  }

  async creative(storeId: string, headline: string): Promise<string> {
    const r = await this.api.rest<{ id: string }[]>("ad_creatives?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: storeId,
        run_id: crypto.randomUUID(),
        platform: "Meta",
        format: "feed",
        angle: "test",
        headline: `${PREFIX} ${headline}`,
        primary_text: "p",
        cta: "Shop Now",
      }),
    });
    if (!r.ok) throw new Error(`creative insert failed: ${JSON.stringify(r.body)}`);
    const id = r.body[0].id;
    this.creatives.push(id);
    return id;
  }

  /** `agoMs` backdates the row, which is how the window and retention are tested. */
  async visit(
    storeId: string,
    session: string,
    creativeId: string | null,
    agoMs = 0,
    isBot = false,
  ): Promise<void> {
    const r = await this.api.rest("store_visits", {
      method: "POST",
      body: JSON.stringify({
        store_id: storeId,
        session_hash: session,
        path: "/",
        creative_id: creativeId,
        is_bot: isBot,
        created_at: new Date(Date.now() - agoMs).toISOString(),
      }),
    });
    if (!r.ok) throw new Error(`visit insert failed: ${JSON.stringify(r.body)}`);
  }

  async order(
    storeId: string,
    opts: { email?: string; cents?: number; agoMs?: number; session?: string } = {},
  ): Promise<string> {
    const r = await this.api.rest<{ id: string }[]>("orders?select=id", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        store_id: storeId,
        stripe_session_id: `${PREFIX}_${crypto.randomUUID()}`,
        customer_email: opts.email ?? `${PREFIX}@example.invalid`,
        amount_subtotal: opts.cents ?? 8600,
        amount_total: opts.cents ?? 8600,
        currency: "eur",
        status: "paid",
        ...(opts.session ? { session_hash: opts.session } : {}),
        ...(opts.agoMs ? { created_at: new Date(Date.now() - opts.agoMs).toISOString() } : {}),
      }),
    });
    if (!r.ok) throw new Error(`order insert failed: ${JSON.stringify(r.body)}`);
    const id = r.body[0].id;
    this.orders.push(id);
    return id;
  }

  async basisOf(orderId: string): Promise<{ attribution_basis: string; creative_id: string | null }> {
    const r = await this.api.rest<{ attribution_basis: string; creative_id: string | null }[]>(
      `orders?select=attribution_basis,creative_id&id=eq.${orderId}`,
    );
    return r.body[0];
  }

  /** Orders first: a creative is referenced by the visits and orders around it. */
  async cleanup(): Promise<void> {
    for (const id of this.orders) await this.api.rest(`orders?id=eq.${id}`, { method: "DELETE" });
    for (const s of this.sessions)
      await this.api.rest(`store_visits?session_hash=eq.${s}`, { method: "DELETE" });
    for (const id of this.creatives)
      await this.api.rest(`ad_creatives?id=eq.${id}`, { method: "DELETE" });
  }
}
