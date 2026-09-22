#!/usr/bin/env node
// ---------------------------------------------------------------------------
// db-dev.mjs — push migrations (and optionally seeds) to the persistent `dev`
// Supabase branch by hand.
//
//   npm run db:push:dev   → apply unapplied migrations
//   npm run db:seed:dev   → the same, plus the seed files ([db.seed] sql_paths)
//
// You should rarely need this: the Supabase GitHub integration migrates the
// dev branch whenever the `dev` git branch moves (the sync-dev workflow
// fast-forwards it to main after every merge). This exists for the day that
// runner is down — it was, on the day the branch was created ("Capacity is
// unavailable at this time") — and for re-seeding after a schema wipe.
//
// SAFETY, in order:
//   1. The dev ref comes from supabase/config.toml ([remotes.dev].project_id).
//   2. The connection string is fetched fresh from the Supabase CLI (you must
//      be logged in: `supabase login`); no password is stored in the repo or
//      in any env file.
//   3. Before anything runs, the string must name the dev ref and must NOT
//      name production. Either check failing aborts with nothing executed.
// The password never reaches stdout: the CLI's own output is filtered.
// ---------------------------------------------------------------------------
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PRODUCTION_SUPABASE_REF, isProductionSupabaseUrl } from "./lib/prod-guard.mjs";

const mode = process.argv[2];
if (mode !== "push" && mode !== "seed") {
  console.error("Usage: node scripts/db-dev.mjs <push|seed> [--dry-run]");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

const config = readFileSync("supabase/config.toml", "utf8");
const devRef = /\[remotes\.dev\][^[]*?project_id\s*=\s*"([a-z]{16,24})"/s.exec(config)?.[1];
if (!devRef) {
  console.error('✗ No [remotes.dev] project_id in supabase/config.toml.');
  process.exit(1);
}
if (devRef === PRODUCTION_SUPABASE_REF) {
  console.error("✗ [remotes.dev] names the PRODUCTION ref. Refusing.");
  process.exit(1);
}

const redact = (text) =>
  text.replace(/:\/\/[^@\s]*@/g, "://<credentials>@").replace(/(eyJ|sb_)[A-Za-z0-9._-]+/g, "<key>");

const got = spawnSync(
  "npx",
  ["supabase", "--experimental", "branches", "get", "dev", "--project-ref", PRODUCTION_SUPABASE_REF, "-o", "env"],
  { encoding: "utf8" },
);
if (got.status !== 0) {
  console.error("✗ Could not read the dev branch (are you logged in? `npx supabase login`).");
  console.error(redact(got.stderr || got.stdout || ""));
  process.exit(1);
}
const pooled = /^POSTGRES_URL="?([^"\n]+)"?$/m.exec(got.stdout)?.[1];
if (!pooled) {
  console.error("✗ The CLI returned no POSTGRES_URL for the dev branch.");
  process.exit(1);
}
// The pooled URL is transaction mode (:6543); migrations need a session, which
// the same pooler serves on :5432. (The direct host is IPv6-only.)
const dbUrl = pooled.replace(":6543/", ":5432/").replace(/\?.*$/, "");

if (isProductionSupabaseUrl(dbUrl)) {
  console.error("✗ ABORT: the connection string references PRODUCTION. Nothing was run.");
  process.exit(1);
}
if (!dbUrl.includes(`postgres.${devRef}:`)) {
  console.error(`✗ ABORT: the connection string is not for the dev ref (${devRef}). Nothing was run.`);
  process.exit(1);
}
console.log(`Target verified: dev branch ${devRef}${dryRun ? " (dry run)" : ""}`);

const pushArgs = ["supabase", "db", "push", "--db-url", dbUrl];
if (mode === "seed") pushArgs.push("--include-seed");
if (dryRun) pushArgs.push("--dry-run");

const pushed = spawnSync("npx", pushArgs, { encoding: "utf8", input: "y\n" });
const output = redact(`${pushed.stdout ?? ""}${pushed.stderr ?? ""}`)
  .split("\n")
  .filter((line) => !/NOTICE|new version of Supabase CLI|recommend updating/.test(line))
  .join("\n");
console.log(output.trim());
process.exit(pushed.status ?? 1);
