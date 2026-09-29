#!/usr/bin/env node
// ---------------------------------------------------------------------------
// strip-upload-metadata.mjs — remove camera metadata (EXIF incl. GPS, XMP,
// IPTC, PNG text, comments, C2PA, trailers) from files users uploaded BEFORE
// uploads were stripped (TODO 3.14a). OWNER-RUN against production.
//
//   node scripts/strip-upload-metadata.mjs                        # dev, dry run
//   node scripts/strip-upload-metadata.mjs --target prod          # prod, dry run
//   node scripts/strip-upload-metadata.mjs --target prod --apply  # prod, rewrite
//
// Run it from an up-to-date `main` checkout (trusted code). Production's
// secret key is asked for at a hidden prompt (it never lives in .env.local
// or the shell history) — the dry run needs it too: listing a bucket's
// objects is not public. The dev target reads NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SECRET_KEY from .env.local (or --env-file) and refuses production.
//
// Flags:
//   --target dev|prod    default dev
//   --apply              rewrite (after a "type yes" confirm); default: list
//   --bucket <name>      one of card-art, profile-media, set-covers,
//                        custom-pips (repeatable; default all four)
//   --gps-only           only objects that carry GPS coordinates
//   --include-ai         also AI outputs (`ai-*`: no camera data; they may
//                        carry the model's provenance, kept by default)
//   --state <file>       resume file (default ~/.pipglyph/strip-upload-
//                        metadata.<project>.json)
//   --limit <n>          stop after n objects that need a rewrite
//   --env-file <path>    dev target's env file (default .env.local)
//
// What it does per object: download (service role, never the CDN) → strip
// with lib/media/strip-metadata.ts, the code every upload now runs → verify
// (scripts/lib/upload-metadata.mjs verifyStripped: identical decoded pixels,
// size, frames, orientation, ICC profile, and the SAME bake input — a file
// the strip would move under the bake's 3 MB inline cap is padded with zero
// bytes to stay above it) → with --apply, check the object is unchanged
// since it was read, overwrite it IN PLACE with the same Content-Type,
// Cache-Control and custom metadata, and read it back. Anything that fails a
// check is skipped and listed, never written. Because the pixels are the
// same, no stored bake changes and nothing needs a re-bake.
//
// The report names what each object carries ("exif exif:gps xmp …") —
// never a value, never coordinates. Re-running is safe: objects already
// clean (or stripped by an earlier run, same eTag) are not downloaded again.
// ---------------------------------------------------------------------------
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, isProductionSupabaseUrl } from "./lib/prod-guard.mjs";
import {
  USER_UPLOAD_BUCKETS,
  alreadyDone,
  cacheControlSeconds,
  describe,
  isAiOutput,
  loadState,
  planStrip,
  saveState,
  verifyStripped,
} from "./lib/upload-metadata.mjs";

// --- flags ---------------------------------------------------------------------
const VALUE_FLAGS = new Set(["--target", "--bucket", "--state", "--limit", "--env-file"]);
const BARE_FLAGS = new Set(["--apply", "--gps-only", "--include-ai"]);
const values = new Map();
const buckets = [];
const bare = new Set();
{
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const [name, inline] = argv[i].split(/=(.*)/s, 2);
    if (BARE_FLAGS.has(name) && inline === undefined) {
      bare.add(name);
      continue;
    }
    if (!VALUE_FLAGS.has(name)) fail(`Unknown argument "${argv[i]}".`);
    const value = inline ?? argv[++i];
    if (!value || value.startsWith("--")) fail(`${name} needs a value.`);
    if (name === "--bucket") buckets.push(value);
    else values.set(name, value);
  }
}
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const target = values.get("--target") ?? "dev";
if (target !== "dev" && target !== "prod") fail("--target must be dev or prod.");
const apply = bare.has("--apply");
const gpsOnly = bare.has("--gps-only");
const includeAi = bare.has("--include-ai");
const limit = values.has("--limit") ? Number(values.get("--limit")) : Infinity;
if (!(limit > 0)) fail("--limit must be a positive number.");
for (const b of buckets) {
  if (!USER_UPLOAD_BUCKETS.includes(b)) fail(`--bucket ${b}: only ${USER_UPLOAD_BUCKETS.join(", ")} (never card-renders or frames).`);
}
const scanBuckets = buckets.length ? buckets : USER_UPLOAD_BUCKETS;

// --- target ----------------------------------------------------------------------
function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Read a secret from the TTY without echoing it. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(question)) process.stdout.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

function promptLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

let url;
let key;
if (target === "prod") {
  if (values.has("--env-file")) fail("--env-file is for the dev target; production's key is only read at the prompt.");
  url = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
  if (!isProductionSupabaseUrl(url)) fail("Production URL check failed.");
  if (!process.stdin.isTTY) fail("Run this in a terminal: production's secret key is read at a hidden prompt.");
  key = await promptHidden("Production secret key (Supabase dashboard → API keys; not echoed): ");
  if (!key) fail("No key given.");
} else {
  const envFile = path.resolve(values.get("--env-file") ?? ".env.local");
  const env = parseEnvFile(envFile);
  url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  key = env.SUPABASE_SECRET_KEY ?? "";
  if (!url || !key) fail(`${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.`);
  if (isProductionSupabaseUrl(url)) fail(`${envFile} points at PRODUCTION — use --target prod (hidden-prompt key) for that.`);
}
const host = new URL(url).host;
const statePath = path.resolve(
  values.get("--state") ?? path.join(os.homedir(), ".pipglyph", `strip-upload-metadata.${host.split(".")[0]}.json`),
);
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const state = loadState(statePath);
state.target = host;

console.log(`${target === "prod" ? "PRODUCTION" : "dev"} ${host} — ${apply ? "APPLY" : "dry run"}; buckets: ${scanBuckets.join(", ")}`);
console.log(`State: ${statePath}\n`);

// --- scan ------------------------------------------------------------------------
/** Every object under `prefix`, depth-first (folders have id null). */
async function* listObjects(bucket, prefix = "") {
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data ?? []) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) yield* listObjects(bucket, full);
      else yield { path: full, etag: entry.metadata?.eTag ?? null, size: entry.metadata?.size ?? null };
    }
    if (!data || data.length < 1000) return;
  }
}

async function download(bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error || !data) throw new Error(error?.message ?? "empty download");
  return Buffer.from(await data.arrayBuffer());
}

const totals = { scanned: 0, skippedDone: 0, clean: 0, provenance: 0, ai: 0, affected: 0, gps: 0 };
const todo = [];
const problems = [];
const record = (objectKey, etag, status, extra = {}) => {
  state.objects[objectKey] = { etag, status, at: new Date().toISOString(), ...extra };
  saveState(statePath, state);
};

scan: for (const bucket of scanBuckets) {
  for await (const obj of listObjects(bucket)) {
    const objectKey = `${bucket}/${obj.path}`;
    totals.scanned += 1;
    if (alreadyDone(state, objectKey, obj.etag)) {
      totals.skippedDone += 1;
      continue;
    }
    if (!includeAi && isAiOutput(obj.path)) {
      totals.ai += 1;
      continue;
    }
    let bytes;
    try {
      bytes = await download(bucket, obj.path);
    } catch (err) {
      problems.push(`${objectKey}: download failed (${err.message})`);
      continue;
    }
    const plan = planStrip(bytes);
    if (plan.status === "clean") {
      totals.clean += 1;
      // Clean but for C2PA Content Credentials (an AI image's provenance),
      // which stay while they are all there is (lib/media/strip-metadata.ts).
      if (plan.report.provenance) totals.provenance += 1;
      record(objectKey, obj.etag, "clean");
      continue;
    }
    if (plan.status === "unparseable") {
      // Not a JPEG/PNG/WebP/GIF this parser can walk (or not an image at all):
      // never rewritten here — listed for the owner.
      problems.push(`${objectKey}: not a container the stripper can walk — left as is`);
      continue;
    }
    if (gpsOnly && !plan.report.gps) continue;
    totals.affected += 1;
    if (plan.report.gps) totals.gps += 1;
    const issues = await verifyStripped(bytes, plan.bytes);
    if (issues.length) {
      problems.push(`${objectKey}: would change what is drawn (${issues.join("; ")}) — left as is`);
      continue;
    }
    console.log(`  ${describe(objectKey, bytes.byteLength, plan.report)}${plan.padded ? "  [padded to stay above the bake's 3 MB inline cap]" : ""}`);
    // Only the address is kept: --apply downloads and verifies again, so a
    // big scan never holds every file in memory.
    todo.push({ bucket, path: obj.path, objectKey, etag: obj.etag });
    if (todo.length >= limit) break scan;
  }
}

console.log(
  `\nScanned ${totals.scanned} objects: ${totals.affected} carry metadata (${totals.gps} with GPS), ` +
    `${totals.clean} clean (${totals.provenance} of them keep only their C2PA provenance), ` +
    `${totals.skippedDone} unchanged since an earlier run` +
    `${includeAi ? "" : `, ${totals.ai} AI outputs skipped`}.`,
);
if (problems.length) {
  console.log(`\n${problems.length} left alone:`);
  for (const p of problems) console.log(`  ! ${p}`);
}
if (!apply) {
  console.log(
    todo.length
      ? `\nDry run: nothing written. Re-run with --apply to rewrite ${todo.length} object(s) in place.`
      : "\nNothing to rewrite.",
  );
  process.exit(0);
}
if (todo.length === 0) {
  console.log("\nNothing to rewrite.");
  process.exit(0);
}

// --- apply -----------------------------------------------------------------------
const answer = await promptLine(
  `\nRewrite ${todo.length} object(s) in ${target === "prod" ? "PRODUCTION" : "dev"} (${host}) in place? Type "yes": `,
);
if (answer !== "yes") {
  console.log("Aborted — nothing written.");
  process.exit(1);
}

let written = 0;
for (const item of todo) {
  const bucketApi = supabase.storage.from(item.bucket);
  try {
    const { data: info, error: infoError } = await bucketApi.info(item.path);
    if (infoError || !info) throw new Error(`info: ${infoError?.message ?? "missing"}`);
    // Changed since it was listed (a user replaced a pip, deleted a file…)?
    // Then leave it for the next run.
    if (item.etag && info.etag !== item.etag) throw new Error("changed since it was listed — re-run to pick it up");
    const original = await download(item.bucket, item.path);
    const plan = planStrip(original);
    if (plan.status !== "strip") throw new Error(`nothing to write now (${plan.status})`);
    const issues = await verifyStripped(original, plan.bytes);
    if (issues.length) throw new Error(`would change what is drawn (${issues.join("; ")})`);
    // The bytes just verified are still the stored object (eTag = MD5 of a
    // single-part upload; checked again right before the write).
    const { data: still } = await bucketApi.info(item.path);
    if (still?.etag !== info.etag) throw new Error("changed while being verified — re-run to pick it up");
    const cacheControl = cacheControlSeconds(info.cacheControl);
    if (!cacheControl) throw new Error(`unusual Cache-Control "${info.cacheControl}" — not rewritten`);
    const contentType = info.contentType;
    if (!contentType) throw new Error("no Content-Type recorded");
    const options = { contentType, cacheControl };
    if (info.metadata && Object.keys(info.metadata).length) options.metadata = info.metadata;
    const { error } = await bucketApi.update(item.path, plan.bytes, options);
    if (error) throw new Error(`update: ${error.message}`);

    const readBack = await download(item.bucket, item.path);
    if (!readBack.equals(plan.bytes)) throw new Error("read-back differs from what was written");
    const { data: after } = await bucketApi.info(item.path);
    if (after?.contentType !== contentType || cacheControlSeconds(after?.cacheControl) !== cacheControl) {
      throw new Error(`headers changed (${after?.contentType}, ${after?.cacheControl})`);
    }
    record(item.objectKey, after?.etag ?? null, "stripped", { removed: plan.report.found, padded: plan.padded });
    written += 1;
    console.log(`  ✓ ${item.objectKey}`);
  } catch (err) {
    console.error(`  ✗ ${item.objectKey}: ${err.message}`);
  }
}
console.log(`\nRewrote ${written}/${todo.length}. Re-run the dry run: it should list nothing.`);
process.exit(written === todo.length ? 0 : 1);
