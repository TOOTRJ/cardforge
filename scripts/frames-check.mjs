#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-check.mjs — CI's "Frames published" gate (frames plan 4.2): the
// objects of lib/frames/frame-manifest.json must be readable, at their
// manifest size, from PRODUCTION's frames bucket (or --origin). A PR that
// adds frames stays red here until the owner promotes them. This only BLOCKS
// a merge when "Frames published" is a required check on main (owner step in
// docs/FRAMES.md). Second line of defence: the production build runs this
// with --if-production (package.json "build"), so an unpromoted manifest
// fails the Vercel production deploy and the previous one keeps serving.
// Public reads only — no key.
//
// WHICH objects (scripts/lib/frames-check-plan.mjs says why each is safe):
//
//   (no flag)      every object, strictly: the owner's `npm run frames:check`.
//   --incremental  the objects that are new or changed against a base that
//                  was itself checked: the production build (the last
//                  successful deployment of this branch, plus a rotating
//                  canary of the rest — owner 2026-11-02) and, since
//                  2026-11-10, CI on a pull request and on a merge
//                  (FRAMES_CHECK_BASE_SHA, no canary). Any doubt about the
//                  base is the full check.
//   --sweep        CI's NIGHTLY run: every object, started at a point that
//                  moves each night. It is the one that finds an older
//                  object gone from the bucket.
//
// HOW FAST (2026-11-10; createLookupPacer in scripts/lib/frame-objects.mjs):
// a lookup the CDN answers from its cache costs Supabase nothing, and the
// check runs 4 at a time. One the CDN does NOT answer reaches production's
// storage API; four in flight of those exhausted the project's connection
// pooler and the SITE's thumbnails, uploads and bakes were refused for as
// long as the check ran. So from the first uncached answer the check goes
// one lookup at a time with a pause after each (about one a second), a 429
// stops it for a minute, and a storage that stays saturated ends it.
//
// WHAT MAY BE LEFT UNLOOKED, the exit codes and the budget are
// scripts/lib/frames-check-run.mjs (unit-tested): nothing a pull request, a
// merge or a production build ADDS may be — a new or changed object the
// check could not verify fails it, exactly as before. The canary and the
// sweep are samples of objects an earlier run verified: a MISSING one fails
// the run; one the slow pace did not reach inside the budget is counted in
// the log and left to the next night (the sweep's starting point moves on
// each night). The sweep writes `complete=true` to $GITHUB_OUTPUT only when
// it looked at every object — ci.yml's frames-alert closes its issue on
// nothing less.
// ---------------------------------------------------------------------------
import { appendFileSync } from "node:fs";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import { createLookupPacer, frameObjectKey, objectStatus, publicBaseFor, readManifest } from "./lib/frame-objects.mjs";
import { planFramesCheck } from "./lib/frames-check-plan.mjs";
import { framesCheckBudgetSeconds, runFramesCheck } from "./lib/frames-check-run.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--if-production") && process.env.VERCEL_ENV !== "production") process.exit(0);
const sweep = argv.includes("--sweep");
if (sweep && argv.includes("--incremental")) {
  console.error("--sweep and --incremental are two different checks: pass one.");
  process.exit(2);
}
const at = argv.indexOf("--origin");
const origin = at >= 0 ? argv[at + 1] : publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const manifest = readManifest();
const total = Object.keys(manifest.files).length;
if (total === 0) {
  console.log("Frame manifest is empty — every frame is still served from public/frames.");
  process.exit(0);
}
const plan = planFramesCheck({
  manifest,
  incremental: argv.includes("--incremental"),
  originIsProduction: at < 0,
  env: process.env,
});

// The whole check has a BUDGET (`--budget-seconds`, else by what the run
// must verify — framesCheckBudgetSeconds). Each lookup has its own timeout,
// but 4280 of them through a slow CDN went silent until the job was
// cancelled (2026-11-02, twice). It prints its progress meanwhile.
const budgetAt = argv.indexOf("--budget-seconds");
const override = budgetAt >= 0 ? Number(argv[budgetAt + 1]) : undefined;
if (override !== undefined && !(override > 0)) {
  console.error("--budget-seconds needs a positive number of seconds.");
  process.exit(2);
}
const budgetSeconds = framesCheckBudgetSeconds({
  sweep,
  strictCount: plan.mode === "incremental" ? plan.changed.length : plan.entries.length,
  override,
  // CI and a Vercel build end a job that runs long; the owner's shell does not.
  unattended: Boolean(process.env.CI || process.env.VERCEL),
});
const deadline = AbortSignal.timeout(budgetSeconds * 1000);

const { exitCode, complete } = await runFramesCheck({
  plan,
  sweep,
  incrementalAsked: argv.includes("--incremental"),
  origin,
  total,
  pacer: createLookupPacer(),
  budgetSeconds,
  signal: deadline,
  // ONE attempt a lookup: the pacer decides when the next may start, and
  // the confirm pass looks again at whatever did not answer.
  lookup: ([key, entry], _thorough, onAnswer) =>
    objectStatus(`${origin}/${frameObjectKey(key, entry.hash)}`, entry.bytes, { tries: 1, signal: deadline, onAnswer }),
});
if (complete !== null && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `complete=${complete}\n`);
process.exit(exitCode);
