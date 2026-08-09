import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { FONT_LIBRARY, FONT_KEYS, fontStack } from "./design-system";

/*
 * Storefront typography.
 *
 * The generator chooses a heading/body pair per store, so the typeface is part
 * of the brand it invents. That promise was broken silently for every store:
 * the renderer emitted a <link> to fonts.googleapis.com, and the app's own CSP
 * (`style-src 'self'`, `font-src 'self' data:`) refused it — in production too.
 * Nothing threw. The family name was still declared, so the browser quietly
 * fell back to system-ui and the store shipped with a typeface nobody chose.
 * Measured on a real store before the fix, `document.fonts` held zero loaded
 * faces; after it, exactly the two the design system asked for.
 *
 * Fonts are now self-hosted at build time by lib/storefront/fonts.ts. These
 * tests exist because the failure mode leaves no error to notice: they assert
 * the stack resolves through a CSS variable, and that no runtime request to
 * Google can creep back in.
 */

const ROOT = join(__dirname, "..", "..");

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
    }
  };
  walk(join(ROOT, "app"));
  walk(join(ROOT, "lib"));
  return out;
}

describe("every library font resolves to a self-hosted face", () => {
  it("returns a CSS variable first, so the face is served from our origin", () => {
    for (const key of FONT_KEYS) {
      expect(fontStack(key), `${key} must resolve through --f-${key}`).toMatch(
        new RegExp(`^var\\(--f-${key}\\)`),
      );
    }
  });

  it("keeps a generic fallback last, so text stays readable while a face swaps in", () => {
    for (const key of FONT_KEYS) {
      expect(fontStack(key)).toMatch(/(serif|sans-serif|monospace)$/);
    }
  });

  it("falls back to the default body font for an unknown key", () => {
    // A store saved before a font was removed from the library must still render.
    expect(fontStack("no-such-font")).toBe(fontStack("inter"));
  });

  it("declares every library key in the self-hosted module", () => {
    // A key present here but missing there would resolve to an undefined
    // variable — the exact silent fallback this suite exists to prevent.
    const fonts = readFileSync(join(ROOT, "lib", "storefront", "fonts.ts"), "utf8");
    for (const key of Object.keys(FONT_LIBRARY)) {
      expect(fonts, `fonts.ts is missing --f-${key}`).toContain(`--f-${key}`);
    }
  });
});

describe("no storefront font is fetched from Google at runtime", () => {
  /*
   * Two reasons, either one sufficient. The CSP blocks the request, so the
   * store would silently lose its typography again; and a visitor request to
   * Google from a German merchant's shop puts a third-party font call on that
   * merchant (LG München I, 3 O 17493/20).
   */
  it("finds no fonts.googleapis.com or fonts.gstatic.com reference in app/ or lib/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      /*
       * Judge the code, not the prose about it: the comments above explain the
       * regression by naming the host, and forbidding that would push authors
       * toward leaving no explanation at all.
       *
       * Block comments are replaced by their own newlines rather than deleted,
       * so a reported line number still points at the real line in the file. A
       * failure that sends you to the wrong line is worse than no line at all.
       */
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/([^:])\/\/.*$/gm, "$1");
      for (const [i, line] of code.split("\n").entries()) {
        if (/fonts\.(googleapis|gstatic)\.com/.test(line)) {
          offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1}`);
        }
      }
    }
    expect(
      offenders,
      `Self-host through lib/storefront/fonts.ts instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the CSP tight enough that a runtime font request would fail loudly", () => {
    // If someone widens these, the test above stops being the safety net —
    // so the two are pinned together on purpose.
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
    expect(config).toContain(`"font-src 'self' data:"`);
    expect(config).toContain(`"style-src 'self' 'unsafe-inline'"`);
  });
});
