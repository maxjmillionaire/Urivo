import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The Founding 50 offer, as the PUBLIC page depends on it.
 *
 * Both cases here are regressions that already happened once. Adding the
 * counter read to the landing page turned a static route into one that needed a
 * database and a service-role secret at BUILD time, and CI — which builds with
 * placeholder credentials on purpose — failed on `next build` with
 * "Error occurred prerendering page /". Locally it passed, because a local
 * .env holds real keys, so the difference was invisible until CI ran.
 *
 * The env failure was the symptom. The defect underneath it was that a page
 * showing a live price was being baked at build time at all: prerendered, it
 * would go on quoting €29 after the 50th signup until someone redeployed.
 */

const ROOT = join(__dirname, "..", "..");

describe("the landing page is not prerendered while it prices from live state", () => {
  const landing = readFileSync(join(ROOT, "app", "(platform)", "page.tsx"), "utf8");
  const code = landing
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/^\s*\/\/.*$/gm, "");

  it("declares force-dynamic", () => {
    expect(
      code,
      "the page reads the Founding 50 counter, so it must render per request",
    ).toMatch(/export const dynamic\s*=\s*["']force-dynamic["']/);
  });

  it("still reads the counter — the two belong together", () => {
    /*
     * If the counter read is ever removed, force-dynamic becomes a needless
     * cost and this pair should be revisited deliberately rather than left
     * behind. If the read stays and force-dynamic goes, the build breaks again.
     */
    expect(code).toMatch(/getFoundingOffer/);
  });
});

describe("getFoundingOffer fails closed", () => {
  const REAL = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...REAL };
    vi.resetModules();
  });

  it("returns a closed offer when the service-role key is missing, instead of throwing", async () => {
    /*
     * supabaseAdmin() throws before any query when the key is absent. An
     * unguarded call took the whole marketing page down with a 500; the honest
     * fallback is the standard price, which is true whatever the counter says.
     */
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const { getFoundingOffer } = await import("./settings");
    await expect(getFoundingOffer()).resolves.toEqual({ open: false, remaining: 0 });
  });

  it("never reports the offer open on a failure path", async () => {
    // The direction of the fallback is the whole point: closed under-promises,
    // open would quote a price checkout refuses.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { getFoundingOffer } = await import("./settings");
    const offer = await getFoundingOffer();
    expect(offer.open).toBe(false);
  });
});
