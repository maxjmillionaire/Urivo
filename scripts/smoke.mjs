#!/usr/bin/env node
/*
 * Smoke test — loads the running application in a real browser and asserts the
 * things static checks structurally cannot see.
 *
 * This exists because a doubled full stop sat on the most visible line of every
 * storefront through typecheck, the unit suite and a clean production build,
 * and was found in twenty minutes the first time anyone actually looked at a
 * rendered page. Compilation is not verification.
 *
 * Two viewports only — desktop and mobile. Nothing in between.
 *
 *   BASE_URL=http://127.0.0.1:3100 node scripts/smoke.mjs
 *   BASE_URL=... SHOTS=screenshots node scripts/smoke.mjs   # also write images
 *
 * Exits non-zero on the first failed assertion, so it can gate a deploy.
 */

import { mkdirSync } from "node:fs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const SHOTS = process.env.SHOTS || null;
const COOKIES = process.env.SMOKE_COOKIES || null; // JSON file, for signed-in routes

const VIEWPORTS = [
  { name: "desktop", viewport: { width: 1512, height: 950 }, deviceScaleFactor: 2 },
  { name: "mobile", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
];

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  ({ chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs"));
}

/*
 * Pages hydrate and reveal on scroll, so measuring straight after navigation
 * reads a shell and reports a false failure. Walk the page first — this also
 * fires every scroll-triggered animation so full-page captures aren't blank
 * below the fold.
 */
async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.floor(window.innerHeight * 0.8);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.waitForTimeout(400);
}

const results = [];
const record = (ok, label, detail) => {
  results.push({ ok, label, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail && !ok ? ` — ${detail}` : ""}`);
};

/** Public routes must render for a signed-out visitor. */
const PUBLIC = [
  ["landing", "/"],
  ["login", "/login"],
  ["impressum", "/impressum"],
  ["datenschutz", "/datenschutz"],
];

/** Signed-in routes, exercised only when SMOKE_COOKIES is provided. */
const PRIVATE = [
  ["dashboard", "/dashboard"],
  ["billing", "/dashboard/billing"],
  ["settings", "/dashboard/settings"],
];

async function run() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  try {
    const r = await fetch(`${BASE}/api/health`);
    const h = await r.json();
    record(r.ok, "health endpoint responds", `HTTP ${r.status}`);
    record(typeof h.launchReady === "boolean", "health reports launchReady");
  } catch (e) {
    record(false, "health endpoint responds", e.message);
  }

  for (const vp of VIEWPORTS) {
    console.log(`\n${vp.name.toUpperCase()}  (${vp.viewport.width}×${vp.viewport.height})`);
    const ctx = await browser.newContext(vp);
    await ctx.addInitScript(() => {
      try { localStorage.setItem("urivo_consent", "granted"); } catch {}
    });
    if (COOKIES) {
      const { readFileSync } = await import("node:fs");
      await ctx.addCookies(JSON.parse(readFileSync(COOKIES, "utf8")));
    }
    const page = await ctx.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(String(e)));

    const routes = COOKIES ? [...PUBLIC, ...PRIVATE] : PUBLIC;
    for (const [name, path] of routes) {
      let status = 0;
      try {
        const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
        status = res?.status() ?? 0;
        await settle(page);
      } catch (e) {
        record(false, `${name} loads`, e.message);
        continue;
      }
      record(status < 400, `${name} loads`, `HTTP ${status}`);

      // The page must actually render something, not just return 200 with a shell.
      const text = await page.locator("body").innerText().catch(() => "");
      record(text.trim().length > 40, `${name} renders content`, `${text.trim().length} chars`);

      // No horizontal scroll — the most common mobile regression.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      record(overflow <= 1, `${name} has no horizontal overflow`, `${overflow}px`);

      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/${vp.name}-${name}.png`, fullPage: true });
      }
    }

    // A generated storefront — the product's actual output.
    if (process.env.SMOKE_STOREFRONT) {
      const sub = process.env.SMOKE_STOREFRONT;
      const res = await page.goto(`${BASE}/store/${sub}`, { waitUntil: "networkidle", timeout: 45000 }).catch(() => null);
      await settle(page).catch(() => {});
      record(!!res && res.status() < 400, `storefront /${sub} loads`, `HTTP ${res?.status()}`);

      // Regression guard: taglines must not render a doubled full stop.
      const doubled = await page.locator("p").filter({ hasText: /[.!?]{2,}/ }).count();
      record(doubled === 0, "storefront has no doubled punctuation", `${doubled} paragraph(s)`);

      /*
       * Regression guard: the renderer's retired boilerplate. These exact lines
       * were published by every generated store as the merchant's own binding
       * commercial terms — shipping thresholds, a returns window and a carbon
       * claim nobody had agreed to. Matched verbatim, so a merchant who really
       * does offer free shipping can still say so in their own words.
       */
      const body = await page.locator("body").innerText().catch(() => "");
      const FABRICATED = [
        "On all orders over €60",
        "No questions asked",
        "Encrypted end to end",
        "Considered, never disposable",
        "Sourced for longevity, not margin",
        "Quality control on every piece",
        "Offset on every order",
      ];
      const found = FABRICATED.filter((c) => body.includes(c));
      record(found.length === 0, "storefront makes no promises the merchant didn't author", found.join(" · "));

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      record(overflow <= 1, "storefront has no horizontal overflow", `${overflow}px`);

      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${vp.name}-storefront.png`, fullPage: true });
    }

    record(jsErrors.length === 0, `${vp.name}: no uncaught JS errors`, jsErrors[0]);
    await ctx.close();
  }

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log("\nFailures:");
    failed.forEach((f) => console.log(`  ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`));
    process.exit(1);
  }
}

run().catch((e) => {
  console.error("smoke run failed:", e.message);
  process.exit(1);
});
