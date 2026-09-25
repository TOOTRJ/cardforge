#!/usr/bin/env node
// ---------------------------------------------------------------------------
// frames-publish.mjs — upload frame masters + WebP siblings to the `frames`
// bucket of the DEV project and record them in lib/frames/frame-manifest.json
// (frames plan 4.2; the pipeline is in docs/FRAMES.md).
//
//   npm run frames:publish -- --source .frames-build            # plan only
//   npm run frames:publish -- --source .frames-build --write    # upload + manifest
//   npm run frames:publish -- --source .frames-build --only m15,m15land --write
//
// Objects are content-addressed (<template>/<name>.<sha256-12>.<ext>), so a
// re-run uploads only what changed and never overwrites a published object.
// Dev and every preview read the dev bucket; PRODUCTION reads its own and
// gets the same objects from the owner-run `npm run frames:promote` before
// the manifest change merges (CI's "Frames published" check enforces it).
//
// SAFETY: the target comes from .env.local (or --env-file) and is refused
// outright if it is the production project.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { isProductionSupabaseUrl } from "./lib/prod-guard.mjs";
import {
  BUCKET,
  CACHE_CONTROL,
  MANIFEST_PATH,
  contentTypeFor,
  frameObjectKey,
  listFrameFiles,
  objectExists,
  parseEnvFile,
  publicBaseFor,
  readManifest,
  serializeManifest,
  sha12,
} from "./lib/frame-objects.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args[at + 1] ?? "") : null;
};
const source = path.resolve(flag("--source") ?? ".frames-build");
const only = flag("--only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;
const write = args.includes("--write");
const envFile = path.resolve(flag("--env-file") ?? ".env.local");
const fileEnv = parseEnvFile(envFile);
const env = (name) => process.env[name] ?? fileEnv[name] ?? "";

const targetUrl = env("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = env("SUPABASE_SECRET_KEY");
if (!targetUrl || !secretKey) {
  console.error(`✗ ${envFile} needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.`);
  process.exit(1);
}
if (isProductionSupabaseUrl(targetUrl)) {
  console.error(`✗ REFUSING: ${new URL(targetUrl).host} is PRODUCTION. Publish to dev; production gets frames through npm run frames:promote.`);
  process.exit(1);
}

const keys = listFrameFiles(source, only);
if (keys.length === 0) {
  console.error(`✗ No .png/.webp files under ${source}${only ? ` for ${only.join(", ")}` : ""}.`);
  process.exit(1);
}

const base = publicBaseFor(targetUrl);
const manifest = readManifest();
const client = createClient(targetUrl, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });

let uploaded = 0;
let present = 0;
let changed = 0;
for (const key of keys) {
  const bytes = readFileSync(path.join(source, key));
  const hash = sha12(bytes);
  const meta = await sharp(bytes).metadata();
  const entry = { hash, bytes: bytes.byteLength, width: meta.width ?? 0, height: meta.height ?? 0 };
  const objectKey = frameObjectKey(key, hash);
  const exists = await objectExists(`${base}/${objectKey}`, entry.bytes);
  const prev = manifest.files[key];
  const differs = !prev || prev.hash !== hash;
  if (differs) changed += 1;
  if (exists) present += 1;
  console.log(`${exists ? "=" : write ? "↑" : "+"} ${objectKey}${differs ? "" : " (manifest unchanged)"}`);
  if (!write) continue;
  if (!exists) {
    const { error } = await client.storage.from(BUCKET).upload(objectKey, bytes, {
      contentType: contentTypeFor(key),
      cacheControl: CACHE_CONTROL,
      upsert: false,
    });
    if (error && !/exists/i.test(error.message)) {
      console.error(`✗ upload ${objectKey}: ${error.message}`);
      process.exit(1);
    }
    if (!(await objectExists(`${base}/${objectKey}`, entry.bytes))) {
      console.error(`✗ ${objectKey} is not readable at its public URL after upload.`);
      process.exit(1);
    }
    uploaded += 1;
  }
  manifest.files[key] = entry;
}

if (write) writeFileSync(MANIFEST_PATH, serializeManifest(manifest));
console.log(
  `\n${keys.length} files · ${present} already in the dev bucket · ${write ? `${uploaded} uploaded · manifest ${changed ? `updated (${changed} entries)` : "unchanged"}` : `${changed} manifest entries would change — re-run with --write`}`,
);
if (write && changed) {
  console.log("Next: open the PR with the manifest change; the owner runs `npm run frames:promote` before it merges.");
}
