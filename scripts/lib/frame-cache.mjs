// ---------------------------------------------------------------------------
// frame-cache.mjs — ONE frame store per machine, shared by every checkout and
// agent worktree (2026-10-22: each fresh worktree re-downloaded the 1.3 GB of
// frame PNGs, twice — tmp/visual/frames and .frames-cache — and took the
// org over Supabase's cached-egress quota).
//
// The store (default ~/.cache/pipglyph/frames, PIPGLYPH_FRAMES_CACHE to move
// it, "off" to skip it) holds bucket OBJECTS by their content-addressed key
// (`m15/w.<hash>.png`, the visual cache's layout), so two manifests never
// fight over a name and nothing in it is ever pruned by one checkout. A
// checkout's own folders — tmp/visual/frames (object keys) and .frames-cache
// (manifest keys) — stay where they were, each pruned to its manifest, and
// are filled from the store by a HARD LINK (no second copy on disk; a plain
// copy when the store is on another volume). Downloads land in the store
// first. A linked file is never written in place — every write here is a
// new file renamed over the old name, which leaves the other link alone —
// and both sides are sha-checked on every use, so a file changed by hand is
// caught, not spread. (Node's COPYFILE_FICLONE does not clone on macOS: it
// measured as a full copy, 2026-10-22.)
//
// Safe to share because nothing is trusted by its name: a store file is
// used only when its bytes hash to the manifest's sha256 (else it is fetched
// again and replaced), and every write — store or checkout — is a temp file
// in the same folder renamed into place, so a reader or a second agent
// syncing at the same time sees the old file or the new one, never half.
//
// CI keeps today's per-run folders (actions/cache restores them): no store
// there. Unit-tested in tests/unit/devops/frame-cache.test.ts.
// ---------------------------------------------------------------------------
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PRODUCTION_SUPABASE_REF } from "./prod-guard.mjs";
import { fetchVerified, frameObjectKey, publicBaseFor } from "./frame-objects.mjs";

export const FRAMES_CACHE_ENV = "PIPGLYPH_FRAMES_CACHE";
/** Written into the store so a person who finds it knows what it is. */
export const STORE_MARKER = ".pipglyph-frames-cache";

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {(url: string, init?: { signal?: AbortSignal }) => Promise<Response>} FetchLike */

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** True on a CI runner (GitHub Actions sets CI=true).
 * @param {Env} [env] */
export function isCi(env = process.env) {
  const value = env.CI?.trim().toLowerCase();
  return Boolean(value) && value !== "false" && value !== "0";
}

/**
 * The machine's shared frame store, or null where there is none: on CI
 * (its caches are per run), or when PIPGLYPH_FRAMES_CACHE is "off" / "0".
 * PIPGLYPH_FRAMES_CACHE=<dir> moves it ("~/" is the home folder; a relative
 * path is taken from `cwd`).
 * @param {{ env?: Env, home?: string, cwd?: string }} [opts]
 */
export function sharedFrameCacheDir({ env = process.env, home = os.homedir(), cwd = process.cwd() } = {}) {
  if (isCi(env)) return null;
  const value = env[FRAMES_CACHE_ENV]?.trim();
  if (value && /^(off|0|false|no)$/i.test(value)) return null;
  if (value) {
    const expanded = value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
    return path.resolve(cwd, expanded);
  }
  return path.join(home, ".cache", "pipglyph", "frames");
}

/** Make the store folder and its marker (idempotent). */
export function prepareStore(store) {
  fs.mkdirSync(store, { recursive: true });
  const marker = path.join(store, STORE_MARKER);
  if (!fs.existsSync(marker)) {
    fs.writeFileSync(
      marker,
      "PipGlyph frame PNGs (bucket objects by content-addressed key), shared by every checkout on this machine.\n" +
        "Every file is checked against lib/frames/frame-manifest.json's sha256 before use. Safe to delete: rm -rf this folder.\n" +
        "Never commit these files (docs/FRAMES.md, Provenance and legal).\n",
    );
  }
}

/** The dev branch's project ref, from supabase/config.toml [remotes.dev]. */
export function devSupabaseRef(root) {
  const ref = /\[remotes\.dev\][^[]*?project_id\s*=\s*"([a-z]{16,24})"/s.exec(fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8"))?.[1];
  if (!ref || ref === PRODUCTION_SUPABASE_REF) throw new Error("supabase/config.toml has no usable [remotes.dev] project_id.");
  return ref;
}

/**
 * The public frames bucket bases: production's, dev's, and the default
 * order — on CI production's first (what production bakes with; dev covers
 * a frame not promoted yet), locally the DEV bucket alone (the one every
 * local tool reads; name production with --origin when it is needed).
 * @param {{ root: string, env?: Env }} args
 */
export function frameBucketOrigins({ root, env = process.env }) {
  const production = publicBaseFor(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`);
  const dev = publicBaseFor(`https://${devSupabaseRef(root)}.supabase.co`);
  return { production, dev, defaults: isCi(env) ? [production, dev] : [dev] };
}

/** True when `file` exists and its bytes hash to `expectedSha256`. */
export function hasVerifiedFile(file, expectedSha256) {
  try {
    return sha256(fs.readFileSync(file)) === expectedSha256;
  } catch {
    return false;
  }
}

/** A temp name beside `file` no other process or call can pick. */
const tempBeside = (file) => `${file}.${process.pid}.${randomBytes(4).toString("hex")}.part`;

/** Write `bytes` to `file` atomically: a temp file in the same folder,
 *  renamed into place (a reader sees the old file or the new one). */
export function writeFileAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tempBeside(file);
  try {
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Give `dest` the bytes of `src` atomically: a hard link under a temp name
 * (no second copy on disk), else — another volume, a file system without
 * links — a copy (a reflink where Linux has them), renamed into place. With
 * `expectedSha256` the new file is checked BEFORE the rename; returns false
 * (and leaves `dest` alone) when its bytes differ or `src` is gone.
 * @param {string} src
 * @param {string} dest
 * @param {string | null} [expectedSha256]
 */
export function linkFileAtomic(src, dest, expectedSha256 = null) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = tempBeside(dest);
  try {
    try {
      fs.linkSync(src, tmp);
    } catch (err) {
      if (err?.code === "ENOENT") throw err;
      fs.copyFileSync(src, tmp, fs.constants.COPYFILE_FICLONE);
    }
    if (expectedSha256 && sha256(fs.readFileSync(tmp)) !== expectedSha256) {
      fs.rmSync(tmp, { force: true });
      return false;
    }
    fs.renameSync(tmp, dest);
    return true;
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    if (err?.code === "ENOENT" && !fs.existsSync(src)) return false;
    throw err;
  }
}

/**
 * Before any download: is the checkout's `file` already right, or can the
 * store give it? Returns "kept" (the checkout's copy matches; it is also
 * handed to the store when the store has none — an older worktree seeds
 * it), "shared" (linked from a store copy that matches) or null (fetch it).
 * A store copy whose bytes differ is never used: null, and the fetch
 * replaces it.
 * @param {{ file: string, storeFile: string | null, sha256: string }} args
 */
export function fromCheckoutOrStore({ file, storeFile, sha256: expected }) {
  if (hasVerifiedFile(file, expected)) {
    if (storeFile && !fs.existsSync(storeFile)) {
      try {
        linkFileAtomic(file, storeFile);
      } catch {
        /* a store we can't write to only costs a later download */
      }
    }
    return "kept";
  }
  if (storeFile && fs.existsSync(storeFile) && linkFileAtomic(storeFile, file, expected)) return "shared";
  return null;
}

/**
 * After a download whose bytes matched the manifest: into the store first
 * (when there is one) and linked from there into the checkout's `file`;
 * without a store, straight into `file`. Both writes atomic.
 * @param {{ file: string, storeFile: string | null, bytes: Buffer }} args
 */
export function keepFetched({ file, storeFile, bytes }) {
  if (storeFile) {
    try {
      writeFileAtomic(storeFile, bytes);
      // false: the store file went away in between (the store was cleared).
      if (linkFileAtomic(storeFile, file)) return;
    } catch {
      /* a store we can't write to: the checkout still gets its copy */
    }
  }
  writeFileAtomic(file, bytes);
}

/**
 * scripts/frames-fetch.mjs's step for one manifest PNG: `<out>/<key>` (the
 * importer-build layout) from this checkout's copy, else the store's, else
 * `origin`, else `fallback` — each only at the manifest's sha256. Returns
 * { from: "kept" | "shared" | "origin" | "fallback" } or { from: null,
 * status } (neither bucket had it).
 * @param {{ key: string, entry: { hash: string, sha256: string }, out: string, store: string | null,
 *   origin: string, fallback?: string | null,
 *   fetchOptions?: { tries?: number, baseDelayMs?: number, timeoutMs?: number, fetchImpl?: FetchLike } }} args
 */
export async function fetchManifestFile({ key, entry, out, store, origin, fallback = null, fetchOptions }) {
  const file = path.join(out, key);
  const objectKey = frameObjectKey(key, entry.hash);
  const storeFile = store ? path.join(store, objectKey) : null;
  const local = fromCheckoutOrStore({ file, storeFile, sha256: entry.sha256 });
  if (local) return { from: local };
  let result = await fetchVerified(`${origin}/${objectKey}`, entry.sha256, fetchOptions);
  let from = "origin";
  if (!result.ok && fallback) {
    const second = await fetchVerified(`${fallback}/${objectKey}`, entry.sha256, fetchOptions);
    if (second.ok) {
      result = second;
      from = "fallback";
    } else {
      result = { ok: false, status: `${result.status}; fallback ${second.status}` };
    }
  }
  if (!result.ok) return { from: null, status: result.status };
  keepFetched({ file, storeFile, bytes: result.bytes });
  return { from };
}
