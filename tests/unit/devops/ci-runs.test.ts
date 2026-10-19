import { describe, expect, it } from "vitest";
import { commitPassedCoverage, COVERAGE_JOB, findGreenFullPrRun, FULL_RUN_JOBS, githubApi, greenFullRun, workflowPathOf } from "@/scripts/lib/ci-runs.mjs";

// ---------------------------------------------------------------------------
// What CI's classifier asks the GitHub API (scripts/lib/ci-runs.mjs, owner
// 2026-10-16). A merge to main skips the full suite ONLY when its pull
// request head has a run that is provably green IN THE FULL TIER; anything
// this cannot prove is "no", and an API error throws (the classifier then
// runs the full suite). The script end to end — a real merge commit, a fake
// API on loopback — is in ci-docs-only.test.ts.
// ---------------------------------------------------------------------------

const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const REPO = "TOOTRJ/cardforge";
const WORKFLOW = ".github/workflows/ci.yml";
const ctx = { headSha: HEAD, repo: REPO, workflowPath: WORKFLOW };

const run = (over: Record<string, unknown> = {}) => ({
  id: 7,
  event: "pull_request",
  head_sha: HEAD,
  status: "completed",
  conclusion: "success",
  path: WORKFLOW,
  run_attempt: 1,
  created_at: "2026-10-16T10:00:00Z",
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...over,
});
const job = (name: string, conclusion = "success", status = "completed") => ({ name, status, conclusion });
/** A full run's jobs as ci.yml names them (the matrix jobs included). */
const fullJobs = () => [
  job("Classify the change"),
  job("Typecheck, lint, build"),
  ...[1, 2, 3, 4, 5, 6].map((i) => job(`Unit tests (${i}/6)`)),
  job("Unit coverage", "skipped"),
  job("Notes checks", "skipped"),
  job("Warm the caches", "skipped"),
  job("Frames published"),
  job("E2E (local Supabase)"),
  ...[0, 1, 2].map((g) => job(`Visual regression (bake ${g}/3)`)),
  job("Visual regression"),
  job("Preview parity"),
  job("Typecheck, lint, unit"),
  job("Cancelled-run marker", "skipped"),
];
const page = (jobs: ReturnType<typeof job>[]) => ({ total_count: jobs.length, jobs });

describe("greenFullRun", () => {
  it("a completed, successful pull request run of ci.yml on the head, whose full-tier jobs all succeeded", () => {
    expect(greenFullRun(run(), page(fullJobs()), ctx)).toMatchObject({ ok: true });
    // A path GitHub writes with a ref after it.
    expect(greenFullRun(run({ path: `${WORKFLOW}@refs/pull/9/merge` }), page(fullJobs()), ctx).ok).toBe(true);
  });

  it("is NOT the draft or notes tier: there the full-tier jobs are skipped though the run is green", () => {
    for (const name of FULL_RUN_JOBS) {
      const jobs = fullJobs().map((j) => (j.name === name ? job(name, "skipped") : j));
      expect(greenFullRun(run(), page(jobs), ctx), name).toMatchObject({ ok: false });
    }
    // A draft's gate reports under another name: no "Typecheck, lint, unit" at all.
    const draft = fullJobs()
      .filter((j) => j.name !== "Typecheck, lint, unit")
      .concat(job("Draft checks (typecheck, lint, build)"));
    expect(greenFullRun(run(), page(draft), ctx).ok).toBe(false);
  });

  it("refuses a run that is not exactly that: another event, head, workflow, repository, state", () => {
    for (const over of [
      { event: "push" },
      { event: "pull_request_target" },
      { head_sha: OTHER },
      { status: "in_progress" },
      { conclusion: "failure" },
      { conclusion: "cancelled" },
      { conclusion: null },
      { path: ".github/workflows/parity-record.yml" },
      { path: undefined },
      { repository: { full_name: "someone/fork" } },
      { head_repository: { full_name: "someone/fork" } },
      { head_repository: null },
    ]) {
      expect(greenFullRun(run(over), page(fullJobs()), ctx), JSON.stringify(over)).toMatchObject({ ok: false });
    }
    expect(greenFullRun(null, page(fullJobs()), ctx).ok).toBe(false);
  });

  it("refuses jobs it cannot read whole, and any job that did not end green or skipped", () => {
    expect(greenFullRun(run(), page([]), ctx).ok).toBe(false);
    expect(greenFullRun(run(), { jobs: fullJobs() }, ctx).ok).toBe(false);
    expect(greenFullRun(run(), { total_count: 120, jobs: fullJobs() }, ctx).ok).toBe(false);
    expect(greenFullRun(run(), null, ctx).ok).toBe(false);
    for (const odd of [job("Unit tests (3/6)", "failure"), job("Unit tests (3/6)", "cancelled"), job("Unit tests (3/6)", "timed_out"), job("E2E (local Supabase)", null as unknown as string, "in_progress")]) {
      expect(greenFullRun(run(), page([...fullJobs(), odd]), ctx).ok, JSON.stringify(odd)).toBe(false);
    }
  });
});

describe("findGreenFullPrRun", () => {
  /** A fake API: path → body; records every path asked. */
  function fakeApi(routes: Record<string, unknown>) {
    const asked: string[] = [];
    const api = async (path: string) => {
      asked.push(path);
      if (!(path in routes)) throw new Error(`GET ${path}: HTTP 404`);
      const body = routes[path];
      if (body instanceof Error) throw body;
      return body;
    };
    return { api, asked };
  }
  const RUNS = `/repos/${REPO}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${HEAD}&status=success&per_page=50`;
  const jobsOf = (id: number) => `/repos/${REPO}/actions/runs/${id}/jobs?filter=latest&per_page=100`;

  it("asks for the head's successful pull request runs of this workflow, newest first, and returns the first that is green in the full tier", async () => {
    const draftJobs = fullJobs().map((j) => (j.name === "E2E (local Supabase)" ? job(j.name, "skipped") : j));
    const { api, asked } = fakeApi({
      [RUNS]: { workflow_runs: [run({ id: 1, created_at: "2026-10-16T08:00:00Z" }), run({ id: 2, created_at: "2026-10-16T09:00:00Z" })] },
      [jobsOf(2)]: page(draftJobs),
      [jobsOf(1)]: page(fullJobs()),
    });
    const lines: string[] = [];
    expect(await findGreenFullPrRun({ api, repo: REPO, workflowPath: WORKFLOW, headSha: HEAD, log: (l: string) => lines.push(l) })).toMatchObject({ id: 1 });
    expect(asked).toEqual([RUNS, jobsOf(2), jobsOf(1)]);
    expect(lines.join("\n")).toMatch(/run 2: job "E2E \(local Supabase\)" did not run/);
  });

  it("null when no run qualifies; a listed run of another head is never read", async () => {
    const { api, asked } = fakeApi({ [RUNS]: { workflow_runs: [run({ id: 3, head_sha: OTHER })] } });
    expect(await findGreenFullPrRun({ api, repo: REPO, workflowPath: WORKFLOW, headSha: HEAD })).toBeNull();
    expect(asked).toEqual([RUNS]);
    for (const body of [{ workflow_runs: [] }, {}, null]) {
      expect(await findGreenFullPrRun({ api: fakeApi({ [RUNS]: body }).api, repo: REPO, workflowPath: WORKFLOW, headSha: HEAD })).toBeNull();
    }
  });

  it("an API error THROWS (the classifier runs the full suite) — the runs list or a run's jobs", async () => {
    await expect(findGreenFullPrRun({ api: fakeApi({}).api, repo: REPO, workflowPath: WORKFLOW, headSha: HEAD })).rejects.toThrow(/404/);
    const { api } = fakeApi({ [RUNS]: { workflow_runs: [run()] }, [jobsOf(7)]: new Error("GET jobs: HTTP 502") });
    await expect(findGreenFullPrRun({ api, repo: REPO, workflowPath: WORKFLOW, headSha: HEAD })).rejects.toThrow(/502/);
  });

  it("refuses arguments that are not a repository, a workflow file and a full sha — before any request", async () => {
    const { api, asked } = fakeApi({});
    for (const args of [
      { repo: "TOOTRJ/cardforge/../x", workflowPath: WORKFLOW, headSha: HEAD },
      { repo: REPO, workflowPath: "ci.yml", headSha: HEAD },
      { repo: REPO, workflowPath: WORKFLOW, headSha: "abc123" },
      { repo: REPO, workflowPath: WORKFLOW, headSha: `${HEAD}&event=push` },
    ]) {
      await expect(findGreenFullPrRun({ api, ...args }), JSON.stringify(args)).rejects.toThrow(/bad/);
    }
    expect(asked).toEqual([]);
  });
});

describe("commitPassedCoverage", () => {
  const SHA = HEAD;
  const RUNS = `/repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${SHA}&status=success&per_page=50`;
  const jobsOf = (id: number) => `/repos/${REPO}/actions/runs/${id}/jobs?filter=latest&per_page=100`;
  const api = (routes: Record<string, unknown>) => async (path: string) => {
    if (!(path in routes)) throw new Error(`GET ${path}: HTTP 404`);
    return routes[path];
  };
  const args = (routes: Record<string, unknown>) => ({ api: api(routes), repo: REPO, workflowPath: WORKFLOW, sha: SHA, currentRunId: "99" });

  it("true when ANOTHER push or schedule run on the commit passed the coverage job", async () => {
    for (const event of ["push", "schedule"]) {
      expect(await commitPassedCoverage(args({ [RUNS]: { workflow_runs: [run({ id: 5, event })] }, [jobsOf(5)]: page([job(COVERAGE_JOB)]) })), event).toBe(true);
    }
  });

  it("false for this very run, a pull request run, a run whose coverage job did not succeed, or none", async () => {
    expect(await commitPassedCoverage(args({ [RUNS]: { workflow_runs: [run({ id: 99, event: "schedule" })] }, [jobsOf(99)]: page([job(COVERAGE_JOB)]) }))).toBe(false);
    expect(await commitPassedCoverage(args({ [RUNS]: { workflow_runs: [run({ id: 5 })] }, [jobsOf(5)]: page([job(COVERAGE_JOB)]) }))).toBe(false);
    for (const conclusion of ["skipped", "failure"]) {
      expect(await commitPassedCoverage(args({ [RUNS]: { workflow_runs: [run({ id: 5, event: "push" })] }, [jobsOf(5)]: page([job(COVERAGE_JOB, conclusion)]) })), conclusion).toBe(false);
    }
    expect(await commitPassedCoverage(args({ [RUNS]: { workflow_runs: [] } }))).toBe(false);
    expect(await commitPassedCoverage(args({ [RUNS]: { workflow_runs: [run({ id: 5, event: "push", head_sha: OTHER })] } }))).toBe(false);
  });

  it("an API error throws (the classifier then runs the nightly coverage)", async () => {
    await expect(commitPassedCoverage(args({}))).rejects.toThrow(/404/);
  });
});

describe("githubApi", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const noSleep = async () => {};

  it("GETs base + path with the token as a bearer, and returns the JSON", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const api = githubApi({
      token: "tkn",
      base: "https://api.github.com/",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return ok({ a: 1 });
      }) as typeof fetch,
    });
    expect(await api("/repos/o/r")).toEqual({ a: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/repos/o/r");
    expect((calls[0].init?.headers as Record<string, string>).authorization).toBe("Bearer tkn");
    expect(calls[0].init?.method ?? "GET").toBe("GET");
  });

  it("retries ONCE after a 5xx, a 429 or a network error; never after a 4xx; then throws", async () => {
    for (const [first, second, want] of [
      [500, 200, "ok"],
      [429, 200, "ok"],
      ["network", 200, "ok"],
      [502, 503, "throw"],
      [404, 200, "throw"],
      [401, 200, "throw"],
      [403, 200, "throw"],
    ] as const) {
      const answers = [first, second];
      let n = 0;
      const api = githubApi({
        token: "t",
        sleep: noSleep,
        fetchImpl: (async () => {
          const a = answers[n++];
          if (a === "network") throw new TypeError("fetch failed");
          return a === 200 ? ok({ fine: true }) : new Response("{}", { status: a });
        }) as typeof fetch,
      });
      const label = `${first} then ${second}`;
      if (want === "ok") expect(await api("/x"), label).toEqual({ fine: true });
      else await expect(api("/x"), label).rejects.toThrow(/GET \/x/);
      expect(n, label).toBe(typeof first === "number" && first < 500 && first !== 429 ? 1 : 2);
    }
  });

  it("refuses no token, a non-https base (loopback http is the tests' fake) and a path that is not absolute", async () => {
    expect(() => githubApi({ token: "" })).toThrow(/token/);
    expect(() => githubApi({ token: "t", base: "http://api.github.com" })).toThrow(/https/);
    expect(() => githubApi({ token: "t", base: "http://127.0.0.1.evil.test" })).toThrow(/https/);
    expect(() => githubApi({ token: "t", base: "http://127.0.0.1:8080" })).not.toThrow();
    await expect(githubApi({ token: "t", fetchImpl: (async () => ok({})) as typeof fetch })("repos/o/r")).rejects.toThrow(/bad API path/);
  });
});

describe("workflowPathOf", () => {
  it("reads GITHUB_WORKFLOW_REF's workflow file, or null", () => {
    expect(workflowPathOf("TOOTRJ/cardforge/.github/workflows/ci.yml@refs/heads/main")).toBe(".github/workflows/ci.yml");
    expect(workflowPathOf("TOOTRJ/cardforge/.github/workflows/ci.yml@refs/pull/580/merge")).toBe(".github/workflows/ci.yml");
    for (const ref of ["", "ci.yml", ".github/workflows/ci.yml", "o/r/.github/workflows/ci.yml", "o/r/.github/workflows/../x.yml@main", undefined, null, 5]) {
      expect(workflowPathOf(ref), String(ref)).toBeNull();
    }
  });
});
