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

/** objectStatus's status for a lookup its caller's budget cut short. */
export const DEADLINE = "deadline";

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
 * runs at once each failed the gate on objects that were there.) `signal`
 * is the caller's whole budget (frames-check's deadline): once it fires the
 * request in flight and any backoff end at once with status "deadline" —
 * never `ok`, and never a miss to report (findMissing throws
 * FramesCheckDeadline instead).
 * @param {string} url
 * @param {number} expectedBytes
 * @param {{ tries?: number, baseDelayMs?: number, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, status: string }>}
 */
export async function objectStatus(url, expectedBytes, { tries = 5, baseDelayMs = 500, timeoutMs = 10_000, signal } = {}) {
  let status = "network";
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    if (signal?.aborted) return { ok: false, status: DEADLINE };
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
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
      if (signal?.aborted) return { ok: false, status: DEADLINE };
      status = err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "network";
    }
    if (attempt < tries) await pause(baseDelayMs * 2 ** (attempt - 1), signal);
  }
  return { ok: false, status: signal?.aborted ? DEADLINE : status };
}

/** Wait `ms`, or less if `signal` fires first (never rejects; the listener
 *  is removed either way — one signal serves thousands of lookups). */
function pause(ms, signal) {
  if (!signal) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done);
  });
}

/**
 * Download a public object WHOLE and keep it only when its bytes are the
 * manifest's: { ok: true, bytes, status } or { ok: false, status }. A 404
 * is final; a 400/429/5xx, a timeout, a dropped connection or bytes with
 * the wrong sha256 (a truncated body) are retried with the same backoff as
 * objectStatus. `status` on a miss is the last HTTP status, "timeout",
 * "network" or "sha256 mismatch". scripts/frames-fetch.mjs uses it to give
 * CI the bucket masters (TODO 7.6); the sha is what makes a fallback origin
 * (the dev bucket) as trustworthy as production. `fetchImpl` is for tests.
 * @param {string} url
 * @param {string} expectedSha256
 * @param {{ tries?: number, baseDelayMs?: number, timeoutMs?: number,
 *   fetchImpl?: (url: string, init?: { signal?: AbortSignal }) => Promise<Response> }} [options]
 */
export async function fetchVerified(url, expectedSha256, { tries = 4, baseDelayMs = 500, timeoutMs = 60_000, fetchImpl = fetch } = {}) {
  let status = "network";
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      status = String(res.status);
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (sha256(bytes) === expectedSha256) return { ok: true, bytes, status };
        status = "sha256 mismatch";
      } else {
        await res.body?.cancel().catch(() => {});
        if (res.status === 404) return { ok: false, status };
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
 * Thrown by findMissing when its `signal` fires before every item has an
 * answer: the gate could not VERIFY the manifest, which is neither a pass
 * nor a list of misses. `checked` items answered, `suspects` of them not ok
 * so far, `statuses` counts their last answers.
 */
export class FramesCheckDeadline extends Error {
  constructor({ checked, total, suspects, statuses }) {
    super(`ran out of time with ${checked}/${total} checked`);
    this.name = "FramesCheckDeadline";
    Object.assign(this, { checked, total, suspects, statuses });
  }
}

/**
 * Which of `items` are missing. `check(item, thorough)` returns
 * { ok, status }. A quick first pass runs `limit` at a time; then — after
 * `confirmDelayMs` — every apparent miss is checked again THOROUGHLY, one at
 * a time, so a burst of transient storage errors can't fail a gate on its
 * own. More than `maxConfirm` misses is not a blip (a manifest nobody
 * promoted): those are reported without the slow confirm pass. Returns
 * [{ item, status }] for the misses.
 *
 * `signal` is the whole check's budget: once it fires no new lookup starts
 * (a `check` given the same signal ends its own at once) and findMissing
 * throws FramesCheckDeadline — never a pass, and never misses it did not
 * see. `onProgress({ done, total, suspects })` follows the first pass.
 * (2026-11-02: two "Frames published" runs went silent until the job's
 * 10-minute timeout — 4280 lookups through a slow CDN, each inside its own
 * timeout.)
 * @template T
 * @param {T[]} items
 * @param {(item: T, thorough: boolean) => Promise<{ ok: boolean, status: string }>} check
 * @param {{ limit?: number, confirmDelayMs?: number, maxConfirm?: number, signal?: AbortSignal,
 *   onProgress?: (progress: { done: number, total: number, suspects: number }) => void }} [options]
 * @returns {Promise<Array<{ item: T, status: string }>>}
 */
export async function findMissing(items, check, { limit = 4, confirmDelayMs = 3000, maxConfirm = 25, signal, onProgress } = {}) {
  let done = 0;
  let suspectCount = 0;
  const first = await mapLimit(items, limit, async (item) => {
    if (signal?.aborted) return { item, result: null };
    const result = await check(item, false);
    if (result.status !== DEADLINE) {
      done += 1;
      if (!result.ok) suspectCount += 1;
      onProgress?.({ done, total: items.length, suspects: suspectCount });
    }
    return { item, result };
  });
  const answered = first.filter((r) => r.result && r.result.status !== DEADLINE);
  const suspects = answered.filter((r) => !r.result.ok);
  const deadline = (checked) => {
    const statuses = {};
    for (const { result } of suspects) statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    return new FramesCheckDeadline({ checked, total: items.length, suspects: suspects.length, statuses });
  };
  if (answered.length < items.length) throw deadline(answered.length);
  if (suspects.length === 0) return [];
  if (suspects.length > maxConfirm) return suspects.map(({ item, result }) => ({ item, status: result.status }));
  await pause(confirmDelayMs, signal);
  const missing = [];
  for (const { item } of suspects) {
    if (signal?.aborted) throw deadline(items.length);
    const result = await check(item, true);
    if (result.status === DEADLINE) throw deadline(items.length);
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
