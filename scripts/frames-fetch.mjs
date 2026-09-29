#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-fetch.mjs — give a machine without a local importer build the frames
// that live in the bucket, not git (TODO 7.6): every PNG in
// lib/frames/frame-manifest.json (the template × colour masters, plus the
// P/T plates, symbol discs and loyalty shields beside them) is downloaded
// from a PUBLIC frames bucket — production's by default — into a directory
// laid out like the importer's build (<out>/<template>/<key>.png). Point
// FRAMES_BUILD_DIR at it and the unit tests that read bucket masters (the
// art-window coverage 7.6, the edge contract 7.7, the square corners, the
// plate ink) run instead of skipping. CI does exactly that, caching <out> by
// the manifest's hash (.github/workflows/ci.yml).
//
//   node scripts/frames-fetch.mjs                          # → .frames-cache
//   node scripts/frames-fetch.mjs --out <dir> --origin <public bucket base>
//   node scripts/frames-fetch.mjs --fallback-origin <public bucket base>
//
// Every file is sha256-checked against the manifest: one already in <out>
// with the right bytes is kept, anything else is fetched again, and a PNG
// in <out> the manifest no longer lists is removed (a cache restored from an
// older manifest). <out> must be new, empty or one this script marked
// (.frames-fetch) — it never prunes a folder it didn't make.
// --fallback-origin is asked for what the origin doesn't have — CI passes
// the DEV bucket, where `frames:publish` puts a PR's new frames before the
// owner promotes them (the sha makes it as trustworthy). Exits non-zero
// when any file is missing from both.
//
// Public reads only — no key. The output is gitignored and NEVER committed:
// Card Conjurer-derived frames never enter git (docs/FRAMES.md).
// ---------------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";
import {
  MANIFEST_KEY,
  fetchVerified,
  frameObjectKey,
  listFrameFiles,
  mapLimit,
  parseFlags,
  publicBaseFor,
  readManifest,
  sha256,
} from "./lib/frame-objects.mjs";

let flags;
try {
  flags = parseFlags(process.argv.slice(2), ["--out", "--origin", "--fallback-origin"]);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
const out = path.resolve(flags.get("--out") ?? ".frames-cache");
const origin = (flags.get("--origin") ?? publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`)).replace(/\/+$/, "");
const fallback = flags.get("--fallback-origin")?.replace(/\/+$/, "") ?? null;
// https only (a loopback http origin is allowed for the script's own test).
for (const base of [origin, fallback]) {
  if (base && !/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(base)) {
    console.error(`✗ ${base} is not an https URL.`);
    process.exit(1);
  }
}

const manifest = readManifest();
const entries = Object.entries(manifest.files).filter(([key]) => key.endsWith(".png"));
// A key is a relative path under <out>: lowercase segments, no traversal.
const badKey = entries.find(([key]) => !MANIFEST_KEY.test(key));
if (badKey) {
  console.error(`✗ ${badKey[0]} is not a frame manifest key.`);
  process.exit(1);
}
const listed = new Set(entries.map(([key]) => key));

// The output is this script's own: a directory it marked, or a new/empty
// one — never a folder that holds other files (an importer build, public/),
// since a stale PNG is removed below.
const MARKER = ".frames-fetch";
if (fs.existsSync(out) && fs.readdirSync(out).length && !fs.existsSync(path.join(out, MARKER))) {
  console.error(`✗ ${out} is not empty and was not made by frames-fetch (no ${MARKER} marker) — pick another --out.`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, MARKER), "Frame PNGs fetched by scripts/frames-fetch.mjs — never commit them.\n");

// A cache restored from an older manifest: drop the PNGs it no longer lists.
let removed = 0;
for (const key of listFrameFiles(out)) {
  if (key.endsWith(".png") && !listed.has(key)) {
    fs.rmSync(path.join(out, key));
    removed += 1;
  }
}

let kept = 0;
const fetched = { origin: 0, fallback: 0 };
const missing = [];
await mapLimit(entries, 4, async ([key, entry]) => {
  const file = path.join(out, key);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === entry.sha256) {
    kept += 1;
    return;
  }
  const objectKey = frameObjectKey(key, entry.hash);
  let result = await fetchVerified(`${origin}/${objectKey}`, entry.sha256);
  let from = "origin";
  if (!result.ok && fallback) {
    const second = await fetchVerified(`${fallback}/${objectKey}`, entry.sha256);
    if (second.ok) {
      result = second;
      from = "fallback";
    } else {
      result = { ok: false, status: `${result.status}; fallback ${second.status}` };
    }
  }
  if (!result.ok) {
    missing.push(`  ${objectKey}  (last answer: ${result.status})`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, result.bytes);
  fs.renameSync(tmp, file);
  fetched[from] += 1;
});

const shown = (dir) => {
  const rel = path.relative(process.cwd(), dir);
  return rel && !rel.startsWith("..") ? rel : dir;
};
const summary =
  `${entries.length} frame PNGs in ${shown(out)}: ${kept} kept, ` +
  `${fetched.origin} fetched from ${origin}` +
  (fallback ? `, ${fetched.fallback} from the fallback ${fallback}` : "") +
  (removed ? `, ${removed} stale removed` : "");
if (missing.length) {
  console.error(`✗ ${missing.length}/${entries.length} manifest PNGs could not be fetched with the manifest's sha256:`);
  for (const row of missing.sort()) console.error(row);
  console.error(summary);
  process.exit(1);
}
console.log(`✓ ${summary}`);
