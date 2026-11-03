// ---------------------------------------------------------------------------
// Vercel's Ignored Build Step (vercel.json `ignoreCommand` →
// scripts/vercel-ignore-build.mjs, which only calls `run` and exits with its
// answer; owner 2026-11-02, docs/research/vercel-build-cost-2026-11.md §3.2):
// SKIP a build whose change is notes only, BUILD everything else.
//
// Vercel's contract: exit 0 = skip (the deployment ends CANCELED), exit 1 =
// build. Vercel runs this BEFORE `npm install`, so it is dependency-free:
// node built-ins and git only. The notes allow-list is CI's own
// (`isNotesFile`, scripts/lib/ci-docs-only.mjs) — never a second copy.
//
// It FAILS SAFE: it skips only when it can PROVE that every file between
// the last successful deployment of this branch (VERCEL_GIT_PREVIOUS_SHA)
// and this commit (VERCEL_GIT_COMMIT_SHA) is a notes file. Anything else
// builds:
//   - either SHA missing or not a full 40-hex SHA (a branch's first deploy
//     has no previous SHA);
//   - the two SHAs are the same (a Redeploy of what is deployed — an env
//     change, a Supabase branch redeploy: the build IS the point);
//   - a commit missing from Vercel's shallow clone that `git fetch` could
//     not bring in, a git error or timeout, an empty diff;
//   - any file off the allow-list: code, `.mdx`, `supabase/**` (README
//     included), `.github/**`, `vercel.json`, this script…;
//   - an exception, or a module failing to load (node exits 1).
// Renames are read as a delete AND an add (`--no-renames`), so code moved
// into docs/ is still seen as code leaving.
//
// "Last successful" passes over failed and skipped (CANCELED) deployments:
// a code change whose build failed is still in the next diff, so the next
// push builds it, and two notes-only pushes in a row are read together. Production builds of anything off the allow-list are never
// skipped. A skipped production build leaves the live deployment on the
// previous commit — the same app, since only notes changed.
//
// Drafts are NOT skipped here (phase 2 of the research doc, not approved).
// tests/unit/devops/vercel-ignore-build.test.ts pins "any doubt builds".
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { isNotesFile } from "./ci-docs-only.mjs";

export const SKIP = 0;
export const BUILD = 1;

const FULL_SHA = /^[0-9a-f]{40}$/;
/** How many changed files the log line names. */
const LOGGED_FILES = 20;

/**
 * @typedef {{ ok: boolean, stdout: string, stderr: string }} GitResult
 * @typedef {(args: string[], options?: { timeoutMs?: number }) => GitResult} Git
 */

/** @type {Git} */
export function runGit(args, { timeoutMs = 30_000 } = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: result.error ? String(result.error.message) : typeof result.stderr === "string" ? result.stderr : "",
  };
}

/**
 * Is the commit in this clone? If not, fetch it (Vercel's clone is shallow)
 * and ask again.
 * @param {Git} git
 * @param {string} sha
 */
function ensureCommit(git, sha) {
  const has = () => git(["cat-file", "-e", `${sha}^{commit}`]).ok;
  if (has()) return true;
  const fetched = git(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", sha], { timeoutMs: 60_000 });
  return fetched.ok && has();
}

/**
 * The verdict for one build. Never throws on a git failure (it builds);
 * `run` catches anything else.
 * @param {{ env: Record<string, string | undefined>, git: Git }} input
 * @returns {{ skip: boolean, reason: string, files?: string[] }}
 */
export function decide({ env, git }) {
  const build = (/** @type {string} */ reason, files) => ({ skip: false, reason, ...(files ? { files } : {}) });
  const previous = env.VERCEL_GIT_PREVIOUS_SHA ?? "";
  const current = env.VERCEL_GIT_COMMIT_SHA ?? "";

  if (!previous) return build("no VERCEL_GIT_PREVIOUS_SHA (the branch's first deployment, or Vercel did not say)");
  if (!current) return build("no VERCEL_GIT_COMMIT_SHA");
  if (!FULL_SHA.test(previous)) return build(`VERCEL_GIT_PREVIOUS_SHA "${previous}" is not a full SHA`);
  if (!FULL_SHA.test(current)) return build(`VERCEL_GIT_COMMIT_SHA "${current}" is not a full SHA`);
  if (previous === current) return build("the previous deployment is this very commit (a redeploy)");

  if (!ensureCommit(git, current)) return build(`this commit ${current} is not in the clone and could not be fetched`);
  if (!ensureCommit(git, previous)) return build(`the previous commit ${previous} is not in the clone and could not be fetched`);

  const diff = git(["diff", "--name-only", "--no-renames", "-z", previous, current]);
  if (!diff.ok) return build(`git diff failed: ${diff.stderr.trim().split("\n")[0] ?? ""}`);
  const files = diff.stdout.split("\0").filter((file) => file.length > 0);
  if (files.length === 0) return build("no changed file between the two commits");

  const code = files.filter((file) => !isNotesFile(file));
  if (code.length > 0) return build(`${code.length} of ${files.length} changed file(s) are not notes`, code);
  return { skip: true, reason: `all ${files.length} changed file(s) are notes`, files };
}

/**
 * The exit code for one build, with its log line. Anything thrown builds.
 * @param {{ env: Record<string, string | undefined>, git: Git, log?: (line: string) => void }} input
 * @returns {0 | 1}
 */
export function run({ env, git, log = (line) => console.log(line) }) {
  let verdict;
  try {
    verdict = decide({ env, git });
  } catch (error) {
    log(`[vercel-ignore-build] BUILD — the check threw (${error instanceof Error ? error.message : String(error)})`);
    return BUILD;
  }
  if (verdict?.skip !== true) {
    log(`[vercel-ignore-build] BUILD — ${verdict?.reason ?? "no verdict"}`);
    if (verdict?.files?.length) log(`  not notes: ${verdict.files.slice(0, LOGGED_FILES).join(", ")}${verdict.files.length > LOGGED_FILES ? ", …" : ""}`);
    return BUILD;
  }
  log(`[vercel-ignore-build] SKIP — ${verdict.reason} (${env.VERCEL_GIT_PREVIOUS_SHA?.slice(0, 7)}..${env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7)})`);
  log(`  notes: ${verdict.files.slice(0, LOGGED_FILES).join(", ")}${verdict.files.length > LOGGED_FILES ? ", …" : ""}`);
  return SKIP;
}
