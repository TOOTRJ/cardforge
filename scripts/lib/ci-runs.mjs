// ---------------------------------------------------------------------------
// What CI's classifier asks the GitHub API (scripts/ci-classify-change.mjs,
// owner 2026-10-16). Dependency-free: the `changes` job runs it on the
// runner's own Node with no `npm ci`, with the run's own GITHUB_TOKEN
// (`actions: read`, nothing else).
//
//   findGreenFullPrRun   a merge to main: did a pull request run of ci.yml
//                        on the merged head finish GREEN, in the FULL tier?
//                        Then main runs the `verified` tier (the cache
//                        warm-up and "Frames published") instead of the full
//                        suite again.
//   commitPassedCoverage the schedule: did a run of ci.yml on this commit
//                        already pass the coverage floors? Then the nightly
//                        run has nothing to do (`idle`).
//
// Both answer `false` / `null` on anything they cannot prove, and every API
// or network error THROWS — the classifier turns a throw into the full tier
// (a merge) or the nightly coverage run (the schedule). A "green full run"
// is read from the run's JOBS, never from the run alone: a draft or notes
// run of the same head is a green run too.
// ---------------------------------------------------------------------------

/**
 * The jobs that run only in the full tier, each of which must have
 * SUCCEEDED in the latest attempt of the run (a draft or notes run reports
 * them "skipped"). "Typecheck, lint, unit" is the gate: in the full tier it
 * is green only when typecheck, lint, the build and every unit shard were.
 * Names as ci.yml spells them (tests/unit/devops/ci-runs.test.ts holds them
 * to the workflow).
 */
export const FULL_RUN_JOBS = ["Typecheck, lint, unit", "E2E (local Supabase)", "Visual regression", "Frames published", "Preview parity"];

/** The job that holds the coverage floors (ci.yml `coverage`). */
export const COVERAGE_JOB = "Unit coverage";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/**
 * GITHUB_WORKFLOW_REF ("owner/repo/.github/workflows/ci.yml@refs/heads/main")
 * → ".github/workflows/ci.yml", or null.
 * @param {unknown} workflowRef
 */
export function workflowPathOf(workflowRef) {
  if (typeof workflowRef !== "string") return null;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml)@/.exec(workflowRef)?.[1] ?? null;
}

/**
 * A GET-only client of the REST API. Throws on any answer but 200 (one
 * retry after a 5xx, a 429 or a network error).
 * @param {{ token: string, base?: string, fetchImpl?: typeof fetch, timeoutMs?: number, sleep?: (ms: number) => Promise<unknown> }} opts
 * @returns {(path: string) => Promise<any>}
 */
export function githubApi({ token, base = "https://api.github.com", fetchImpl = fetch, timeoutMs = 15_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (typeof token !== "string" || token.length === 0) throw new Error("no token");
  const root = base.replace(/\/+$/, "");
  // https only (a loopback http origin for the tests' fake API).
  if (!/^https:\/\//.test(root) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(root)) throw new Error(`${root} is not an https URL`);
  return async (path) => {
    if (!path.startsWith("/")) throw new Error(`bad API path ${path}`);
    let last = "";
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (attempt > 1) await sleep(2000);
      let res;
      try {
        res = await fetchImpl(`${root}${path}`, {
          headers: { accept: "application/vnd.github+json", authorization: `Bearer ${token}`, "x-github-api-version": "2022-11-28" },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
        continue;
      }
      if (res.status === 200) return res.json();
      await res.body?.cancel().catch(() => {});
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    }
    throw new Error(`GET ${path}: ${last}`);
  };
}

/**
 * Is this run, with these jobs (its latest attempt's), a GREEN FULL pull
 * request run of `workflowPath` on `headSha` in `repo`?
 * @returns {{ ok: boolean, why: string }}
 */
export function greenFullRun(run, jobsPage, { headSha, repo, workflowPath }) {
  const no = (why) => ({ ok: false, why });
  if (!run || typeof run !== "object") return no("no run");
  if (run.event !== "pull_request") return no(`event ${run.event}`);
  if (run.head_sha !== headSha) return no("another head");
  if (run.status !== "completed" || run.conclusion !== "success") return no(`${run.status} / ${run.conclusion}`);
  if (typeof run.path !== "string" || run.path.replace(/@.*$/, "") !== workflowPath) return no(`workflow ${run.path}`);
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo) return no("another repository");
  const jobs = jobsPage?.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return no("no jobs");
  if (typeof jobsPage.total_count !== "number" || jobsPage.total_count > jobs.length) return no("jobs not all listed");
  const odd = jobs.find((job) => job.status !== "completed" || !["success", "skipped"].includes(job.conclusion));
  if (odd) return no(`job "${odd.name}" ${odd.status} / ${odd.conclusion}`);
  for (const name of FULL_RUN_JOBS) {
    const named = jobs.filter((job) => job.name === name);
    if (named.length === 0) return no(`no job "${name}"`);
    if (!named.every((job) => job.conclusion === "success")) return no(`job "${name}" did not run (not the full tier)`);
  }
  return { ok: true, why: `run ${run.id} (attempt ${run.run_attempt ?? 1}) is green in the full tier` };
}

function checkArgs({ repo, workflowPath, sha }) {
  if (typeof repo !== "string" || !REPO.test(repo)) throw new Error(`bad repository "${repo}"`);
  if (typeof workflowPath !== "string" || !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflowPath)) throw new Error(`bad workflow "${workflowPath}"`);
  if (typeof sha !== "string" || !SHA.test(sha)) throw new Error(`bad commit "${sha}"`);
  return workflowPath.slice(".github/workflows/".length);
}

const newestFirst = (runs) => [...runs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

/**
 * The newest GREEN FULL pull request run of the workflow on `headSha`, or
 * null. Throws on any API error.
 * @param {{ api: (path: string) => Promise<any>, repo: string, workflowPath: string, headSha: string, log?: (line: string) => void }} args
 */
export async function findGreenFullPrRun({ api, repo, workflowPath, headSha, log = () => {} }) {
  const file = checkArgs({ repo, workflowPath, sha: headSha });
  const page = await api(`/repos/${repo}/actions/workflows/${file}/runs?event=pull_request&head_sha=${headSha}&status=success&per_page=50`);
  const runs = Array.isArray(page?.workflow_runs) ? newestFirst(page.workflow_runs) : [];
  for (const run of runs.slice(0, 10)) {
    if (run?.head_sha !== headSha || !Number.isInteger(run?.id)) continue;
    const jobs = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    const verdict = greenFullRun(run, jobs, { headSha, repo, workflowPath });
    log(`run ${run.id}: ${verdict.why}`);
    if (verdict.ok) return run;
  }
  return null;
}

/**
 * Did a run of the workflow on `sha` (a push to main or an earlier nightly
 * run — never `currentRunId`) pass the coverage floors? Throws on any API
 * error.
 * @param {{ api: (path: string) => Promise<any>, repo: string, workflowPath: string, sha: string, currentRunId?: string | number, log?: (line: string) => void }} args
 */
export async function commitPassedCoverage({ api, repo, workflowPath, sha, currentRunId, log = () => {} }) {
  const file = checkArgs({ repo, workflowPath, sha });
  const page = await api(`/repos/${repo}/actions/workflows/${file}/runs?head_sha=${sha}&status=success&per_page=50`);
  const runs = Array.isArray(page?.workflow_runs) ? newestFirst(page.workflow_runs) : [];
  for (const run of runs.slice(0, 10)) {
    if (!["push", "schedule"].includes(run?.event) || run.head_sha !== sha || String(run.id) === String(currentRunId)) continue;
    if (run.conclusion !== "success" || run.repository?.full_name !== repo || String(run.path).replace(/@.*$/, "") !== workflowPath) continue;
    const jobs = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
    const covered = Array.isArray(jobs?.jobs) && jobs.jobs.some((job) => job.name === COVERAGE_JOB && job.status === "completed" && job.conclusion === "success");
    log(`run ${run.id} (${run.event}): ${covered ? "passed the coverage floors" : "held no coverage"}`);
    if (covered) return true;
  }
  return false;
}
