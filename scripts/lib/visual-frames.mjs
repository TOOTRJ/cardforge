// ---------------------------------------------------------------------------
// visual-frames.mjs — the visual-regression suite's frame cache (TODO 7.1):
// every PNG object lib/frames/frame-manifest.json names, downloaded by
// manifest key into a local folder (tmp/visual/frames, gitignored — Card
// Conjurer-derived frames never enter git) and kept only when its bytes
// match the manifest's sha256. Used by scripts/visual-regression.mjs;
// unit-tested in tests/unit/devops/visual-frames.test.ts.
//
// Storage answers transient errors under load — a 429, a 5xx, a hang, and
// sometimes a 400 for an object that is there (the "Frames published" gate
// met all of them; scripts/lib/frame-objects.mjs findMissing). So, like that
// gate: a quick first pass (a 404/400 = "not published at this origin" → the
// next origin; other failures retried a few times), then every object that
// pass could not get is tried again THOROUGHLY, one at a time after a pause,
// with a 404/400 retried too. Only what fails both passes fails the run.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { frameObjectKey, mapLimit } from "./frame-objects.mjs";

/** @typedef {(url: string, init?: { signal?: AbortSignal }) => Promise<Response>} FetchLike */
/** @typedef {{ hash: string, sha256: string, bytes?: number }} ManifestEntry */

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {number} ms */
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One manifest object into `dir`, from the first origin that serves it with
 * the manifest's sha256. Returns { key, cached } / { key, cached: false,
 * bytes } / { key, error }.
 * @param {{ key: string, entry: ManifestEntry, origins: string[], dir: string, thorough?: boolean,
 *   fetchImpl?: FetchLike, sleep?: (ms: number) => Promise<unknown>, timeoutMs?: number }} args
 */
export async function fetchFrameObject({ key, entry, origins, dir, thorough = false, fetchImpl = fetch, sleep = defaultSleep, timeoutMs = 60_000 }) {
  const objectKey = frameObjectKey(key, entry.hash);
  const file = path.join(dir, objectKey);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === entry.sha256) return { key, cached: true };
  const tries = thorough ? 4 : 3;
  const baseDelayMs = thorough ? 1000 : 500;
  const tried = [];
  for (const origin of origins) {
    for (let attempt = 1; attempt <= tries; attempt += 1) {
      try {
        const res = await fetchImpl(`${origin}/${objectKey}`, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 404 || res.status === 400) {
          await res.body?.cancel().catch(() => {});
          tried.push(`${origin}: ${res.status}`);
          // The quick pass takes "not here" at its word (a frame not yet
          // promoted to production is on the dev bucket); the confirm pass
          // does not — storage has answered 400 for objects that exist.
          if (!thorough) break;
        } else {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const bytes = Buffer.from(await res.arrayBuffer());
          if (sha256(bytes) !== entry.sha256) throw new Error("sha256 differs from the manifest");
          fs.mkdirSync(path.dirname(file), { recursive: true });
          const partial = `${file}.${process.pid}.part`;
          fs.writeFileSync(partial, bytes);
          fs.renameSync(partial, file);
          return { key, cached: false, bytes: bytes.byteLength };
        }
      } catch (err) {
        tried.push(`${origin}: ${err instanceof Error ? err.message : err}`);
      }
      if (attempt < tries) await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return { key, error: tried.join("; ") };
}

/** Every file under `dir` (none when it doesn't exist). */
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

/**
 * Fill `dir` with `entries` ([key, manifest entry] pairs): the quick pass
 * `limit` at a time, then a confirm pass over its failures, one at a time
 * after `confirmDelayMs`. Drops cached files no entry names (CI restores an
 * older manifest's cache as a starting point). Returns { cached, fetched,
 * bytes, failed: [{ key, error }] }.
 * @param {{ entries: [string, ManifestEntry][], origins: string[], dir: string, fetchImpl?: FetchLike,
 *   sleep?: (ms: number) => Promise<unknown>, limit?: number, confirmDelayMs?: number }} args
 */
export async function syncFrameCache({ entries, origins, dir, fetchImpl = fetch, sleep = defaultSleep, limit = 4, confirmDelayMs = 3000 }) {
  const get = (entry, thorough) => fetchFrameObject({ key: entry[0], entry: entry[1], origins, dir, thorough, fetchImpl, sleep });
  const results = await mapLimit(entries, limit, (entry) => get(entry, false));
  const retry = results.map((r, i) => (r.error ? i : -1)).filter((i) => i >= 0);
  if (retry.length) {
    await sleep(confirmDelayMs);
    for (const i of retry) results[i] = await get(entries[i], true);
  }
  const wanted = new Set(entries.map(([key, entry]) => path.join(dir, frameObjectKey(key, entry.hash))));
  for (const file of walk(dir)) if (!wanted.has(file)) fs.rmSync(file);
  const fetched = results.filter((r) => r.cached === false);
  return {
    cached: results.filter((r) => r.cached === true).length,
    fetched: fetched.length,
    bytes: fetched.reduce((n, r) => n + r.bytes, 0),
    failed: results.filter((r) => r.error).map(({ key, error }) => ({ key, error })),
  };
}
