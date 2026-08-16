import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REQUIRED_RPCS } from "./preflight";

/*
 * The preflight's schema check is only as good as its list of required
 * functions, and that list is the kind of thing that rots quietly: someone adds
 * a migration and a `.rpc("new_thing")` call, ships, and the check keeps
 * reporting green while the new feature 500s for every user whose database is
 * one migration behind.
 *
 * So the list is not trusted. It is re-derived from the source here and
 * compared, which turns "remember to update the list" into a failing test.
 */

const ROOT = join(__dirname, "..", "..");
const SEARCH_DIRS = ["app", "lib"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Every database function name the application actually calls. */
function rpcNamesInSource(): Set<string> {
  const names = new Set<string>();
  for (const dir of SEARCH_DIRS) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\.rpc\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
    }
  }
  return names;
}

describe("preflight knows every database function the app depends on", () => {
  const called = rpcNamesInSource();
  const listed = new Set<string>(REQUIRED_RPCS);

  it("finds RPC calls at all (a broken matcher would silently pass everything)", () => {
    expect(called.size).toBeGreaterThan(15);
  });

  it("lists every function the code calls", () => {
    const unlisted = [...called].filter((n) => !listed.has(n)).sort();
    expect(
      unlisted,
      `These database functions are called in app/ or lib/ but missing from ` +
        `REQUIRED_RPCS, so preflight would report a green schema on a database ` +
        `that cannot serve them: ${unlisted.join(", ")}`,
    ).toEqual([]);
  });

  it("lists nothing the code no longer calls", () => {
    const stale = [...listed].filter((n) => !called.has(n)).sort();
    expect(
      stale,
      `REQUIRED_RPCS names functions nothing calls any more: ${stale.join(", ")}. ` +
        `A stale entry blocks a deploy over a function that does not matter.`,
    ).toEqual([]);
  });
});
