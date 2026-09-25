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

/** Full sha256 hex — what the bake and the promote step verify. */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** First 12 hex chars of sha256 — the object-key suffix (and manifest `hash`). */
export function sha12(bytes) {
  return sha256(bytes).slice(0, 12);
}

/** A manifest key: lowercase path segments, a .png/.webp file, no traversal. */
export const MANIFEST_KEY = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.(png|webp)$/;

/**
 * Strict CLI flags: `--name value` or `--name=value`; a value-taking flag
 * with no value (or another flag as its value) is an error, not a silent
 * default. Returns { get(name), has(name) }.
 */
export function parseFlags(argv, valueFlags) {
  const values = new Map();
  const bare = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument "${arg}".`);
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(0, eq) : arg;
    if (valueFlags.includes(name)) {
      const value = eq >= 0 ? arg.slice(eq + 1) : argv[i + 1];
      if (eq < 0) i += 1;
      if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
      values.set(name, value);
    } else {
      bare.add(name);
    }
  }
  return { get: (name) => values.get(name) ?? null, has: (name) => bare.has(name) };
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

/**
 * HEAD a public object; true when it exists at the expected size. A 404 is
 * final. Supabase answers a MISSING public object with 400 — but it also
 * answers transient overload ("Too many connections issued to the database")
 * with 400, and a HEAD has no body to tell them apart, so a 400 is retried
 * like any other failure: a real miss stays 400 on every try. (Treating the
 * first 400 as "missing" failed the Frames published gate on 3 of 196 objects
 * that were there, 2026-09-25.)
 */
export async function objectExists(url, expectedBytes, { tries = 4, baseDelayMs = 500 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.status === 404) return false;
      if (res.ok) {
        const header = res.headers.get("content-length");
        return !header || !expectedBytes || Number(header) === expectedBytes;
      }
    } catch {
      // retry
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
  }
  return false;
}

/** Map over `items` with at most `limit` calls in flight, results in order.
 *  Storage lookups go through production's small connection pool: firing
 *  the whole manifest at once starved a concurrent promote upload. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
