#!/usr/bin/env node
/*
 * Presentation capture — a full set of product screenshots, desktop and mobile,
 * from a running build.
 *
 * This exists because the screenshots themselves must not live in the
 * repository. A full set is ~56 MB of PNGs that go stale the next time anyone
 * touches a gradient, and git keeps every version of a binary forever. The
 * script is the durable artifact: it regenerates the whole set in about two
 * minutes, against whatever the product looks like today.
 *
 *   BASE_URL=http://127.0.0.1:3300 \
 *   SHOT_COOKIES=/tmp/demo-cookies.json \
 *   SHOT_STORE_ID=<uuid> \
 *   node scripts/capture-screenshots.mjs
 *
 * Output lands in screenshots/investor/ (gitignored) as
 * <viewport>-<nn>-<name>.png.
 *
 * Signed-in routes need SHOT_COOKIES: a Playwright cookie array for an account
 * that has stores, credits and history. Without it the run still captures every
 * public page and skips the rest rather than filling the set with login
 * redirects — a deck built from empty states sells nothing.
 *
 * A note on plans: the billing page hides the plan picker for accounts already
 * on Pro, so capturing the pricing screens means signing in as an account on a
 * lower plan. Switch the demo account first; do not add a query parameter to
 * the product for the benefit of a screenshot.
 */

import { mkdirSync, readFileSync, existsSync } from "node:fs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3300").replace(/\/$/, "");
const OUT = process.env.SHOT_OUT || "screenshots/investor";
const COOKIES = process.env.SHOT_COOKIES || null;
const STORE_ID = process.env.SHOT_STORE_ID || null;
const STOREFRONTS = (process.env.SHOT_STOREFRONTS || "nordwerk,lumen-skin")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
}

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1512, height: 950 }, deviceScaleFactor: 2 },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
];

mkdirSync(OUT, { recursive: true });

const cookies = COOKIES && existsSync(COOKIES) ? JSON.parse(readFileSync(COOKIES, "utf8")) : null;
if (COOKIES && !cookies) console.warn(`  ! ${COOKIES} not found — signed-in pages will be skipped`);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});

for (const vp of VIEWPORTS) {
  const { name: label, ...contextOptions } = vp;
  const ctx = await browser.newContext(contextOptions);

  // The cookie banner covers the hero on every first visit, which is the one
  // frame a deck opens on.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("urivo_consent", "granted");
    } catch {}
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  /*
   * Reveal-on-scroll animations only fire once their element enters the
   * viewport, so a full-page capture taken straight after navigation is blank
   * below the fold. Walk the page to the bottom, then return to the top.
   */
  async function settle() {
    await page.evaluate(async () => {
      const step = Math.floor(window.innerHeight * 0.8);
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 110));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 250));
    });
    await page.waitForTimeout(450);
  }

  async function shot(name, path, { full = true, wait = 1500 } = {}) {
    await page.goto(BASE + path, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(wait);
    if (full) await settle();
    await page.screenshot({ path: `${OUT}/${label}-${name}.png`, fullPage: full });
    // A page that renders almost no text rendered an error or a redirect. Flag
    // it here rather than letting it reach a slide.
    const chars = (await page.locator("body").innerText().catch(() => "")).trim().length;
    console.log(`  ${chars > 200 ? "✓" : "!"} ${label}-${name}  (${chars} chars)`);
  }

  console.log(`\n${label.toUpperCase()}`);
  await shot("01-landing", "/");
  await shot("03-login", "/login", { full: false });

  if (cookies) {
    await ctx.addCookies(cookies);

    await shot("04-dashboard", "/dashboard");
    await shot("05-billing-prices", "/dashboard/billing");

    // Annual is the pricing story — two months free — and it lives behind a tab.
    await page.goto(`${BASE}/dashboard/billing`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1600);
    const yearly = page.getByRole("tab", { name: /Yearly/ });
    if (await yearly.count()) {
      await yearly.click();
      await page.waitForTimeout(700);
      await settle();
      await page.screenshot({ path: `${OUT}/${label}-06-billing-annual.png`, fullPage: true });
      console.log(`  ✓ ${label}-06-billing-annual`);
    } else {
      console.log(`  ! ${label}-06-billing-annual skipped — no plan picker (account already on Pro?)`);
    }

    if (STORE_ID) await shot("07-store-manager", `/dashboard/stores/${STORE_ID}`);
    await shot("08-evolution-lab", "/dashboard/evolution");
    await shot("09-research", "/dashboard/research");
    await shot("10-ad-studio", "/dashboard/ads");
    await shot("11-settings", "/dashboard/settings");
  }

  // What the product actually produces. Last, because it is the strongest frame.
  for (const [i, sub] of STOREFRONTS.entries()) {
    await shot(`${12 + i}-storefront-${sub}`, `/store/${sub}`);
  }

  console.log("  js errors:", errors.length ? errors.slice(0, 2) : "none");
  await ctx.close();
}

await browser.close();
console.log(`\nWritten to ${OUT}/`);
