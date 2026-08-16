#!/usr/bin/env node
/*
 * Cross-tenant isolation, proven through the same door a browser uses.
 *
 * WHY THIS EXISTS ALONGSIDE adversarial-tenancy.sh
 *
 * The psql suite is the better instrument and needs a database-owner
 * connection to seed fixtures and read ground truth around RLS. Production is
 * a hosted Supabase project: there is no owner connection, so that suite has
 * never run against the database that actually serves customers.
 *
 * This one needs no owner. It drives the REST API with the service-role key
 * for ground truth and a real signed-in session for the attack, which makes it
 * strictly closer to reality than psql was ever going to be — every probe
 * traverses the same PostgREST → RLS → grants path a browser traverses. What
 * it gives up is the ability to `set role`; it never needed that, because the
 * attacker here is a genuine second account holding a genuine JWT.
 *
 * WHAT MAKES A RESULT EVIDENCE
 *
 * The suite this replaces counted `where user_id = B` and accepted 0 as proof
 * of denial. 0 is also what an empty table returns, and production held one
 * profile, so "merchant B" never existed and 25 green lines described an empty
 * set. Every probe here is therefore a PAIR:
 *
 *     n_real  — counted with the service-role key, RLS bypassed
 *     n_seen  — counted as merchant A, through RLS and column grants
 *
 *   PASS          n_real > 0 AND n_seen = 0   → data existed and was withheld
 *   FAIL          n_seen > 0                  → merchant A read merchant B
 *   INCONCLUSIVE  n_real = 0                  → nothing to withhold; proves nothing
 *
 * INCONCLUSIVE is a first-class result and never counts as a pass. A suite
 * that cannot tell "denied" from "absent" is worse than no suite, because it
 * produces a green line a founder can quote at an investor.
 *
 * The same discipline applies in the other direction, and it is the half most
 * security scripts get wrong: a read that is PUBLIC BY DESIGN is not a breach.
 * An active store and its products are a shop window — the open internet is
 * meant to see them, so merchant A seeing them proves nothing about tenancy
 * either. Those probes are labelled BY-DESIGN and are reported separately from
 * the isolation verdict. To test the row filter honestly, merchant B is seeded
 * with an INACTIVE store as well, whose contents no one but B may see.
 *
 * Writes are never trusted to their own status code. PostgREST answers a
 * policy-blocked UPDATE with `200 []`, which is indistinguishable from a filter
 * that matched nothing. So every write probe reads B's value as service role,
 * attempts the write as A, reads it back as service role, and requires it to be
 * byte-identical. The status code is corroboration, not the assertion.
 *
 * WHAT IT COSTS THE DATABASE
 *
 * Two auth users, two stores each, and a handful of owned rows, all removed in
 * a `finally` block that runs even when a probe throws. Creating an account
 * claims a Founding 50 spot (0023) and deleting it releases one (0048), so the
 * counter is snapshotted before and asserted after — which re-verifies 0048 on
 * production as a side effect of cleaning up.
 *
 * Usage — credentials come from the environment, never from an argument:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/adversarial-tenancy-rest.mjs
 *
 * Exit 0 only when every isolation probe PASSED and every control PASSED.
 * Any FAIL, any INCONCLUSIVE, or a failed cleanup exits non-zero.
 */

import { randomUUID } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Credentials. Named individually, because "missing config" is the one error
// message that must never make the reader go and diff two files to find out
// which of three keys it meant.
// ─────────────────────────────────────────────────────────────────────────────

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

{
  const missing = [];
  if (!URL_BASE) missing.push("NEXT_PUBLIC_SUPABASE_URL   (or SUPABASE_URL)      — the project REST endpoint");
  if (!ANON) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) — signs merchant A in, and probes the public surface");
  if (!SERVICE) missing.push("SUPABASE_SERVICE_ROLE_KEY                          — creates the two test users and establishes ground truth");
  if (missing.length) {
    console.error("\n  Cannot run. This test is not skippable and has no offline mode:\n");
    for (const m of missing) console.error(`    MISSING  ${m}`);
    console.error(
      "\n  Set them in the environment (Railway → Variables, or a local .env that is\n" +
        "  never committed). Supabase Dashboard → Project Settings → API.\n" +
        "  The service-role key is a full-database credential: never put it in a\n" +
        "  browser, a chat window, a CI log or a commit.\n",
    );
    process.exit(2);
  }
}

const REST = `${URL_BASE}/rest/v1`;
const AUTH = `${URL_BASE}/auth/v1`;

// ─────────────────────────────────────────────────────────────────────────────
// Transport
// ─────────────────────────────────────────────────────────────────────────────

/** A caller identity: which apikey to present, and whose bearer token. */
const asService = { apikey: SERVICE, token: SERVICE, label: "service role" };
const asAnon = { apikey: ANON, token: ANON, label: "anon" };
/** Merchant A's real session, filled in once sign-in succeeds. */
const asMerchantA = { apikey: ANON, token: null, label: "merchant A" };

async function call(who, path, { method = "GET", body, prefer, base = REST } = {}) {
  const headers = {
    apikey: who.apikey,
    Authorization: `Bearer ${who.token}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* PostgREST returns text on some privilege errors; keep the raw body. */
  }
  return { status: res.status, ok: res.ok, json, text, headers: res.headers };
}

/**
 * Exact row count through whatever privileges `who` holds.
 *
 * Returns -1 when the request was REFUSED (401/403) rather than answered with
 * zero rows. The distinction matters: a refusal is a grant-level denial and a
 * zero is a policy-level denial, both are correct outcomes, and a reader
 * debugging a FAIL needs to know which mechanism was supposed to fire.
 */
async function count(who, table, query) {
  const res = await call(who, `/${table}?${query}&select=id`, { prefer: "count=exact" });
  if (res.status === 401 || res.status === 403) return { n: -1, refused: true, res };
  const range = res.headers.get("content-range") || "";
  const total = Number(range.split("/")[1]);
  return { n: Number.isFinite(total) ? total : (res.json?.length ?? 0), refused: false, res };
}

// ─────────────────────────────────────────────────────────────────────────────
// Result recording
// ─────────────────────────────────────────────────────────────────────────────

const C = process.stdout.isTTY
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", b: "\x1b[34m", d: "\x1b[2m", x: "\x1b[0m" }
  : { g: "", r: "", y: "", b: "", d: "", x: "" };

const results = [];
const tally = { pass: 0, fail: 0, inconclusive: 0, byDesign: 0 };

function record(verdict, group, label, detail) {
  results.push({ verdict, group, label, detail });
  const tag = {
    PASS: `${C.g}PASS        ${C.x}`,
    FAIL: `${C.r}FAIL        ${C.x}`,
    INCONCLUSIVE: `${C.y}INCONCLUSIVE${C.x}`,
    "BY-DESIGN": `${C.b}BY-DESIGN   ${C.x}`,
  }[verdict];
  console.log(`  ${tag}  ${label.padEnd(48)} ${C.d}${detail}${C.x}`);
  if (verdict === "PASS") tally.pass++;
  else if (verdict === "FAIL") tally.fail++;
  else if (verdict === "INCONCLUSIVE") tally.inconclusive++;
  else tally.byDesign++;
}

/**
 * The paired isolation probe. `truthQuery` counts as service role; `seenQuery`
 * counts as merchant A. Denial is only ever asserted against data proven to be
 * there.
 */
async function isolationProbe(label, table, query, { group = "isolation" } = {}) {
  const truth = await count(asService, table, query);
  if (truth.n <= 0) {
    record("INCONCLUSIVE", group, label, `no victim rows existed (service role saw ${truth.n}); proves nothing`);
    return;
  }
  const seen = await count(asMerchantA, table, query);
  if (seen.refused) {
    record("PASS", group, label, `victim rows: ${truth.n}; merchant A refused at the grant (HTTP ${seen.res.status})`);
  } else if (seen.n === 0) {
    record("PASS", group, label, `victim rows: ${truth.n}; merchant A saw 0`);
  } else {
    record("FAIL", group, label, `victim rows: ${truth.n}; MERCHANT A SAW ${seen.n}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const stamp = Date.now().toString(36);
const fixture = {
  a: { email: `urivo-tenancy-a-${stamp}@example.invalid`, password: `A!${randomUUID()}`, id: null },
  b: { email: `urivo-tenancy-b-${stamp}@example.invalid`, password: `B!${randomUUID()}`, id: null },
};
/** Everything created, newest first, so cleanup can undo in reverse order. */
const created = { users: [] };
const ids = {};

async function createUser(who) {
  const res = await call(asService, "/admin/users", {
    base: AUTH,
    method: "POST",
    body: { email: who.email, password: who.password, email_confirm: true },
  });
  if (!res.ok || !res.json?.id) {
    throw new Error(`could not create ${who.email}: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  who.id = res.json.id;
  created.users.push(who.id);
  return who.id;
}

async function insert(table, row) {
  const res = await call(asService, `/${table}`, {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  if (!res.ok || !Array.isArray(res.json) || !res.json[0]) {
    throw new Error(`could not seed ${table}: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res.json[0];
}

async function signIn(who) {
  const res = await call(asAnon, "/token?grant_type=password", {
    base: AUTH,
    method: "POST",
    body: { email: who.email, password: who.password },
  });
  if (!res.ok || !res.json?.access_token) {
    throw new Error(`could not sign in ${who.email}: HTTP ${res.status} ${res.text.slice(0, 300)}`);
  }
  return res.json.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Baseline — recorded before anything is created, asserted after cleanup.
// ─────────────────────────────────────────────────────────────────────────────

async function readFoundingCounter() {
  const res = await call(asService, "/platform_settings?id=eq.true&select=founding_claimed,founding_cap");
  if (!res.ok || !res.json?.[0]) throw new Error(`could not read platform_settings: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  return res.json[0];
}

async function readProfileIds() {
  const res = await call(asService, "/profiles?select=id,email,price_type&order=created_at.asc");
  if (!res.ok) throw new Error(`could not read profiles: HTTP ${res.status} ${res.text.slice(0, 200)}`);
  return res.json ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

let baseline = null;

async function seed() {
  console.log(`\n${C.d}── Seeding ─────────────────────────────────────────────────────────────${C.x}`);

  await createUser(fixture.a);
  await createUser(fixture.b);
  console.log(`  merchant A  ${fixture.a.id}`);
  console.log(`  merchant B  ${fixture.b.id}`);

  /*
   * B's ACTIVE store is the one the handoff insists on: an inactive store is
   * hidden by the row filter, so a probe against it would pass without ever
   * testing ownership. B also gets an INACTIVE store, because the reverse
   * mistake is just as bad — an active store is public by design, so it cannot
   * test the row filter either. Both, labelled, or the suite is measuring the
   * wrong thing in one direction or the other.
   */
  ids.bActiveStore = (
    await insert("stores", {
      user_id: fixture.b.id,
      store_name: "Merchant B Live",
      subdomain: `zz-tenancy-b-live-${stamp}`,
      is_active: true,
      stripe_account_id: `acct_TENANCYPROBE_${stamp}`,
      stripe_charges_enabled: true,
    })
  ).id;

  ids.bDraftStore = (
    await insert("stores", {
      user_id: fixture.b.id,
      store_name: "Merchant B Draft",
      subdomain: `zz-tenancy-b-draft-${stamp}`,
      is_active: false,
    })
  ).id;

  ids.bLiveProduct = (
    await insert("products", {
      store_id: ids.bActiveStore,
      title: "B live product",
      description: "Seeded by the tenancy probe.",
      price_eur: 49.0,
    })
  ).id;

  ids.bDraftProduct = (
    await insert("products", {
      store_id: ids.bDraftStore,
      title: "B unpublished product",
      description: "Seeded by the tenancy probe.",
      price_eur: 99.0,
    })
  ).id;

  ids.bOrder = (
    await insert("orders", {
      store_id: ids.bActiveStore,
      customer_email: `victim-customer-${stamp}@example.invalid`,
      customer_name: "B's Customer",
      amount_subtotal: 4900,
      amount_total: 4900,
      status: "paid",
      stripe_session_id: `cs_tenancyprobe_${stamp}`,
    })
  ).id;

  await insert("store_visits", {
    store_id: ids.bActiveStore,
    session_hash: `tenancyprobe${stamp}`,
    path: "/",
    device: "desktop",
  });

  await insert("credit_ledger", {
    user_id: fixture.b.id,
    delta: 500,
    reason: "Tenancy probe fixture",
    source: "admin",
  });

  /* A gets a store of their own, so the control probes mean something. */
  ids.aStore = (
    await insert("stores", {
      user_id: fixture.a.id,
      store_name: "Merchant A Live",
      subdomain: `zz-tenancy-a-live-${stamp}`,
      is_active: true,
    })
  ).id;

  ids.aProduct = (
    await insert("products", {
      store_id: ids.aStore,
      title: "A product",
      description: "Seeded by the tenancy probe.",
      price_eur: 25.0,
    })
  ).id;

  await insert("orders", {
    store_id: ids.aStore,
    customer_email: `a-customer-${stamp}@example.invalid`,
    amount_subtotal: 2500,
    amount_total: 2500,
    status: "paid",
    stripe_session_id: `cs_tenancyprobe_a_${stamp}`,
  });

  asMerchantA.token = await signIn(fixture.a);
  console.log(`  merchant A signed in, JWT acquired`);
}

async function readProbes() {
  console.log(`\n${C.d}── Reads: merchant A against merchant B ────────────────────────────────${C.x}`);

  /*
   * The probe that matters most on `stores`. An active store's brand columns
   * are a shop window, so counting rows proves nothing — what must never leave
   * the tenant is the OWNER and the PAYOUT ACCOUNT. 0052 revoked anon's select
   * and granted back a column list that excludes exactly these three. It
   * revoked from `anon` only.
   */
  {
    const truth = await call(asService, `/stores?id=eq.${ids.bActiveStore}&select=user_id,stripe_account_id,stripe_charges_enabled`);
    const real = truth.json?.[0];
    if (!real?.user_id) {
      record("INCONCLUSIVE", "isolation", "A reads B's owner + Stripe account", "victim row not readable as service role");
    } else {
      const seen = await call(asMerchantA, `/stores?id=eq.${ids.bActiveStore}&select=user_id,stripe_account_id,stripe_charges_enabled`);
      if (seen.status === 401 || seen.status === 403) {
        record("PASS", "isolation", "A reads B's owner + Stripe account", `refused at the grant (HTTP ${seen.status})`);
      } else if (!seen.json?.length) {
        record("PASS", "isolation", "A reads B's owner + Stripe account", "merchant A saw 0 rows");
      } else {
        const got = seen.json[0];
        record(
          "FAIL",
          "isolation",
          "A reads B's owner + Stripe account",
          `A read user_id=${got.user_id} stripe_account_id=${got.stripe_account_id} charges_enabled=${got.stripe_charges_enabled}`,
        );
      }
    }
  }

  /* The row filter, tested where it is actually load-bearing. */
  await isolationProbe("A reads B's UNPUBLISHED store", "stores", `id=eq.${ids.bDraftStore}`);
  await isolationProbe("A reads B's unpublished product", "products", `id=eq.${ids.bDraftProduct}`);

  /* Owner-only surfaces. None of these has any public reading. */
  await isolationProbe("A reads B's orders", "orders", `store_id=eq.${ids.bActiveStore}`);
  await isolationProbe("A reads B's order by id (ID manipulation)", "orders", `id=eq.${ids.bOrder}`);
  await isolationProbe("A reads B's analytics (store_visits)", "store_visits", `store_id=eq.${ids.bActiveStore}`);
  await isolationProbe("A reads B's credits", "credit_ledger", `user_id=eq.${fixture.b.id}`);
  await isolationProbe("A reads B's profile", "profiles", `id=eq.${fixture.b.id}`);

  /* Customer PII, asked for by name rather than counted. */
  {
    const truth = await call(asService, `/orders?id=eq.${ids.bOrder}&select=customer_email`);
    const real = truth.json?.[0]?.customer_email;
    if (!real) {
      record("INCONCLUSIVE", "isolation", "A reads B's customer email", "no victim email existed");
    } else {
      const seen = await call(asMerchantA, `/orders?id=eq.${ids.bOrder}&select=customer_email`);
      const got = seen.json?.[0]?.customer_email;
      if (got) record("FAIL", "isolation", "A reads B's customer email", `A read ${got}`);
      else record("PASS", "isolation", "A reads B's customer email", `victim email existed; A saw none (HTTP ${seen.status})`);
    }
  }

  /*
   * Public by design. Reported so the matrix is complete and so nobody later
   * "fixes" these into a regression, but deliberately outside the isolation
   * verdict: the open internet is supposed to see a live shop.
   */
  console.log(`\n${C.d}── Public by design (not tenancy) ──────────────────────────────────────${C.x}`);
  {
    const s = await count(asMerchantA, "stores", `id=eq.${ids.bActiveStore}`);
    record("BY-DESIGN", "public", "A reads B's PUBLISHED store row", `A saw ${s.n} — a live storefront is public`);
    const p = await count(asMerchantA, "products", `store_id=eq.${ids.bActiveStore}`);
    record("BY-DESIGN", "public", "A reads B's PUBLISHED products", `A saw ${p.n} — a live catalogue is public`);
  }
}

async function writeProbes() {
  console.log(`\n${C.d}── Writes: merchant A against merchant B ───────────────────────────────${C.x}`);

  /**
   * Attempt a write as A, then prove the stored value did not move by reading
   * it back as service role. The HTTP status is printed but never believed.
   */
  async function mutationProbe(label, { table, query, column, patch, method = "PATCH" }) {
    const before = await call(asService, `/${table}?${query}&select=${column}`);
    const was = before.json?.[0]?.[column];
    if (was === undefined) {
      record("INCONCLUSIVE", "isolation", label, "victim row did not exist before the attempt");
      return;
    }

    const attempt = await call(asMerchantA, `/${table}?${query}`, {
      method,
      body: patch,
      prefer: "return=representation",
    });

    const after = await call(asService, `/${table}?${query}&select=${column}`);
    const now = after.json?.[0]?.[column];

    if (now === undefined) {
      record("FAIL", "isolation", label, `victim row is GONE after A's ${method} (HTTP ${attempt.status})`);
    } else if (JSON.stringify(now) !== JSON.stringify(was)) {
      record("FAIL", "isolation", label, `${column} changed ${JSON.stringify(was)} → ${JSON.stringify(now)}`);
    } else {
      const how = attempt.status === 401 || attempt.status === 403 ? `refused at the grant (HTTP ${attempt.status})` : `HTTP ${attempt.status}, value unchanged`;
      record("PASS", "isolation", label, `${column} still ${JSON.stringify(was)}; ${how}`);
    }
  }

  await mutationProbe("A renames B's store", {
    table: "stores",
    query: `id=eq.${ids.bActiveStore}`,
    column: "store_name",
    patch: { store_name: "OWNED BY MERCHANT A" },
  });

  await mutationProbe("A takes ownership of B's store", {
    table: "stores",
    query: `id=eq.${ids.bActiveStore}`,
    column: "user_id",
    patch: { user_id: fixture.a.id },
  });

  await mutationProbe("A unpublishes B's store", {
    table: "stores",
    query: `id=eq.${ids.bActiveStore}`,
    column: "is_active",
    patch: { is_active: false },
  });

  await mutationProbe("A modifies B's product price", {
    table: "products",
    query: `id=eq.${ids.bLiveProduct}`,
    column: "price_eur",
    patch: { price_eur: 0.01 },
  });

  await mutationProbe("A deletes B's store", {
    table: "stores",
    query: `id=eq.${ids.bActiveStore}`,
    column: "store_name",
    method: "DELETE",
  });

  await mutationProbe("A deletes B's order", {
    table: "orders",
    query: `id=eq.${ids.bOrder}`,
    column: "customer_email",
    method: "DELETE",
  });

  /* INSERT needs its own shape: success is a row appearing that should not. */
  {
    const before = await count(asService, "products", `store_id=eq.${ids.bActiveStore}`);
    const attempt = await call(asMerchantA, "/products", {
      method: "POST",
      body: {
        store_id: ids.bActiveStore,
        title: "Injected by merchant A",
        description: "If you can read this in production, tenancy is broken.",
        price_eur: 1.0,
      },
      prefer: "return=representation",
    });
    const after = await count(asService, "products", `store_id=eq.${ids.bActiveStore}`);
    if (after.n > before.n) {
      record("FAIL", "isolation", "A inserts a product into B's store", `product count ${before.n} → ${after.n} (HTTP ${attempt.status})`);
      const injected = attempt.json?.[0]?.id;
      if (injected) ids.injectedProduct = injected;
    } else {
      const how = attempt.status === 401 || attempt.status === 403 ? `refused at the grant (HTTP ${attempt.status})` : `HTTP ${attempt.status}, no row added`;
      record("PASS", "isolation", "A inserts a product into B's store", `count still ${before.n}; ${how}`);
    }
  }

  /* Privilege escalation on A's own row — 0045's territory, re-checked here. */
  await mutationProbe("A upgrades their own plan to pro", {
    table: "profiles",
    query: `id=eq.${fixture.a.id}`,
    column: "plan",
    patch: { plan: "pro", subscription_status: "active" },
  });
}

async function controlProbes() {
  console.log(`\n${C.d}── Controls: isolation must not break legitimate access ────────────────${C.x}`);

  async function control(label, table, query, { min = 1 } = {}) {
    const seen = await count(asMerchantA, table, query);
    if (seen.refused) record("FAIL", "control", label, `merchant A was REFUSED on their own data (HTTP ${seen.res.status})`);
    else if (seen.n >= min) record("PASS", "control", label, `merchant A saw ${seen.n}`);
    else record("FAIL", "control", label, `merchant A saw ${seen.n}, expected at least ${min}`);
  }

  await control("A reads A's own store", "stores", `id=eq.${ids.aStore}`);
  await control("A reads A's own products", "products", `store_id=eq.${ids.aStore}`);
  await control("A reads A's own orders", "orders", `store_id=eq.${ids.aStore}`);
  await control("A reads A's own credits", "credit_ledger", `user_id=eq.${fixture.a.id}`);
  await control("A reads A's own profile", "profiles", `id=eq.${fixture.a.id}`);

  /* The one write a merchant is genuinely allowed to make on their own store. */
  {
    const renamed = `Renamed By Owner ${stamp}`;
    const attempt = await call(asMerchantA, `/stores?id=eq.${ids.aStore}`, {
      method: "PATCH",
      body: { store_name: renamed },
      prefer: "return=representation",
    });
    const after = await call(asService, `/stores?id=eq.${ids.aStore}&select=store_name`);
    if (after.json?.[0]?.store_name === renamed) {
      record("PASS", "control", "A renames A's own store", `store_name is now ${JSON.stringify(renamed)}`);
    } else {
      record("FAIL", "control", "A renames A's own store", `write did not stick (HTTP ${attempt.status}); still ${JSON.stringify(after.json?.[0]?.store_name)}`);
    }
  }
}

async function regressionAudit() {
  console.log(`\n${C.d}── Regression: anonymous vs service role ───────────────────────────────${C.x}`);

  /*
   * The public surface, re-measured. `stores` and `products` are expected to
   * be partially visible — that is the storefront. The other four must be
   * fully invisible, and each line prints the population it was measured
   * against so a zero can never be mistaken for an empty table.
   */
  const surfaces = [
    { table: "stores", public: true },
    { table: "products", public: true },
    { table: "orders", public: false },
    { table: "store_visits", public: false },
    { table: "credit_ledger", public: false },
    { table: "profiles", public: false },
  ];

  for (const s of surfaces) {
    const truth = await count(asService, s.table, "id=not.is.null");
    const seen = await count(asAnon, s.table, "id=not.is.null");
    if (truth.n <= 0) {
      record("INCONCLUSIVE", "regression", `anon reads ${s.table}`, "table is empty; proves nothing");
      continue;
    }
    if (s.public) {
      record("BY-DESIGN", "regression", `anon reads ${s.table}`, `${seen.refused ? "refused" : seen.n} of ${truth.n} visible — storefront surface`);
    } else if (seen.refused || seen.n === 0) {
      record("PASS", "regression", `anon reads ${s.table}`, `${truth.n} rows exist; anon saw ${seen.refused ? `refused (HTTP ${seen.res.status})` : "0"}`);
    } else {
      record("FAIL", "regression", `anon reads ${s.table}`, `${truth.n} rows exist; ANON SAW ${seen.n}`);
    }
  }

  /* 0052's three excluded columns must still be refused to anon. */
  for (const col of ["user_id", "stripe_account_id", "stripe_charges_enabled"]) {
    const res = await call(asAnon, `/stores?select=${col}&limit=1`);
    if (res.status === 401 || res.status === 403) {
      record("PASS", "regression", `anon reads stores.${col}`, `refused (HTTP ${res.status}) — 0052 holding`);
    } else {
      record("FAIL", "regression", `anon reads stores.${col}`, `HTTP ${res.status} ${JSON.stringify(res.json)?.slice(0, 120)}`);
    }
  }

  /*
   * And the storefront itself must still work. This is the exact column set
   * app/(store)/store/[subdomain]/page.tsx selects — 0052 broke precisely this
   * and 0053 repaired it, so it is the one query worth pinning verbatim.
   */
  {
    const res = await call(asAnon, "/stores?select=id,store_name,theme_config,currency,is_active&is_active=eq.true&limit=1");
    if (res.status === 200) record("PASS", "regression", "storefront store query (anon)", "HTTP 200 — 0053 holding");
    else record("FAIL", "regression", "storefront store query (anon)", `HTTP ${res.status} ${res.text.slice(0, 160)}`);
  }
  {
    const res = await call(asAnon, "/products?select=id,title,description,price_eur,image_url&limit=1");
    if (res.status === 200) record("PASS", "regression", "storefront products query (anon)", "HTTP 200 — 0053 holding");
    else record("FAIL", "regression", "storefront products query (anon)", `HTTP ${res.status} ${res.text.slice(0, 160)}`);
  }
}

async function cleanup() {
  console.log(`\n${C.d}── Cleanup ─────────────────────────────────────────────────────────────${C.x}`);

  /*
   * A product A managed to inject into B's store is not owned by either user's
   * cascade path in an obvious way, so remove it explicitly before the users go.
   */
  if (ids.injectedProduct) {
    await call(asService, `/products?id=eq.${ids.injectedProduct}`, { method: "DELETE" });
  }

  /* auth.users → profiles → stores → products/orders/visits, all by cascade. */
  for (const id of created.users) {
    const res = await call(asService, `/admin/users/${id}`, { base: AUTH, method: "DELETE" });
    console.log(`  deleted user ${id} ${res.ok ? "" : `(HTTP ${res.status} ${res.text.slice(0, 160)})`}`);
  }

  let clean = true;

  /* Nothing we made may survive. */
  const leftovers = [
    ["stores", `subdomain=like.zz-tenancy-*${stamp}`],
    ["profiles", `id=in.(${[fixture.a.id, fixture.b.id].filter(Boolean).join(",") || randomUUID()})`],
  ];
  for (const [table, query] of leftovers) {
    const res = await count(asService, table, query);
    if (res.n > 0) {
      record("FAIL", "cleanup", `${table} fully removed`, `${res.n} row(s) survived cleanup — REMOVE BY HAND`);
      clean = false;
    } else {
      record("PASS", "cleanup", `${table} fully removed`, "0 rows survive");
    }
  }

  /*
   * The Founding 50 counter. Creating an account claims a spot (0023); deleting
   * one releases it (0048). Returning to exactly the number we started at is
   * the proof that 0048 works on production, which is the only place it has
   * never been exercised.
   */
  const after = await readFoundingCounter();
  if (after.founding_claimed === baseline.founding.founding_claimed) {
    record(
      "PASS",
      "cleanup",
      "Founding 50 counter restored",
      `founding_claimed ${baseline.founding.founding_claimed} → (2 accounts) → ${after.founding_claimed}; 0048 verified on production`,
    );
  } else {
    record(
      "FAIL",
      "cleanup",
      "Founding 50 counter restored",
      `founding_claimed was ${baseline.founding.founding_claimed}, is now ${after.founding_claimed} — a spot leaked`,
    );
    clean = false;
  }

  const profilesAfter = await readProfileIds();
  const beforeIds = new Set(baseline.profiles.map((p) => p.id));
  const extra = profilesAfter.filter((p) => !beforeIds.has(p.id));
  if (extra.length === 0 && profilesAfter.length === baseline.profiles.length) {
    record("PASS", "cleanup", "profile list restored", `${profilesAfter.length} profiles, identical to baseline`);
  } else {
    record("FAIL", "cleanup", "profile list restored", `baseline ${baseline.profiles.length}, now ${profilesAfter.length}${extra.length ? `, extra: ${extra.map((p) => p.email).join(", ")}` : ""}`);
    clean = false;
  }

  return clean;
}

function verdict() {
  console.log(`\n${C.d}════ Matrix ════════════════════════════════════════════════════════════${C.x}\n`);
  for (const group of ["isolation", "control", "regression", "cleanup", "public"]) {
    const rows = results.filter((r) => r.group === group);
    if (!rows.length) continue;
    console.log(`  ${group.toUpperCase()}`);
    for (const r of rows) console.log(`    ${r.verdict.padEnd(13)} ${r.label}`);
    console.log("");
  }

  const isolation = results.filter((r) => r.group === "isolation");
  const failures = results.filter((r) => r.verdict === "FAIL");
  const unknowns = results.filter((r) => r.verdict === "INCONCLUSIVE");

  console.log(
    `  ${C.g}${tally.pass} passed${C.x} · ${C.r}${tally.fail} failed${C.x} · ` +
      `${C.y}${tally.inconclusive} inconclusive${C.x} · ${C.b}${tally.byDesign} by design${C.x}\n`,
  );

  const isolationClean = isolation.every((r) => r.verdict === "PASS");
  const controlsClean = results.filter((r) => r.group === "control").every((r) => r.verdict === "PASS");

  if (isolationClean && controlsClean && !failures.length && !unknowns.length) {
    console.log(`  ${C.g}SUPPORTED${C.x} — "Every store is multi-tenant isolated with row-level`);
    console.log(`  security verified adversarially." Authenticated cross-tenant probes ran`);
    console.log(`  against seeded victim data and every one was denied.\n`);
    return 0;
  }

  console.log(`  ${C.r}NOT SUPPORTED${C.x} — do not upgrade the public wording. The strongest`);
  console.log(`  claim the evidence carries remains:\n`);
  console.log(`    "Row-level security on all 28 tables, with public-surface isolation`);
  console.log(`     verified by measurement against a populated production database."\n`);
  if (failures.length) {
    console.log(`  ${C.r}Failures:${C.x}`);
    for (const f of failures) console.log(`    · ${f.label} — ${f.detail}`);
    console.log("");
  }
  if (unknowns.length) {
    console.log(`  ${C.y}Inconclusive (proves nothing, not a pass):${C.x}`);
    for (const u of unknowns) console.log(`    · ${u.label} — ${u.detail}`);
    console.log("");
  }
  return 1;
}

async function main() {
  console.log(`\n  Adversarial tenancy — authenticated, two merchants, against ${URL_BASE}`);

  baseline = { founding: await readFoundingCounter(), profiles: await readProfileIds() };
  console.log(
    `  baseline: founding_claimed ${baseline.founding.founding_claimed}/${baseline.founding.founding_cap}, ` +
      `${baseline.profiles.length} profile(s)`,
  );

  let cleanupOk = false;
  try {
    await seed();
    await readProbes();
    await writeProbes();
    await controlProbes();
    await regressionAudit();
  } finally {
    /*
     * Cleanup runs even when a probe throws. A half-seeded production database
     * is a worse outcome than a missing result, and the two test accounts are
     * holding Founding 50 spots until they are gone.
     */
    cleanupOk = await cleanup().catch((e) => {
      console.error(`\n  ${C.r}CLEANUP FAILED${C.x} — ${e.message}`);
      console.error(`  Remove by hand: users ${created.users.join(", ")}, subdomains matching zz-tenancy-*${stamp}\n`);
      return false;
    });
  }

  process.exit(verdict() || (cleanupOk ? 0 : 1));
}

main().catch((e) => {
  console.error(`\n  ${C.r}ABORTED${C.x} — ${e.message}\n`);
  process.exit(2);
});
