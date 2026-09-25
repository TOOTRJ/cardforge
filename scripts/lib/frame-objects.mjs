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
 * Ask for a public object's FIRST BYTE and say what happened:
 * { ok, status }. `ok` is true when it exists at the expected size (the
 * total in `content-range`). Why a ranged GET and not a HEAD: a HEAD always
 * reaches Supabase's storage API, which is rate-limited (429) and shares a
 * small DB connection pool ("Too many connections" → 400), while a GET of a
 * public object is cached by the CDN (max-age 1 year; the frames are
 * content-addressed and immutable) — after the first request every check is
 * a CDN HIT that never touches Supabase. A missing object answers 400 with
 * cf-cache-status BYPASS, so a miss is never cached and a check right after
 * a promote sees the new object. A 404 is final; a 400 or 429 is retried
 * (a real miss stays 400 every time), with exponential backoff
 * (0.5, 1, 2, 4 s) and a timeout per attempt. `status` is the last HTTP
 * status, "timeout"/"network", or "size <n>" — frames-check prints it.
 * (2026-09-25: first-400-is-missing, a hung HEAD, and 429s from several CI
 * runs at once each failed the gate on objects that were there.)
 */
export async function objectStatus(url, expectedBytes, { tries = 5, baseDelayMs = 500, timeoutMs = 10_000 } = {}) {
  let status = "network";
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Never download the body (a server that ignores Range sends it all).
      await res.body?.cancel().catch(() => {});
      status = String(res.status);
      if (res.status === 404) return { ok: false, status };
      if (res.ok) {
        // 206: "bytes 0-0/<total>"; 200 (Range ignored): content-length.
        const range = res.headers.get("content-range")?.match(/\/(\d+)$/)?.[1];
        const size = range ?? res.headers.get("content-length");
        if (!size || !expectedBytes || Number(size) === expectedBytes) return { ok: true, status };
        return { ok: false, status: `size ${size}` };
      }
    } catch (err) {
      status = err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "network";
    }
    if (attempt < tries) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** (attempt - 1)));
  }
  return { ok: false, status };
}

/** True when a public object exists at the expected size — objectStatus().ok
 *  with a SHORT budget (3 tries, 0.3 s → 0.6 s): publish / promote /
 *  restore-dev check objects that are usually missing, and they re-verify
 *  their own uploads. The gate (frames-check) uses findMissing instead. */
export async function objectExists(url, expectedBytes, opts) {
  return (await objectStatus(url, expectedBytes, { tries: 3, baseDelayMs: 300, ...opts })).ok;
}

/**
 * Which of `items` are missing. `check(item, thorough)` returns
 * { ok, status }. A quick first pass runs `limit` at a time; then — after
 * `confirmDelayMs` — every apparent miss is checked again THOROUGHLY, one at
 * a time, so a burst of transient storage errors can't fail a gate on its
 * own. More than `maxConfirm` misses is not a blip (a manifest nobody
 * promoted): those are reported without the slow confirm pass. Returns
 * [{ item, status }] for the misses.
 */
export async function findMissing(items, check, { limit = 4, confirmDelayMs = 3000, maxConfirm = 25 } = {}) {
  const first = await mapLimit(items, limit, async (item) => ({ item, result: await check(item, false) }));
  const suspects = first.filter((r) => !r.result.ok);
  if (suspects.length === 0) return [];
  if (suspects.length > maxConfirm) return suspects.map(({ item, result }) => ({ item, status: result.status }));
  await new Promise((r) => setTimeout(r, confirmDelayMs));
  const missing = [];
  for (const { item } of suspects) {
    const result = await check(item, true);
    if (!result.ok) missing.push({ item, status: result.status });
  }
  return missing;
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
