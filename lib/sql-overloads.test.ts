import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Every database function must have exactly ONE signature.
 *
 * `create or replace function` replaces a function only when the argument types
 * match exactly. Add a parameter — defaulted or not — and you have not replaced
 * anything: there are now two functions of that name, and a call that fits both
 * is refused rather than resolved.
 *
 *   ERROR: function generate_store_atomic(uuid, text, text, jsonb, jsonb,
 *          integer) is not unique                        (SQLSTATE 42725)
 *
 * That is not a theory. 0055 added `p_is_active boolean default false` and wrote
 * into its own header that the old six-argument call would still resolve. It did
 * not. The migration was applied to production while the deployed application
 * still called the RPC with six named arguments, so store generation — the first
 * thing a new merchant does — was resolving against an ambiguity. 0056 dropped
 * the narrow form.
 *
 * TypeScript cannot see into SQL and the unit suite has no database, so the only
 * place this can be caught before a migration is applied is here, by reading the
 * files. The same seam that 0052 → 0053 went through, and now 0055 → 0056:
 * a premise about PostgreSQL asserted in a comment and never executed.
 */

const MIGRATIONS = join(__dirname, "..", "supabase", "migrations");

/** Strip `--` comments so a commented-out statement is not read as real SQL. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** The text between `openIdx` and its matching close paren, nesting-aware. */
function parenBody(sql: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return sql.slice(openIdx + 1, i);
  }
  return null;
}

/** Split on commas at nesting depth zero, so `numeric(10,2)` stays whole. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of list) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/*
 * Type heads, needed to tell a parameter NAME from a parameter TYPE. `create`
 * writes `p_user_id uuid`; `drop` writes the bare `uuid`. Both have to reduce to
 * the same string or a drop silently fails to cancel its create — which is
 * precisely how the first draft of this test passed while 0056 did nothing.
 */
const TYPE_HEADS = new Set([
  "uuid", "text", "jsonb", "json", "integer", "int", "int4", "int8", "bigint",
  "smallint", "boolean", "bool", "numeric", "decimal", "real", "double",
  "character", "varchar", "timestamp", "timestamptz", "date", "time",
  "interval", "bytea", "inet", "citext", "tsvector", "void", "record",
  "trigger", "anyelement",
]);

/** int/int4 → integer, bool → boolean … so create and drop spell types alike. */
function canonicalType(t: string): string {
  const s = t.toLowerCase().replace(/\s+/g, " ").trim();
  if (s === "int" || s === "int4") return "integer";
  if (s === "int8") return "bigint";
  if (s === "bool") return "boolean";
  if (s === "timestamp with time zone") return "timestamptz";
  if (s === "character varying") return "varchar";
  return s;
}

/**
 * The identity of a signature: the argument TYPES, in order. Parameter names and
 * default expressions are exactly what PostgreSQL ignores when it decides
 * whether two functions are the same one, so they are dropped here too.
 */
function signature(list: string): string {
  return splitTopLevel(list)
    .map((p) =>
      p
        .replace(/\bdefault\b[\s\S]*$/i, "")
        .replace(/^\s*(in|out|inout|variadic)\s+/i, "")
        .trim()
        .replace(/\s+/g, " "),
    )
    .filter(Boolean)
    .map((p) => {
      const tokens = p.split(" ");
      const head = tokens[0].toLowerCase().replace(/[([].*$/, "");
      // More than one token and the first is not a type → the first is a name.
      if (tokens.length > 1 && !TYPE_HEADS.has(head)) tokens.shift();
      return canonicalType(tokens.join(" "));
    })
    .join(", ");
}

type Live = Map<string, Map<string, string>>; // name -> signature -> migration

/** Replay the migrations in order and report which signatures are left alive. */
function liveSignatures(): Live {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const live: Live = new Map();

  for (const file of files) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, file), "utf8"));

    const created = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = created.exec(sql))) {
      const list = parenBody(sql, created.lastIndex - 1);
      if (list === null) continue;
      const sigs = live.get(m[1]) ?? new Map<string, string>();
      sigs.set(signature(list), file);
      live.set(m[1], sigs);
    }

    const dropped = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    while ((m = dropped.exec(sql))) {
      const list = parenBody(sql, dropped.lastIndex - 1);
      if (list === null) continue;
      live.get(m[1])?.delete(signature(list));
    }
  }

  return live;
}

describe("database functions are never left overloaded", () => {
  const live = liveSignatures();

  it("parses the migration directory (the guard is worthless if it reads nothing)", () => {
    // A regex that silently stops matching would make every assertion below
    // pass vacuously, which is the classic way a structural test dies quietly.
    expect(live.size).toBeGreaterThan(40);
    expect(live.has("generate_store_atomic")).toBe(true);
    expect(live.has("publish_store")).toBe(true);
  });

  it("leaves exactly one live signature per function", () => {
    const offenders = [...live]
      .filter(([, sigs]) => sigs.size > 1)
      .map(([name, sigs]) => {
        const forms = [...sigs].map(([sig, file]) => `      (${sig})   from ${file}`).join("\n");
        return `   ${name} has ${sigs.size} live signatures:\n${forms}`;
      });

    expect(
      offenders,
      "A function with two signatures makes every call that fits both of them " +
        "fail with SQLSTATE 42725 instead of choosing. If a migration widened a " +
        "function, it must DROP the narrower form in the same migration:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("keeps the publish entitlement in the only generate_store_atomic there is", () => {
    const sigs = live.get("generate_store_atomic")!;
    expect([...sigs.keys()]).toEqual(["uuid, text, text, jsonb, jsonb, integer, boolean"]);
  });
});

describe("the application calls generate_store_atomic with the entitlement", () => {
  /*
   * The other half of the same failure: the signature can be right while the
   * caller still omits the argument, in which case the store is created with
   * p_is_active defaulting to false and a PAID merchant's new store is silently
   * unpublished. So the call site is asserted too.
   */
  it("passes p_is_active from the resolved plan, not a literal", () => {
    const route = readFileSync(
      join(__dirname, "..", "app", "api", "generate-store", "route.ts"),
      "utf8",
    );
    expect(route).toContain("generate_store_atomic");
    expect(route).toMatch(/p_is_active:\s*plan\.features\.publish/);
    // A hardcoded true here would hand every plan a live store again — the exact
    // behaviour of the column default that 0055 exists to remove.
    expect(route).not.toMatch(/p_is_active:\s*true/);
  });
});
