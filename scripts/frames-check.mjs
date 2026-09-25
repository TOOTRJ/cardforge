#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-check.mjs — CI's "Frames published" gate (frames plan 4.2): every
// object in lib/frames/frame-manifest.json must be readable, at its manifest
// size, from PRODUCTION's frames bucket (or --origin). A PR that adds frames
// stays red here until the owner runs `npm run frames:promote`, so a merge
// can never ship a manifest that points production at missing frames.
// Public reads only — no key.
// ---------------------------------------------------------------------------
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import { frameObjectKey, objectExists, publicBaseFor, readManifest } from "./lib/frame-objects.mjs";

const at = process.argv.indexOf("--origin");
const origin = at >= 0 ? process.argv[at + 1] : publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const manifest = readManifest();
const entries = Object.entries(manifest.files);
if (entries.length === 0) {
  console.log("Frame manifest is empty — every frame is still served from public/frames.");
  process.exit(0);
}
const missing = [];
await Promise.all(
  entries.map(async ([key, entry]) => {
    const objectKey = frameObjectKey(key, entry.hash);
    if (!(await objectExists(`${origin}/${objectKey}`, entry.bytes))) missing.push(objectKey);
  }),
);
if (missing.length) {
  console.error(`✗ ${missing.length}/${entries.length} manifest objects are missing from ${origin}:`);
  for (const key of missing.sort()) console.error(`  ${key}`);
  console.error("The owner runs `npm run frames:promote` (docs/FRAMES.md) before this merges.");
  process.exit(1);
}
console.log(`✓ All ${entries.length} manifest objects are published at ${origin}.`);
