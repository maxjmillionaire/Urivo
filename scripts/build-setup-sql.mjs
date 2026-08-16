#!/usr/bin/env node
/*
 * Regenerates supabase/setup_all.sql — every migration concatenated in order,
 * so a fresh Supabase project can be provisioned with one paste.
 *
 * This file exists because a hand-maintained concatenation silently drifts:
 * setup_all.sql once sat twelve migrations behind the folder, which would have
 * produced a subtly broken database on launch day. Run this after adding any
 * migration:
 *
 *     npm run db:build
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");

/*
 * `--from 0005` emits a catch-up file instead of the full setup — for a project
 * that already has earlier migrations applied and would error on a bare
 * `create table` if the whole chain were replayed.
 */
const fromArg = process.argv.indexOf("--from");
const from = fromArg > -1 ? process.argv[fromArg + 1] : null;
const out = join(root, "supabase", from ? `catch_up_from_${from}.sql` : "setup_all.sql");

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => (from ? f.slice(0, 4) >= from : true))
  .sort();

if (files.length === 0) {
  console.error("No migrations found in supabase/migrations.");
  process.exit(1);
}

const first = files[0].slice(0, 4);
const last = files[files.length - 1].slice(0, 4);
const rule = "─".repeat(57);

const header = from
  ? `-- ============================================================
-- URIVO — Database catch-up (migrations ${first}–${last}).
-- For a project that ALREADY has the earlier migrations applied.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
--
-- Use setup_all.sql instead on a brand-new, empty project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build -- --from ${from}
-- ============================================================
`
  : `-- ============================================================
-- URIVO — Complete database setup (one-shot).
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It applies migrations ${first}–${last} in order. Safe to run once on a fresh project.
--
-- GENERATED FILE — do not edit by hand.
-- Regenerate with: npm run db:build
-- ============================================================
`;

const body = files
  .map((f) => {
    const sql = readFileSync(join(dir, f), "utf8").trimEnd();
    return `\n\n-- ${rule}\n-- ${f}\n-- ${rule}\n${sql}\n`;
  })
  .join("");

writeFileSync(out, header + body);
console.log(`${basename(out)} rebuilt from ${files.length} migrations (${first} → ${last}).`);
