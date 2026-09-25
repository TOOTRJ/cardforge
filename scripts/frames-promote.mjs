#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-promote.mjs — copy every object in lib/frames/frame-manifest.json
// that PRODUCTION's `frames` bucket lacks from the dev bucket (frames plan
// 4.2; docs/FRAMES.md). OWNER-RUN: it needs production's secret key, which
// never lives in .env.local.
//
// Run it from an up-to-date `main` checkout (trusted code), handing it the
// PR's manifest as DATA — never run a PR branch's scripts with the
// production key in the environment:
//
//   git fetch origin <pr-branch>
//   git show origin/<pr-branch>:lib/frames/frame-manifest.json > /tmp/frames.json
//   node scripts/frames-promote.mjs --manifest /tmp/frames.json             # plan (no key)
//   CONFIRM=yes node scripts/frames-promote.mjs --manifest /tmp/frames.json # copy
//
// With CONFIRM=yes it asks for the key without echoing it (nothing lands
// in shell history); FRAMES_PROD_SECRET_KEY in the environment also works.
//
// Every copied object is re-hashed and must match its manifest entry before
// it is uploaded — production only ever receives the exact bytes a preview
// was verified with. Content-addressed keys: nothing is overwritten, so a
// re-run is a no-op. Run it before merging a PR that changes the manifest;
// CI's "Frames published" check stays red until you do.
// ---------------------------------------------------------------------------
import path from "node:path";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, isProductionSupabaseUrl } from "./lib/prod-guard.mjs";
import {
  BUCKET,
  CACHE_CONTROL,
  contentTypeFor,
  frameObjectKey,
  objectExists,
  parseEnvFile,
  parseFlags,
  publicBaseFor,
  readManifest,
  sha256,
} from "./lib/frame-objects.mjs";

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

const prodUrl = process.env.FRAMES_PROD_URL ?? `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
let prodKey = process.env.FRAMES_PROD_SECRET_KEY ?? "";
let flags;
try {
  flags = parseFlags(process.argv.slice(2), ["--manifest"]);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
const confirm = process.env.CONFIRM === "yes";
const localEnv = parseEnvFile(path.resolve(".env.local"));
const sourceBase =
  process.env.FRAMES_SOURCE_ORIGIN ??
  (localEnv.NEXT_PUBLIC_SUPABASE_URL ? publicBaseFor(localEnv.NEXT_PUBLIC_SUPABASE_URL) : "");

if (!isProductionSupabaseUrl(prodUrl)) {
  console.error(`✗ FRAMES_PROD_URL ${prodUrl} is not the production project.`);
  process.exit(1);
}
if (!sourceBase || isProductionSupabaseUrl(sourceBase)) {
  console.error("✗ The source must be the dev bucket (NEXT_PUBLIC_SUPABASE_URL in .env.local, or FRAMES_SOURCE_ORIGIN).");
  process.exit(1);
}

const manifest = readManifest(flags.get("--manifest") ?? undefined);
const prodBase = publicBaseFor(prodUrl);
const missing = [];
for (const [key, entry] of Object.entries(manifest.files)) {
  const objectKey = frameObjectKey(key, entry.hash);
  if (!(await objectExists(`${prodBase}/${objectKey}`, entry.bytes))) missing.push({ key, entry, objectKey });
}
console.log(`Production ${new URL(prodUrl).host}: ${Object.keys(manifest.files).length - missing.length} present, ${missing.length} to copy from ${new URL(sourceBase).host}.`);
for (const m of missing) console.log(`  + ${m.objectKey}`);
if (missing.length === 0) process.exit(0);
if (!confirm) {
  console.log("\nPlan only. Re-run with CONFIRM=yes to copy (you'll be asked for production's secret key).");
  process.exit(0);
}
if (!prodKey) prodKey = await promptHidden("Production secret key (from the Supabase dashboard, not echoed): ");
if (!prodKey) {
  console.error("✗ No key given.");
  process.exit(1);
}

const prod = createClient(prodUrl, prodKey, { auth: { autoRefreshToken: false, persistSession: false } });
for (const { key, entry, objectKey } of missing) {
  const res = await fetch(`${sourceBase}/${objectKey}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`✗ ${objectKey} is missing from the dev bucket (HTTP ${res.status}) — run npm run frames:publish first.`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!entry.sha256 || sha256(bytes) !== entry.sha256 || bytes.byteLength !== entry.bytes) {
    console.error(`✗ ${objectKey}: the dev copy does not match the manifest — refusing to promote it.`);
    process.exit(1);
  }
  const { error } = await prod.storage.from(BUCKET).upload(objectKey, bytes, {
    contentType: contentTypeFor(key),
    cacheControl: CACHE_CONTROL,
    upsert: false,
  });
  if (error && !/exists/i.test(error.message)) {
    console.error(`✗ upload ${objectKey}: ${error.message}`);
    process.exit(1);
  }
  if (!(await objectExists(`${prodBase}/${objectKey}`, entry.bytes))) {
    console.error(`✗ ${objectKey} is not readable on production after upload.`);
    process.exit(1);
  }
  console.log(`  ✓ ${objectKey}`);
}
console.log(`Promoted ${missing.length} objects. Production has every frame in the manifest.`);
