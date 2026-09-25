#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-restore-dev.mjs — refill the DEV project's frames bucket from
// production's public copies (frames plan 4.2; docs/FRAMES.md). Needed after
// a dev-branch reset, which drops storage objects: every preview, local dev
// and CI's e2e read bucket frames from dev.
//
//   npm run frames:restore-dev            # plan
//   npm run frames:restore-dev -- --write # copy
//
// Production is only READ, anonymously, through public URLs. Each object is
// re-hashed against the manifest before upload. The target comes from
// .env.local and is refused if it is production. Frames that were published
// to dev but never promoted can't be restored from production — re-run
// `npm run frames:publish` for those.
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
  sha256,
} from "./lib/frame-objects.mjs";

const write = process.argv.includes("--write");
const env = parseEnvFile(path.resolve(".env.local"));
const devUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const devKey = process.env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SECRET_KEY ?? "";
if (!devUrl || !devKey) {
  console.error("✗ .env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (the dev branch).");
  process.exit(1);
}
if (isProductionSupabaseUrl(devUrl)) {
  console.error("✗ REFUSING: .env.local points at PRODUCTION. This script only writes to dev.");
  process.exit(1);
}

const manifest = readManifest();
const prodBase = publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
const devBase = publicBaseFor(devUrl);
const missing = [];
for (const [key, entry] of Object.entries(manifest.files)) {
  const objectKey = frameObjectKey(key, entry.hash);
  if (!(await objectExists(`${devBase}/${objectKey}`, entry.bytes))) missing.push({ key, entry, objectKey });
}
console.log(`Dev bucket: ${Object.keys(manifest.files).length - missing.length} present, ${missing.length} missing.`);
if (!missing.length || !write) {
  if (missing.length) console.log("Plan only. Re-run with --write to copy them from production.");
  process.exit(0);
}
const dev = createClient(devUrl, devKey, { auth: { autoRefreshToken: false, persistSession: false } });
let restored = 0;
for (const { key, entry, objectKey } of missing) {
  const res = await fetch(`${prodBase}/${objectKey}`, { cache: "no-store" });
  if (!res.ok) {
    console.error(`  ✗ ${objectKey}: not on production (HTTP ${res.status}) — re-publish it with npm run frames:publish.`);
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== entry.sha256) {
    console.error(`  ✗ ${objectKey}: production copy doesn't match the manifest — skipped.`);
    continue;
  }
  const { error } = await dev.storage.from(BUCKET).upload(objectKey, bytes, {
    contentType: contentTypeFor(key),
    cacheControl: CACHE_CONTROL,
    upsert: false,
  });
  if (error && !/exists/i.test(error.message)) {
    console.error(`  ✗ ${objectKey}: ${error.message}`);
    continue;
  }
  restored += 1;
}
console.log(`Restored ${restored}/${missing.length}.`);
if (restored < missing.length) process.exit(1);
