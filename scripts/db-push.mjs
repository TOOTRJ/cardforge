#!/usr/bin/env node
// ---------------------------------------------------------------------------
// db-push.mjs — guard-railed `supabase db push` wrapper.
//
//   npm run db:push:staging   → links + pushes migrations to the staging project
//   npm run db:push:prod      → same for production, but requires typing
//                               "production" to confirm
//
// Project refs are read from .env.local (or the shell env):
//   SUPABASE_STAGING_REF=abcdefghijklmnop
//   SUPABASE_PROD_REF=qrstuvwxyz123456
//
// Refs are not secrets (they're visible in every client request URL); they
// live in .env.local only so each machine opts in explicitly — a fresh clone
// can't push anywhere by accident. See docs/ENVIRONMENTS.md.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";

const target = process.argv[2];
if (target !== "staging" && target !== "prod") {
  console.error("Usage: node scripts/db-push.mjs <staging|prod>");
  process.exit(1);
}

// Minimal .env.local parser — no dependency, handles KEY=value lines only.
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const envLocal = loadEnvLocal();
const refVar = target === "prod" ? "SUPABASE_PROD_REF" : "SUPABASE_STAGING_REF";
const ref = process.env[refVar] ?? envLocal[refVar];

if (!ref || !/^[a-z]{16,24}$/.test(ref)) {
  console.error(
    `Missing or invalid ${refVar}.\n` +
      `Add it to .env.local — the ref is the subdomain of the project's\n` +
      `supabase.co URL (Supabase dashboard → Project settings → General).`,
  );
  process.exit(1);
}

if (target === "prod") {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `⚠️  About to push migrations to PRODUCTION (${ref}).\n` +
      `   Has this schema change been verified on staging?\n` +
      `   Type "production" to continue: `,
  );
  rl.close();
  if (answer.trim() !== "production") {
    console.log("Aborted.");
    process.exit(1);
  }
}

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) process.exit(res.status ?? 1);
}

run("supabase", ["link", "--project-ref", ref]);
run("supabase", ["db", "push"]);

console.log(`\n✓ Migrations pushed to ${target} (${ref}).`);
if (target === "prod") {
  console.log("Remember: mirror any dashboard-side config changes to staging.");
}
