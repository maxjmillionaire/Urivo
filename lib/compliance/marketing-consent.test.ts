import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { weeklyDigestEmail, digestUnsubscribeUrl } from "@/lib/email/templates";

/*
 * Marketing consent, end to end:
 *   - it is OPT-IN (default false, migration 0061);
 *   - the weekly digest (a marketing email) reaches only opted-in users
 *     (migration 0062 gates weekly_digest_data on marketing_opt_in);
 *   - every digest carries a working one-click unsubscribe that turns marketing
 *     consent OFF (migration 0062 + the digest email + the public route).
 *
 * DB rules are asserted against the migration SQL (the same file-driven approach
 * as the other migration guards — no live database), and the email is a real
 * render.
 */

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
const read = (p: string) => readFileSync(join(MIGRATIONS, p), "utf8");

describe("marketing consent is opt-in (default false)", () => {
  function effectiveMarketingDefault(): "true" | "false" | null {
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    let current: "true" | "false" | null = null;
    for (const f of files) {
      for (const m of read(f).matchAll(/marketing_opt_in[^;]*default\s+(true|false)/gi)) {
        current = m[1].toLowerCase() as "true" | "false";
      }
    }
    return current;
  }

  it("the effective marketing_opt_in default across all migrations is false", () => {
    expect(effectiveMarketingDefault()).toBe("false");
  });

  it("migration 0061 sets the default to false", () => {
    expect(read("0061_marketing_opt_in_default_off.sql")).toMatch(
      /alter column marketing_opt_in set default false/i,
    );
  });

  it("setup_all.sql carries the opt-in-off migration", () => {
    const setup = readFileSync(join(MIGRATIONS, "..", "setup_all.sql"), "utf8");
    expect(setup).toContain("0061_marketing_opt_in_default_off");
    expect(setup).toMatch(/alter column marketing_opt_in set default false/i);
  });
});

describe("weekly digest only reaches opted-in users", () => {
  const gate = read("0062_weekly_digest_marketing_gate.sql");

  it("weekly_digest_data filters recipients on marketing_opt_in", () => {
    // An opted-out user is excluded at the data source (no email, no in-app digest).
    expect(gate).toMatch(/where\s+p\.marketing_opt_in/i);
  });

  it("still selects the recipient token so a live email can build an unsubscribe link", () => {
    expect(gate).toMatch(/marketing_unsub_token/);
  });
});

describe("unsubscribe turns marketing consent off", () => {
  const gate = read("0062_weekly_digest_marketing_gate.sql");

  it("unsubscribe_marketing_by_token sets marketing_opt_in = false", () => {
    expect(gate).toMatch(/update\s+public\.profiles\s+set\s+marketing_opt_in\s*=\s*false/i);
  });

  it("the unsubscribe function is anon-executable (one-click, not signed in)", () => {
    expect(gate).toMatch(/grant execute on function public\.unsubscribe_marketing_by_token\(uuid\) to anon/i);
  });

  it("the public route invokes unsubscribe_marketing_by_token", () => {
    const route = readFileSync(
      join(__dirname, "..", "..", "app", "api", "unsubscribe", "marketing", "route.ts"),
      "utf8",
    );
    expect(route).toMatch(/\.rpc\(\s*"unsubscribe_marketing_by_token"/);
  });
});

describe("the digest email carries a working unsubscribe link", () => {
  const base = {
    headline: "Here's your week.",
    nudge: "Keep going.",
    stats: [{ label: "Stores live", value: "1 of 1" }],
    ctaLabel: "Open your dashboard",
    ctaPath: "/dashboard",
  };

  it("renders the marketing unsubscribe URL in HTML and plain text when a token is present", () => {
    const email = weeklyDigestEmail({ ...base, unsubToken: "tok-123" });
    const expected = digestUnsubscribeUrl("tok-123");
    expect(expected).toContain("/api/unsubscribe/marketing?t=tok-123");
    expect(email.html).toContain(expected);
    expect(email.html.toLowerCase()).toContain("unsubscribe");
    expect(email.text).toContain(expected);
  });

  it("omits the unsubscribe link when no token is supplied (transactional emails are unaffected)", () => {
    const email = weeklyDigestEmail({ ...base });
    expect(email.html).not.toContain("/api/unsubscribe/marketing");
    expect(email.text).not.toContain("/api/unsubscribe/marketing");
  });
});
