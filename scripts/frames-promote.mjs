#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-promote.mjs — copy every object in lib/frames/frame-manifest.json
// that PRODUCTION's `frames` bucket lacks from the dev bucket (frames plan
// 4.2; docs/FRAMES.md). OWNER-RUN: it needs production's secret key, which
// never lives in .env.local.
//
//   FRAMES_PROD_SECRET_KEY=sb_secret_… npm run frames:promote              # plan
//   FRAMES_PROD_SECRET_KEY=sb_secret_… CONFIRM=yes npm run frames:promote  # copy
//
// Every copied object is re-hashed and must match its manifest entry before
// it is uploaded — production only ever receives the exact bytes a preview
// was verified with. Content-addressed keys: nothing is overwritten, so a
// re-run is a no-op. Run it before merging a PR that changes the manifest;
// CI's "Frames published" check stays red until you do.
// ---------------------------------------------------------------------------
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { PRODUCTION_SUPABASE_REF, isProductionSupabaseUrl } from "./lib/prod-guard.mjs";
import {
  BUCKET,
  CACHE_CONTROL,
  contentTypeFor,
  frameObjectKey,
  objectExists,
  parseEnvFile,
  publicBaseFor,
  readManifest,
  sha12,
} from "./lib/frame-objects.mjs";

const prodUrl = process.env.FRAMES_PROD_URL ?? `https://${PRODUCTION_SUPABASE_REF}.supabase.co`;
const prodKey = process.env.FRAMES_PROD_SECRET_KEY ?? "";
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

const manifest = readManifest();
const prodBase = publicBaseFor(prodUrl);
const missing = [];
for (const [key, entry] of Object.entries(manifest.files)) {
  const objectKey = frameObjectKey(key, entry.hash);
  if (!(await objectExists(`${prodBase}/${objectKey}`, entry.bytes))) missing.push({ key, entry, objectKey });
}
console.log(`Production ${new URL(prodUrl).host}: ${Object.keys(manifest.files).length - missing.length} present, ${missing.length} to copy from ${new URL(sourceBase).host}.`);
for (const m of missing) console.log(`  + ${m.objectKey}`);
if (missing.length === 0) process.exit(0);
if (!confirm || !prodKey) {
  console.log(
    !prodKey
      ? "\nSet FRAMES_PROD_SECRET_KEY (production secret key, from the Supabase dashboard — never .env.local) and CONFIRM=yes to copy."
      : "\nPlan only. Re-run with CONFIRM=yes to copy.",
  );
  process.exit(0);
}

const prod = createClient(prodUrl, prodKey, { auth: { autoRefreshToken: false, persistSession: false } });
for (const { key, entry, objectKey } of missing) {
  const res = await fetch(`${sourceBase}/${objectKey}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`✗ ${objectKey} is missing from the dev bucket (HTTP ${res.status}) — run npm run frames:publish first.`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha12(bytes) !== entry.hash || bytes.byteLength !== entry.bytes) {
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
