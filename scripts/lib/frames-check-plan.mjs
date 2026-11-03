// ---------------------------------------------------------------------------
// frames-check-plan.mjs — WHICH manifest objects the production build's
// frames check looks up (scripts/frames-check.mjs --incremental; owner
// 2026-11-02, recommendation 4 of docs/research/vercel-build-cost-2026-11.md).
//
// The full check is 4,280 lookups, 4 at a time, on every production build:
// 107–671 s, about half of a production build. Only ~11 % of merges move the
// manifest. So a production build checks:
//
//   - every manifest object that is NEW or CHANGED against the manifest of
//     the LAST SUCCESSFUL DEPLOYMENT of this branch (VERCEL_GIT_PREVIOUS_SHA,
//     read from git — a commit's tree, which no build can rewrite); a
//     removed object is not looked up (nothing references it any more);
//   - plus a CANARY of `CANARY_SIZE` of the unchanged ones, a sample that is
//     the same for one commit and rotates from commit to commit.
//
// Why the unchanged ones may be trusted: that earlier deployment's own build
// passed this gate over them (a production build of `main` does not succeed
// otherwise), the objects are content-addressed (the key holds the sha), and
// nothing in the repository deletes from production's bucket
// (frames-promote only copies what production lacks). What is left — a hand
// deletion or a storage loss — is what the canary samples and CI's NIGHTLY
// full check ("Frames published" in the nightly / idle tiers,
// scripts/lib/ci-docs-only.mjs) catches within a day; the full check never
// caught it any sooner than the next deploy anyway.
//
// FAIL CLOSED: any doubt is the FULL check — not asked for (`--incremental`
// missing), not a production build, another origin, `FRAMES_CHECK_FULL=1`,
// no (or a malformed) previous or current SHA, a git error, a base manifest
// that does not parse or names another bucket. The plan only ever chooses
// WHAT to look up; a lookup that fails still fails the build, exactly as
// the full check does.
//
// Why not a record in Vercel's build cache (the research's first idea):
// Vercel keys the build cache by team, project, framework, root directory,
// Node version, package manager and GIT BRANCH — not by environment
// (vercel.com/docs/deployments/troubleshoot-a-build, "Caching process"), and
// a new branch starts from the last production cache. Nothing documented
// stops a preview deployment of `main` (a CLI deploy) from writing the cache
// a production build restores, so a cache file must never vouch for frames.
// ---------------------------------------------------------------------------
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { BUCKET, MANIFEST_PATH, frameObjectKey } from "./frame-objects.mjs";

/** How many unchanged objects a production build re-checks besides the new ones. */
export const CANARY_SIZE = 200;

/** A full git object name: SHA-1 (40) or SHA-256 (64), lower-case hex. */
const GIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Run git and return its stdout, or throw. `cwd` is the repository.
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number }} [options]
 */
export function runGit(args, { cwd, timeoutMs = 60_000 } = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The frame manifest as it was at commit `sha`: { manifest } or { error }.
 * Never throws. Vercel's clone is shallow, so a commit that is not in it is
 * fetched (that commit alone); a failure of either is an error, which the
 * caller turns into the full check.
 * @param {string} sha
 * @param {{ git?: (args: string[]) => string, file?: string }} [options]
 * @returns {{ manifest: { version: number, bucket?: string, files: Record<string, unknown> } } | { error: string }}
 */
export function readManifestAt(sha, { git = (args) => runGit(args), file = MANIFEST_PATH } = {}) {
  if (typeof sha !== "string" || !GIT_SHA.test(sha)) return { error: `"${sha}" is not a full commit SHA` };
  try {
    try {
      git(["cat-file", "-e", `${sha}^{commit}`]);
    } catch {
      git(["fetch", "--no-tags", "--depth=1", "origin", sha]);
      git(["cat-file", "-e", `${sha}^{commit}`]);
    }
    const text = git(["show", `${sha}:${file}`]);
    const manifest = JSON.parse(text);
    if (!manifest || manifest.version !== 1 || typeof manifest.files !== "object" || manifest.files === null || Array.isArray(manifest.files)) {
      return { error: `${file} at ${sha.slice(0, 12)} is not a version-1 frame manifest` };
    }
    return { manifest };
  } catch (err) {
    const detail = String(err?.stderr || err?.message || err).trim().split("\n")[0];
    return { error: `git could not read ${file} at ${sha.slice(0, 12)} (${detail})` };
  }
}

/** Is a manifest entry the same OBJECT in both manifests (same key, sha suffix and size)? */
function sameObject(entry, before) {
  return (
    !!before &&
    typeof before === "object" &&
    typeof entry?.hash === "string" &&
    before.hash === entry.hash &&
    typeof entry?.bytes === "number" &&
    before.bytes === entry.bytes
  );
}

/**
 * `size` of `entries` (manifest [key, entry] pairs), chosen by
 * sha256(seed, object key): the same seed (a commit) always picks the same
 * ones, another seed others. Returned in manifest order.
 * @template {[string, { hash: string }]} T
 * @param {T[]} entries
 * @param {string} seed
 * @param {number} size
 * @returns {T[]}
 */
export function canarySample(entries, seed, size) {
  if (size <= 0) return [];
  if (entries.length <= size) return [...entries];
  const rank = new Map(entries.map((item) => [item, createHash("sha256").update(`${seed}\0${frameObjectKey(item[0], item[1].hash)}`).digest("hex")]));
  const picked = new Set([...entries].sort((a, b) => (rank.get(a) < rank.get(b) ? -1 : rank.get(a) > rank.get(b) ? 1 : 0)).slice(0, size));
  return entries.filter((item) => picked.has(item));
}

/**
 * The plan: which manifest entries to look up, and why.
 *   { mode: "full", reason, entries }
 *   { mode: "incremental", entries, changed, canary, unchanged, baseSha }
 * `entries` is what the check looks up: the whole manifest when full; the
 * changed objects followed by the canary when incremental.
 *
 * @param {{
 *   manifest: { bucket?: string, files: Record<string, any> },
 *   incremental: boolean,
 *   originIsProduction: boolean,
 *   env: Record<string, string | undefined>,
 *   readBase?: (sha: string) => ReturnType<typeof readManifestAt>,
 *   canarySize?: number,
 * }} input
 */
export function planFramesCheck({ manifest, incremental, originIsProduction, env, readBase = (sha) => readManifestAt(sha), canarySize = CANARY_SIZE }) {
  const entries = Object.entries(manifest.files);
  const full = (/** @type {string} */ reason) => ({ mode: /** @type {const} */ ("full"), reason, entries });
  if (incremental !== true) return full("--incremental was not asked for");
  if (env.VERCEL_ENV !== "production") return full("not a production build (only a production build of this branch has a checked base)");
  if (originIsProduction !== true) return full("--origin is not production's bucket (the base was checked against production's)");
  if (env.FRAMES_CHECK_FULL === "1") return full("FRAMES_CHECK_FULL=1");
  const head = env.VERCEL_GIT_COMMIT_SHA ?? "";
  if (!GIT_SHA.test(head)) return full(`VERCEL_GIT_COMMIT_SHA ("${head}") is not a full commit SHA`);
  const baseSha = env.VERCEL_GIT_PREVIOUS_SHA ?? "";
  if (baseSha === "") {
    return full("VERCEL_GIT_PREVIOUS_SHA is empty (the branch's first deployment, or no Ignored Build Step — vercel.json ignoreCommand)");
  }
  if (!GIT_SHA.test(baseSha)) return full(`VERCEL_GIT_PREVIOUS_SHA ("${baseSha}") is not a full commit SHA`);
  let base;
  try {
    base = readBase(baseSha);
  } catch (err) {
    return full(`reading the manifest at ${baseSha.slice(0, 12)} threw (${err?.message ?? err})`);
  }
  if (!base || "error" in base || !base.manifest) return full(base?.error ?? `no manifest at ${baseSha.slice(0, 12)}`);
  if ((base.manifest.bucket ?? BUCKET) !== (manifest.bucket ?? BUCKET)) {
    return full(`the manifest at ${baseSha.slice(0, 12)} names another bucket ("${base.manifest.bucket}")`);
  }
  const before = base.manifest.files;
  const changed = entries.filter(([key, entry]) => !(Object.hasOwn(before, key) && sameObject(entry, before[key])));
  const unchanged = entries.filter(([key, entry]) => Object.hasOwn(before, key) && sameObject(entry, before[key]));
  const canary = canarySample(unchanged, head, canarySize);
  return { mode: /** @type {const} */ ("incremental"), entries: [...changed, ...canary], changed, canary, unchanged: unchanged.length, baseSha };
}
