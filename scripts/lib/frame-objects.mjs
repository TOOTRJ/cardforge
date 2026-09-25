// ---------------------------------------------------------------------------
// frame-objects.mjs — the pure half of the frame storage pipeline (frames
// plan 4.2), shared by scripts/frames-publish.mjs, frames-promote.mjs and
// frames-check.mjs, and unit-tested. The object key MUST match
// lib/frames/frame-url.ts frameObjectKey (a test keeps them in sync).
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MANIFEST_PATH = "lib/frames/frame-manifest.json";
export const BUCKET = "frames";
/** A year; the object key changes whenever the bytes do. */
export const CACHE_CONTROL = "31536000";

/** First 12 hex chars of sha256 — the manifest hash and the key suffix. */
export function sha12(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

/** "m15/w.png" + "3fa9c2d1e0ab" → "m15/w.3fa9c2d1e0ab.png". */
export function frameObjectKey(key, hash) {
  const dot = key.lastIndexOf(".");
  return dot < 0 ? `${key}.${hash}` : `${key.slice(0, dot)}.${hash}${key.slice(dot)}`;
}

export function contentTypeFor(key) {
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  return null;
}

/** Relative keys ("m15/w.png", "m15/pt/w.webp") of every PNG/WebP under dir,
 *  optionally limited to some top-level template folders. Sorted. */
export function listFrameFiles(dir, only = null) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of readdirSync(abs)) {
      const childAbs = path.join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else if (contentTypeFor(childRel)) out.push(childRel);
    }
  };
  if (existsSync(dir)) walk(dir, "");
  return out
    .filter((key) => !only || only.includes(key.split("/")[0]))
    .sort();
}

export function publicBaseFor(supabaseUrl) {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}`;
}

export function readManifest(file = MANIFEST_PATH) {
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  if (manifest.version !== 1 || typeof manifest.files !== "object") {
    throw new Error(`${file} is not a version-1 frame manifest`);
  }
  return manifest;
}

/** Stable serialization: keys sorted, 2-space indent, trailing newline. */
export function serializeManifest(manifest) {
  const files = Object.fromEntries(Object.keys(manifest.files).sort().map((k) => [k, manifest.files[k]]));
  return `${JSON.stringify({ version: 1, bucket: manifest.bucket ?? BUCKET, files }, null, 2)}\n`;
}

export function parseEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

/** HEAD a public object; true when it exists with the expected size. */
export async function objectExists(url, expectedBytes) {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (!res.ok) return false;
    const length = Number(res.headers.get("content-length"));
    return !Number.isFinite(length) || !expectedBytes || length === expectedBytes;
  } catch {
    return false;
  }
}
