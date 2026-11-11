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
 * never `ok`, and never a miss to report (checkObjects counts the object
 * as not looked at). `onAnswer({ status, cached })` hears every
 * attempt: the HTTP status (0 for a timeout or a dropped connection) and
 * whether the CDN answered from its cache (`cf-cache-status: HIT`) — an
 * answer that is NOT cached reached Supabase's storage API and its small
 * connection pool, which is what createLookupPacer paces.
 * @param {string} url
 * @param {number} expectedBytes
 * @param {{ tries?: number, baseDelayMs?: number, timeoutMs?: number, signal?: AbortSignal,
 *   onAnswer?: (answer: { status: number, cached: boolean }) => void }} [options]
 * @returns {Promise<{ ok: boolean, status: string }>}
 */
export async function objectStatus(url, expectedBytes, { tries = 5, baseDelayMs = 500, timeoutMs = 10_000, signal, onAnswer } = {}) {
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
      onAnswer?.({ status: res.status, cached: /^hit$/i.test(res.headers.get("cf-cache-status") ?? "") });
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
      onAnswer?.({ status: 0, cached: false });
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
 *  their own uploads. The gate (frames-check) uses checkObjects instead. */
export async function objectExists(url, expectedBytes, opts) {
  return (await objectStatus(url, expectedBytes, { tries: 3, baseDelayMs: 300, ...opts })).ok;
}

/**
 * The PACE of lookups against production storage (2026-11-10). A lookup the
 * CDN answers from its cache costs Supabase nothing. One it does NOT (a cold
 * CDN: the cache is per location, and a runner lands on a different one from
 * run to run) reaches the storage API, whose nodes each open their own
 * pooled database connections and keep them a minute — so a few uncached
 * lookups a second spread over the whole fleet and exhaust the project's
 * connection pooler (`max_client_conn`). When that happened every storage
 * request of the SITE was refused for as long as the check ran: thumbnails
 * (the /render-cdn 502s), art uploads, card bakes. So:
 *
 *   - FAST while answers are cached: `limit` lookups in flight;
 *   - SLOW from the first answer that is not (or that never came): ONE
 *     lookup in flight, and `slowGapMs` after every uncached answer before
 *     the next starts — about one a second at the default (the gap plus the
 *     lookup itself), a quarter of what four in flight sent, which is what
 *     keeps most of the storage fleet's pools closed. Not slower: a pull
 *     request that adds a few hundred frames (every one uncached the first
 *     time) must still finish its check. `recoverAfter` cached answers in a
 *     row make it fast again;
 *   - a 429 means storage is ALREADY saturated (by this check or by anyone):
 *     nothing starts for `busyPauseMs` (the minute its connections live),
 *     then it goes on slowly. After `maxBusyPauses` such pauses the next 429
 *     STOPS the check (`stopped` = "busy"): it never keeps knocking.
 *
 * `acquire(signal)` waits for a turn — false when the check is stopped or
 * `signal` fired; `release()` gives the turn back; `note(answer)` is
 * objectStatus's `onAnswer`. `now` / `sleep` are for tests.
 * @param {{ limit?: number, slowGapMs?: number, recoverAfter?: number, busyPauseMs?: number,
 *   maxBusyPauses?: number, now?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void> }} [options]
 */
export function createLookupPacer({ limit = 4, slowGapMs = 500, recoverAfter = 12, busyPauseMs = 60_000, maxBusyPauses = 3, now = Date.now, sleep = pause } = {}) {
  let inFlight = 0;
  let slow = false;
  let cachedStreak = 0;
  let uncached = 0;
  let busyPauses = 0;
  let busyUntil = 0;
  let notBefore = 0;
  /** @type {"busy" | null} */
  let stopped = null;
  /** @type {Array<() => void>} */
  let waiting = [];
  const wake = () => {
    const woken = waiting;
    waiting = [];
    for (const resolve of woken) resolve();
  };
  return {
    limit,
    get stopped() {
      return stopped;
    },
    stats: () => ({ uncached, busyPauses, slow, stopped }),
    async acquire(signal) {
      for (;;) {
        if (stopped || signal?.aborted) return false;
        if (inFlight >= (slow ? 1 : limit)) {
          // Woken by the release of the lookup in flight (one always is).
          await new Promise((resolve) => waiting.push(resolve));
          continue;
        }
        const wait = notBefore - now();
        if (wait <= 0) {
          inFlight += 1;
          return true;
        }
        // Hold the turn while waiting: nobody else may start meanwhile.
        inFlight += 1;
        await sleep(wait, signal);
        inFlight -= 1;
        wake();
      }
    },
    release() {
      inFlight -= 1;
      wake();
    },
    note({ status, cached }) {
      if (status === 429) {
        slow = true;
        cachedStreak = 0;
        // Several lookups in flight may all come back 429: one pause.
        if (now() < busyUntil) return;
        if (busyPauses >= maxBusyPauses) {
          stopped = "busy";
          return;
        }
        busyPauses += 1;
        busyUntil = now() + busyPauseMs;
        notBefore = Math.max(notBefore, busyUntil);
        return;
      }
      if (cached) {
        cachedStreak += 1;
        if (slow && cachedStreak >= recoverAfter) slow = false;
        return;
      }
      uncached += 1;
      cachedStreak = 0;
      slow = true;
      notBefore = Math.max(notBefore, now() + slowGapMs);
    },
  };
}

/** A last answer that says nothing about the object: storage was busy or
 *  out of reach (429, 5xx, a timeout, a dropped connection). A 400 is NOT
 *  one — it is what a missing public object answers. */
export function isNoAnswer(status) {
  return status === "429" || status === "timeout" || status === "network" || /^5\d\d$/.test(status);
}

/**
 * Look `items` up and say what was learned — the gate's two passes, with a
 * pace and without a verdict (scripts/lib/frames-check-run.mjs decides):
 *
 *   { missing, unverified, unchecked, suspects, checked, total, stopped }
 *
 * `lookup(item, thorough, onAnswer)` returns { ok, status }. A first pass
 * runs `limit` at a time (the `pacer`'s limit and pace when one is given);
 * then — after `confirmDelayMs` — every apparent miss is looked up again,
 * one at a time, up to `confirmTries` times (`thorough` true), so a burst of
 * transient storage errors can't fail a gate on its own. More than
 * `maxConfirm` answers that SAY missing (isNoAnswer is false) is not a blip
 * (a manifest nobody promoted): those are `missing` without the slow pass.
 *
 *   missing     [{ item, status }] — still not there after the confirm pass
 *               (or more than maxConfirm of them);
 *   unverified  [{ item, status }] — an apparent miss the confirm pass could
 *               not settle: its last try got no answer (isNoAnswer), or the
 *               check stopped first. `status` is the latest answer that
 *               SAID missing in either pass when there was one (so a caller
 *               can tell "storage was only silent about it" from "it said
 *               missing and was never found"), else the last silence.
 *               Neither a miss nor a pass;
 *   unchecked   items never looked at (the budget fired, or the pacer
 *               stopped: storage was saturated);
 *   suspects    the first pass's apparent misses, [{ item, status }];
 *   stopped     null, "deadline" (a signal fired) or "busy" (the pacer).
 *
 * `signal` ends the FIRST pass (no new lookup starts); `confirmSignal`
 * (default: the same) ends the confirm pass — a sweep gives the first pass
 * less time so that what it found can still be confirmed.
 * `onProgress({ done, total, suspects })` follows the first pass.
 * @template T
 * @param {T[]} items
 * @param {(item: T, thorough: boolean, onAnswer?: (answer: { status: number, cached: boolean }) => void) => Promise<{ ok: boolean, status: string }>} lookup
 * @param {{ limit?: number, confirmDelayMs?: number, maxConfirm?: number, confirmTries?: number, signal?: AbortSignal,
 *   confirmSignal?: AbortSignal, pacer?: ReturnType<typeof createLookupPacer> | null,
 *   onProgress?: (progress: { done: number, total: number, suspects: number }) => void }} [options]
 */
export async function checkObjects(
  items,
  lookup,
  { limit = 4, confirmDelayMs = 3000, maxConfirm = 25, confirmTries = 1, signal, confirmSignal = signal, pacer = null, onProgress } = {},
) {
  /** One paced lookup: its answer, or null when it never ran or was cut short. */
  const one = async (item, thorough, budget) => {
    if (budget?.aborted) return null;
    if (pacer && !(await pacer.acquire(budget))) return null;
    try {
      const result = await lookup(item, thorough, pacer ? pacer.note : undefined);
      return result.status === DEADLINE ? null : result;
    } finally {
      pacer?.release();
    }
  };
  const stopReason = (budget) => (budget?.aborted ? "deadline" : (pacer?.stopped ?? "deadline"));

  /** @type {Array<{ ok: boolean, status: string } | null>} */
  const results = new Array(items.length).fill(null);
  let done = 0;
  let suspectCount = 0;
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      const result = await one(items[i], false, signal);
      if (!result) continue;
      results[i] = result;
      done += 1;
      if (!result.ok) suspectCount += 1;
      onProgress?.({ done, total: items.length, suspects: suspectCount });
    }
  };
  await Promise.all(Array.from({ length: Math.min(pacer?.limit ?? limit, items.length) }, worker));

  const unchecked = items.filter((_, i) => results[i] === null);
  const suspects = items.flatMap((item, i) => (results[i] && !results[i].ok ? [{ item, status: results[i].status }] : []));
  const out = {
    /** @type {Array<{ item: T, status: string }>} */
    missing: [],
    /** @type {Array<{ item: T, status: string }>} */
    unverified: [],
    unchecked,
    suspects,
    checked: items.length - unchecked.length,
    total: items.length,
    /** @type {"deadline" | "busy" | null} */
    stopped: unchecked.length ? stopReason(signal) : null,
  };
  if (suspects.length === 0) return out;
  if (suspects.filter((s) => !isNoAnswer(s.status)).length > maxConfirm) {
    for (const s of suspects) (isNoAnswer(s.status) ? out.unverified : out.missing).push(s);
    return out;
  }
  await pause(confirmDelayMs, confirmSignal);
  // What SAID missing first: those answers come at once, while an object
  // storage is silent about costs a timeout a try — a few of them must not
  // use up the time a real miss needs to be settled in.
  const inOrder = [...suspects.filter((s) => !isNoAnswer(s.status)), ...suspects.filter((s) => isNoAnswer(s.status))];
  for (const suspect of inOrder) {
    /** @type {string | null} */
    let last = null;
    /** The latest answer that SAID missing, in either pass. Only finding
     *  the object takes it back: silence or a cut afterwards does not. */
    let said = isNoAnswer(suspect.status) ? null : suspect.status;
    let found = false;
    for (let attempt = 1; attempt <= confirmTries; attempt += 1) {
      const result = await one(suspect.item, true, confirmSignal);
      if (!result) {
        last = null;
        break;
      }
      last = result.status;
      if (result.ok) {
        found = true;
        break;
      }
      if (!isNoAnswer(result.status)) said = result.status;
      if (result.status === "404") break;
    }
    if (found) continue;
    if (last === null) {
      // Cut short (the budget, or storage saturated): not settled.
      out.unverified.push({ item: suspect.item, status: said ?? suspect.status });
      out.stopped ??= stopReason(confirmSignal);
    } else if (isNoAnswer(last)) {
      // Storage went silent on it: not settled either.
      out.unverified.push({ item: suspect.item, status: said ?? last });
    } else {
      out.missing.push({ item: suspect.item, status: last });
    }
  }
  return out;
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
