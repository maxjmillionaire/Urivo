import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * Every interactive component must declare "use client".
 *
 * This exists because of a bug that reached a browser: the storefront product
 * page rendered perfectly, the Add to cart button looked exactly right, and
 * nothing happened when a shopper pressed it. `product-view.tsx` was missing
 * the directive, so it rendered on the server and the click handler was never
 * bound. No test failed, no build warned, and the page looked correct in a
 * screenshot — the only symptom was that the shop could not take an order.
 *
 * A browser test of the cart would have caught that one page. This catches the
 * class: any component holding a handler or a hook, anywhere in app/, that
 * would silently render inert.
 *
 * Comments are stripped before matching. Prose about onClick is not onClick —
 * a previous test in this repository failed on its own explanation.
 */

const ROOT = join(__dirname, "..");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Source with block and line comments removed, so prose never matches. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Markers that only work in a Client Component. */
const CLIENT_ONLY =
  /\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|Focus|Blur|MouseEnter|MouseLeave|Scroll)\s*=|\buse(?:State|Effect|Ref|Reducer|Callback|Memo|LayoutEffect|Context)\s*\(/;

describe("interactive components are client components", () => {
  const files = tsxFiles(join(ROOT, "app"));

  it("finds components at all (a broken walker would pass everything)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("every file with a handler or a hook declares \"use client\"", () => {
    const inert: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!CLIENT_ONLY.test(code(src))) continue;
      // The directive must be the first statement in the module.
      if (!/^\s*(?:"use client"|'use client')/.test(src)) {
        inert.push(file.slice(ROOT.length + 1));
      }
    }
    expect(
      inert,
      `These components carry a click handler or a React hook but render on the ` +
        `server, so the handler is never bound and the hook cannot run. They will ` +
        `look correct and do nothing: ${inert.join(", ")}`,
    ).toEqual([]);
  });

  /*
   * The page the rule was written for, asserted as it is actually built: the
   * product view does not own the click handler itself, it composes the cart
   * components that do. Both halves have to hold — the view must be a client
   * component AND must still mount the cart — or Add to cart goes quiet again.
   */
  it("the storefront product page still mounts a working cart", () => {
    const view = readFileSync(
      join(ROOT, "app/(store)/store/[subdomain]/product/[id]/product-view.tsx"),
      "utf8",
    );
    expect(/^\s*(?:"use client"|'use client')/.test(view)).toBe(true);
    // The provider holds the cart state; BuyBox is what a shopper presses.
    expect(view).toMatch(/<StoreCartProvider/);
    expect(view).toMatch(/\bBuyBox\b/);

    // And the component that owns the handler is itself a client component.
    const cart = readFileSync(join(ROOT, "app/(store)/store/[subdomain]/cart/store-cart.tsx"), "utf8");
    expect(/^\s*(?:"use client"|'use client')/.test(cart)).toBe(true);
    expect(CLIENT_ONLY.test(code(cart))).toBe(true);
  });
});
