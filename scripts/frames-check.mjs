#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-check.mjs — CI's "Frames published" gate (frames plan 4.2): every
// object in lib/frames/frame-manifest.json must be readable, at its manifest
// size, from PRODUCTION's frames bucket (or --origin). A PR that adds frames
// stays red here until the owner promotes them. This only BLOCKS a merge
// when "Frames published" is a required check on main (owner step in
// docs/FRAMES.md). Second line of defence: the production build runs this
// with --if-production (package.json "build"), so an unpromoted manifest
// fails the Vercel production deploy and the previous one keeps serving.
// Public reads only — no key.
// ---------------------------------------------------------------------------
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import { FramesCheckDeadline, findMissing, frameObjectKey, objectStatus, publicBaseFor, readManifest } from "./lib/frame-objects.mjs";

if (process.argv.includes("--if-production") && process.env.VERCEL_ENV !== "production") process.exit(0);
const at = process.argv.indexOf("--origin");
const origin = at >= 0 ? process.argv[at + 1] : publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const manifest = readManifest();
const entries = Object.entries(manifest.files);
if (entries.length === 0) {
  console.log("Frame manifest is empty — every frame is still served from public/frames.");
  process.exit(0);
}
// At most 4 lookups in flight, and every apparent miss is re-checked on its
// own before it counts: this runs against PRODUCTION storage (a small
// connection pool) on every PR — often several at once — and in the
// production build, so a transient error must never fail it.
//
// The whole check has a BUDGET (`--budget-seconds`, default 780: the CI job
// stops at 10 minutes; a normal run takes 1.5–3). Each lookup has its own
// timeout and bounded retries, but 4280 of them through a slow CDN went
// silent until the job was cancelled (2026-11-02, twice). Past the budget it
// FAILS with what it saw — never a pass: an object nobody looked at is not
// published as far as this gate knows. It prints its progress meanwhile.
const budgetAt = process.argv.indexOf("--budget-seconds");
const budgetSeconds = budgetAt >= 0 ? Number(process.argv[budgetAt + 1]) : 780;
if (!(budgetSeconds > 0)) {
  console.error("--budget-seconds needs a positive number of seconds.");
  process.exit(2);
}
const deadline = AbortSignal.timeout(budgetSeconds * 1000);
console.log(`Checking ${entries.length} manifest objects at ${origin} (budget ${budgetSeconds} s)…`);
const started = Date.now();
let progress = { done: 0, total: entries.length, suspects: 0 };
const ticker = setInterval(() => {
  const s = Math.round((Date.now() - started) / 1000);
  console.log(`  … ${progress.done}/${progress.total} checked, ${progress.suspects} apparent misses so far (${s} s)`);
}, 30_000);
let missing;
try {
  missing = await findMissing(
    entries,
    ([key, entry], thorough) =>
      objectStatus(`${origin}/${frameObjectKey(key, entry.hash)}`, entry.bytes, { tries: thorough ? 5 : 2, signal: deadline }),
    { signal: deadline, onProgress: (p) => (progress = p) },
  );
} catch (err) {
  if (!(err instanceof FramesCheckDeadline)) throw err;
  const answers = Object.entries(err.statuses).map(([status, n]) => `${status} ×${n}`).join(", ");
  console.error(
    `✗ The frames check ran out of its ${budgetSeconds} s budget: ${err.checked}/${err.total} objects answered, ` +
      `${err.suspects} of them not (yet) found${answers ? ` (last answers: ${answers})` : ""}.`,
  );
  console.error(
    `  ${origin} was too slow or rate-limited to verify the manifest. That does not say a frame is missing — and it is not a pass. ` +
      "Re-run the job; if it times out again, check Supabase's status (storage / CDN).",
  );
  process.exit(1);
} finally {
  clearInterval(ticker);
}
if (missing.length) {
  console.error(`✗ ${missing.length}/${entries.length} manifest objects are missing from ${origin}:`);
  const rows = missing.map(({ item: [key, entry], status }) => `  ${frameObjectKey(key, entry.hash)}  (last answer: ${status})`);
  for (const row of rows.sort()) console.error(row);
  console.error("The owner runs `npm run frames:promote` (docs/FRAMES.md) before this merges.");
  process.exit(1);
}
console.log(`✓ All ${entries.length} manifest objects are published at ${origin}.`);
