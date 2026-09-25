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
import { frameObjectKey, mapLimit, objectExists, publicBaseFor, readManifest } from "./lib/frame-objects.mjs";

if (process.argv.includes("--if-production") && process.env.VERCEL_ENV !== "production") process.exit(0);
const at = process.argv.indexOf("--origin");
const origin = at >= 0 ? process.argv[at + 1] : publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const manifest = readManifest();
const entries = Object.entries(manifest.files);
if (entries.length === 0) {
  console.log("Frame manifest is empty — every frame is still served from public/frames.");
  process.exit(0);
}
const missing = [];
// At most 8 lookups in flight: this runs against PRODUCTION storage on every
// PR and in the production build.
await mapLimit(entries, 8, async ([key, entry]) => {
  const objectKey = frameObjectKey(key, entry.hash);
  if (!(await objectExists(`${origin}/${objectKey}`, entry.bytes))) missing.push(objectKey);
});
if (missing.length) {
  console.error(`✗ ${missing.length}/${entries.length} manifest objects are missing from ${origin}:`);
  for (const key of missing.sort()) console.error(`  ${key}`);
  console.error("The owner runs `npm run frames:promote` (docs/FRAMES.md) before this merges.");
  process.exit(1);
}
console.log(`✓ All ${entries.length} manifest objects are published at ${origin}.`);
