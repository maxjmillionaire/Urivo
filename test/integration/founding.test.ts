import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbFromEnv, client, PREFIX } from "./db";

/*
 * The Founding 50 counter, against a real database.
 *
 * Both halves of this are SQL — a trigger on auth.users that claims a spot
 * (0023) and a trigger on profiles that releases it (0048) — so a unit test
 * could only assert that the migration text contains the words. The rules being
 * checked here are the ones the offer is actually sold on:
 *
 *   • a signup claims exactly one spot
 *   • deleting that account gives the spot back
 *   • deleting a standard account changes nothing
 *   • the counter never passes the cap, however many people sign up
 *
 * The drift this guards against was real: the live counter read 10 while one
 * founding profile existed, which would have closed the offer after 41
 * merchants instead of 50, with no error anywhere.
 *
 * Opt-in (URIVO_INTEGRATION_DB=1), creates only its own prefixed accounts, and
 * restores platform_settings to the exact values it found.
 */

const db = dbFromEnv();
const run = db ? describe : describe.skip;

run("Founding 50 — claim and release", () => {
  /*
   * Built only when a database is configured. `describe.skip` still executes
   * this body during collection, so constructing a client from a null db would
   * crash the file instead of skipping it — the suite would look broken on a
   * machine that simply has no database, which is the normal case.
   */
  const api = db ? client(db) : (null as unknown as ReturnType<typeof client>);
  const created: string[] = [];
  let originalCap = 50;
  let originalClaimed = 0;

  /** The single settings row, read fresh. */
  async function settings(): Promise<{ founding_cap: number; founding_claimed: number }> {
    const r = await api.rest<{ founding_cap: number; founding_claimed: number }[]>(
      "platform_settings?select=founding_cap,founding_claimed&id=eq.true",
    );
    if (!r.ok || !r.body?.length) throw new Error(`settings read failed: ${JSON.stringify(r.body)}`);
    return r.body[0];
  }

  async function setClaimed(n: number, cap = originalCap): Promise<void> {
    const r = await api.rest("platform_settings?id=eq.true", {
      method: "PATCH",
      body: JSON.stringify({ founding_claimed: n, founding_cap: cap }),
    });
    if (!r.ok) throw new Error(`settings write failed: ${JSON.stringify(r.body)}`);
  }

  /*
   * Signs up through the Auth admin API, not by inserting a profile. The claim
   * lives in a trigger on auth.users, so inserting a profile directly would
   * bypass the very thing under test.
   */
  async function signUp(label: string): Promise<{ id: string; priceType: string }> {
    const email = `${PREFIX}-${label}-${crypto.randomUUID()}@urivo-itest.invalid`;
    const res = await fetch(`${db!.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: db!.key, Authorization: `Bearer ${db!.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: crypto.randomUUID(), email_confirm: true }),
    });
    const body = (await res.json()) as { id?: string; msg?: string };
    if (!res.ok || !body.id) throw new Error(`signup failed ${res.status}: ${JSON.stringify(body)}`);
    created.push(body.id);

    const p = await api.rest<{ price_type: string }[]>(`profiles?select=price_type&id=eq.${body.id}`);
    if (!p.ok || !p.body?.length) throw new Error(`profile not provisioned: ${JSON.stringify(p.body)}`);
    return { id: body.id, priceType: p.body[0].price_type };
  }

  async function remove(userId: string): Promise<void> {
    const res = await fetch(`${db!.url}/auth/v1/admin/users/${userId}`, {
      method: "DELETE",
      headers: { apikey: db!.key, Authorization: `Bearer ${db!.key}` },
    });
    if (!res.ok) throw new Error(`delete failed ${res.status}`);
    created.splice(created.indexOf(userId), 1);
  }

  beforeAll(async () => {
    const s = await settings();
    originalCap = s.founding_cap;
    originalClaimed = s.founding_claimed;
  });

  afterAll(async () => {
    for (const id of [...created]) await remove(id).catch(() => undefined);
    await setClaimed(originalClaimed, originalCap);
    const s = await settings();
    // The suite must leave the counter exactly as it found it.
    expect(s.founding_claimed).toBe(originalClaimed);
    expect(s.founding_cap).toBe(originalCap);
  });

  it("a signup claims exactly one spot", async () => {
    await setClaimed(0);
    const user = await signUp("claim");
    expect(user.priceType).toBe("founding");
    expect((await settings()).founding_claimed).toBe(1);
    await remove(user.id);
  });

  it("deleting a founding account releases the spot", async () => {
    await setClaimed(0);
    const user = await signUp("release");
    expect(user.priceType).toBe("founding");
    expect((await settings()).founding_claimed).toBe(1);

    await remove(user.id);
    expect((await settings()).founding_claimed).toBe(0);
  });

  it("deleting a standard account leaves the counter alone", async () => {
    // Cap reached, so this signup is stamped 'standard' and holds no spot.
    await setClaimed(originalCap);
    const user = await signUp("standard");
    expect(user.priceType).toBe("standard");
    expect((await settings()).founding_claimed).toBe(originalCap);

    await remove(user.id);
    expect((await settings()).founding_claimed).toBe(originalCap);
  });

  it("the counter never passes the cap", async () => {
    await setClaimed(originalCap - 1);

    const last = await signUp("last");
    expect(last.priceType).toBe("founding");
    expect((await settings()).founding_claimed).toBe(originalCap);

    // The 51st: offered nothing, and the counter does not move past the cap.
    const over = await signUp("over");
    expect(over.priceType).toBe("standard");
    expect((await settings()).founding_claimed).toBe(originalCap);

    await remove(over.id);
    expect((await settings()).founding_claimed).toBe(originalCap);

    // Releasing the real founding member frees exactly one seat again.
    await remove(last.id);
    expect((await settings()).founding_claimed).toBe(originalCap - 1);
  });

  it("a release can never drive the counter below zero", async () => {
    await setClaimed(0);
    const user = await signUp("floor");
    expect(user.priceType).toBe("founding");
    await setClaimed(0); // force the counter under the row that is about to release
    await remove(user.id);
    expect((await settings()).founding_claimed).toBe(0);
  });
});
