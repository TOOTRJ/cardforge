#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-dev-env.mjs — runs before `next dev` (package.json "dev").
//
// Local development must never write to the production database by accident.
// For months `.env.local` pointed straight at it; this makes that state
// impossible to be in silently. Resolution order mirrors Next.js: the shell
// environment wins, then .env.development.local, .env.local,
// .env.development, .env.
//
//   npm run dev        → refuses to start against production
//   npm run dev:prod   → deliberate, loud, reads .env.prod-peek
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { isProductionSupabaseUrl } from "./lib/prod-guard.mjs";

const NAME = "NEXT_PUBLIC_SUPABASE_URL";

function fromFile(file) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url =
  process.env[NAME] ??
  [".env.development.local", ".env.local", ".env.development", ".env"]
    .map(fromFile)
    .find((value) => value !== undefined);

if (!url) {
  console.warn(
    "\n⚠  No NEXT_PUBLIC_SUPABASE_URL — the app will run with no database.\n" +
      "   See docs/ENVIRONMENTS.md §Local (`vercel env pull` fills .env.local).\n",
  );
  process.exit(0);
}

if (!isProductionSupabaseUrl(url)) process.exit(0);

const bar = "█".repeat(72);
if (process.env.ALLOW_PROD_DB === "1") {
  console.warn(
    `\n${bar}\n  DEV SERVER IS CONNECTED TO THE **PRODUCTION** DATABASE\n` +
      "  Every save, like, delete and admin action here is REAL.\n" +
      `  Stop this server as soon as you are done.\n${bar}\n`,
  );
  process.exit(0);
}

console.error(
  `\n${bar}\n  REFUSING TO START: .env.local points at the PRODUCTION database.\n\n` +
    "  Local development uses the shared dev database. Fix .env.local with:\n" +
    "      vercel env pull .env.local --environment=development\n\n" +
    "  If you really do need production locally (rare — a read-only look):\n" +
    `      npm run dev:prod\n${bar}\n`,
);
process.exit(1);
