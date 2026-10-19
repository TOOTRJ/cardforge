import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyChange, coverageFor, DOCS_READING_TESTS, isNotesFile, NOTES_ALLOW_LIST, TIERS, tierOutputs } from "@/scripts/lib/ci-docs-only.mjs";
import { FULL_RUN_JOBS } from "@/scripts/lib/ci-runs.mjs";

// ---------------------------------------------------------------------------
// CI's tiers (.github/workflows/ci.yml, owner 2026-10-13 / 2026-10-16:
// Actions minutes are billed once the repo is private). The `changes` job
// puts every run in one: full (everything), notes (a change of notes only:
// the notes tests), draft (a draft pull request: typecheck, lint, build +
// the notes tests), verified (a merge to main of the tree a GREEN FULL pull
// request run already tested: only the cache warm-up and "Frames
// published"), nightly / idle (the schedule's coverage run). Coverage is
// recorded off a pull request only. What must hold, and would fail SILENTLY
// if it stopped holding:
//
//   - "notes" is an allow-list, and nothing the app or a build reads is on it;
//   - anything unclear is the FULL tier (one code file on a ready pull
//     request, no file, a failed diff, an unknown event, a main that moved,
//     no green full pull request run found, an API that failed);
//   - every unit test that READS a notes file still runs on a notes-only
//     pull request (`npm run test:docs`) — the list cannot rot;
//   - the required check names are unchanged, the gate accepts "skipped"
//     only where the classifier put it, and a draft never leaves a green
//     check under the gate's required name.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const ci = read(".github/workflows/ci.yml");
/** The workflow without its comment lines: what a job does NOT do is prose. */
const yaml = ci
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

function jobOf(id: string): string {
  const body = new RegExp(`\\n  ${id}:\\n([\\s\\S]*?)(?=\\n  [a-z0-9-]+:\\n|$)`).exec(yaml)?.[1];
  if (!body) throw new Error(`ci.yml has no job "${id}"`);
  return body;
}

const JOB_IDS = [...yaml.slice(yaml.indexOf("\njobs:\n")).matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => m[1]);

/** The workflow's jobs by the classifier output that switches them. */
const GROUP_JOBS = {
  static: ["static"],
  unit: ["unit"],
  coverage: ["coverage"],
  heavy: ["e2e", "visual-bake", "visual", "parity"],
  frames: ["frames"],
  warm: ["warm"],
  docs: ["docs"],
};

describe("the notes allow-list", () => {
  it("takes the notes the owner named", () => {
    for (const file of [
      "TODO.md",
      "CLAUDE.md",
      "README.md",
      "BILLING_SETUP.md",
      "AGENTS.md",
      "LICENSE.md",
      "docs/FRAMES.md",
      "docs/ENVIRONMENTS.md",
      "docs/archive/11_PREMIUM_POLISH/00_README.md",
      ".claude/skills/pipglyph-brand/SKILL.md",
      ".claude/skills/pipglyph-brand/references/palette.md",
      "tests/README.md",
      "tests/parity/README.md",
    ]) {
      expect(isNotesFile(file), file).toBe(true);
    }
  });

  it("refuses everything that ships, is read by code, or starts another system", () => {
    for (const file of [
      // Pages of the site.
      "content/articles/how-to-make-a-custom-mtg-card.mdx",
      "docs/guide.mdx",
      "notes.mdx",
      // Supabase's integration branches on ANY change under supabase/.
      "supabase/migrations/README.md",
      "supabase/README.md",
      // The workflows themselves.
      ".github/workflows/ci.yml",
      ".github/pull_request_template.md",
      // Shipped or read by code.
      "public/brand/BRAND.txt",
      "public/notes.md",
      "app/fonts/geist/OFL.txt",
      "app/(marketing)/about/copy.md",
      "lib/notes.md",
      "components/README.md",
      "scripts/README.md",
      "types/README.md",
      // Tests: only the two READMEs by name.
      "tests/unit/render/fixtures/google-noto-sans/README.md",
      "tests/e2e/README.md",
      "tests/unit/devops/ci-docs-only.test.ts",
      // Not Markdown, or not `.md` as written.
      "docs/mse-profile-report.json",
      "docs/diagram.png",
      "LICENSE",
      "README",
      "README.MD",
      "notes.txt",
      "TODO.md.bak",
      ".claude/launch.json",
      ".claude/settings.json",
      "package.json",
      "lib/cards/typography.ts",
      // Not plain relative paths.
      "",
      "/TODO.md",
      "../TODO.md",
      "docs/../lib/x.md",
      "docs//x.md",
      "./TODO.md",
      "docs\\FRAMES.md",
      "TODO.md\nlib/x.ts",
    ]) {
      expect(isNotesFile(file), JSON.stringify(file)).toBe(false);
    }
    expect(isNotesFile(undefined)).toBe(false);
  });

  it("is five anchored patterns — a new one is a decision, written here", () => {
    expect(NOTES_ALLOW_LIST.map(String)).toEqual([
      String(/^[^/]+\.md$/),
      String(/^docs\/(?:[^/]+\/)*[^/]+\.md$/),
      String(/^\.claude\/(?:[^/]+\/)*[^/]+\.md$/),
      String(/^tests\/README\.md$/),
      String(/^tests\/parity\/README\.md$/),
    ]);
    for (const pattern of NOTES_ALLOW_LIST) {
      expect(pattern.source.startsWith("^") && pattern.source.endsWith("\\.md$"), pattern.source).toBe(true);
      expect(pattern.flags).toBe("");
    }
  });

  it("every Markdown file in the repo today is where this test expects it", () => {
    // The files the repo tracks, classified — a moved or new Markdown file
    // shows up here as a decision to make, not as a silent change of CI.
    const tracked = execFileSync("git", ["ls-files", "-z", "--", "*.md", "*.mdx"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(30);
    const code = tracked.filter((file) => !isNotesFile(file));
    expect(code.filter((file) => !file.startsWith("content/articles/")).sort()).toEqual([
      "supabase/migrations/README.md",
      "tests/unit/render/fixtures/google-noto-sans/README.md",
    ]);
    expect(code.filter((file) => file.startsWith("content/articles/")).every((file) => file.endsWith(".mdx"))).toBe(true);
  });
});

describe("the tier", () => {
  const tier = (input: Parameters<typeof classifyChange>[0]) => classifyChange(input).tier;
  const pr = (files: string[] | null, draft = false) => tier({ event: "pull_request", files, draft });
  const push = (files: string[] | null, treeIsPrHead = false, prRunGreen: unknown = true) => tier({ event: "push", files, treeIsPrHead, prRunGreen });

  it("what each tier runs", () => {
    expect(TIERS).toEqual({
      full: { static: true, unit: true, heavy: true, frames: true, warm: false, docs: false },
      verified: { static: false, unit: false, heavy: false, frames: true, warm: true, docs: false },
      nightly: { static: false, unit: true, heavy: false, frames: false, warm: false, docs: false },
      idle: { static: false, unit: false, heavy: false, frames: false, warm: false, docs: false },
      draft: { static: true, unit: false, heavy: false, frames: false, warm: false, docs: true },
      notes: { static: false, unit: false, heavy: false, frames: false, warm: false, docs: true },
    });
  });

  it("coverage: wherever the shards run, except on a pull request (owner 2026-10-16)", () => {
    expect(coverageFor("full", "pull_request")).toBe(false);
    expect(coverageFor("full", "push")).toBe(true);
    expect(coverageFor("nightly", "schedule")).toBe(true);
    // A run nobody expected covers: the floors are the safe side off a PR.
    for (const event of ["workflow_dispatch", "", undefined]) expect(coverageFor("full", event), String(event)).toBe(true);
    // No shard, no coverage.
    for (const t of ["verified", "idle", "draft", "notes", "light", "", "FULL"]) {
      for (const event of ["push", "schedule", "pull_request"]) expect(coverageFor(t, event), `${t} ${event}`).toBe(false);
    }
    expect(tierOutputs("full", "pull_request")).toEqual({
      tier: "full",
      static: "true",
      unit: "true",
      heavy: "true",
      frames: "true",
      warm: "false",
      docs: "false",
      coverage: "false",
    });
    expect(tierOutputs("full", "push").coverage).toBe("true");
    expect(() => tierOutputs("light", "push")).toThrow(/unknown tier/);
  });

  it("a pull request is notes when EVERY changed file is notes — draft or ready", () => {
    expect(pr(["TODO.md"])).toBe("notes");
    expect(pr(["TODO.md", "CLAUDE.md", "docs/FRAMES.md", "tests/README.md"])).toBe("notes");
    expect(pr(["TODO.md"], true)).toBe("notes");
  });

  it("a READY pull request with one file that is not notes runs everything", () => {
    expect(pr(["TODO.md", "lib/ids.ts"])).toBe("full");
    expect(pr(["docs/FRAMES.md", "supabase/migrations/README.md"])).toBe("full");
    expect(pr(["TODO.md", ".github/workflows/ci.yml"])).toBe("full");
    expect(pr(["content/articles/a.mdx"])).toBe("full");
    expect(classifyChange({ event: "pull_request", files: ["TODO.md", "lib/ids.ts"], draft: false }).code).toEqual(["lib/ids.ts"]);
  });

  it("a DRAFT pull request with code runs the draft tier — only for the boolean true", () => {
    expect(pr(["lib/ids.ts"], true)).toBe("draft");
    expect(pr(["TODO.md", "supabase/migrations/0001_x.sql"], true)).toBe("draft");
    for (const draft of [false, undefined, null, "true", 1, "false"]) {
      expect(tier({ event: "pull_request", files: ["lib/ids.ts"], draft }), String(draft)).toBe("full");
    }
    // The verified tier is main's alone.
    expect(tier({ event: "pull_request", files: ["lib/ids.ts"], draft: false, treeIsPrHead: true, prRunGreen: true })).toBe("full");
  });

  it("a merge to main: notes; verified only for the pull request head's own tree WITH a green full run; else everything", () => {
    expect(push(["TODO.md"])).toBe("notes");
    expect(push(["TODO.md"], true)).toBe("notes");
    expect(push(["lib/ids.ts"], true)).toBe("verified");
    expect(push(["lib/ids.ts", "TODO.md", "supabase/migrations/0001_x.sql"], true)).toBe("verified");
    // The frame manifest no longer forces a full run: the verified tier
    // warms the caches and runs "Frames published" itself.
    expect(push(["lib/ids.ts", "lib/frames/frame-manifest.json"], true)).toBe("verified");
    // main moved under the pull request: never tested.
    expect(push(["lib/ids.ts"], false)).toBe("full");
    expect(push(["lib/ids.ts"], false, true)).toBe("full");
    // No green full run found, or the lookup failed: only the boolean true counts.
    for (const green of [false, undefined, null, "true", 1]) {
      expect(tier({ event: "push", files: ["lib/ids.ts"], treeIsPrHead: true, prRunGreen: green }), String(green)).toBe("full");
    }
    for (const same of [undefined, null, "true", 1]) {
      expect(tier({ event: "push", files: ["lib/ids.ts"], treeIsPrHead: same, prRunGreen: true }), String(same)).toBe("full");
    }
    // A draft flag means nothing on a push.
    expect(tier({ event: "push", files: ["lib/ids.ts"], draft: true })).toBe("full");
  });

  it("the schedule: the nightly coverage run, idle only when this commit already passed the floors", () => {
    expect(tier({ event: "schedule" })).toBe("nightly");
    expect(tier({ event: "schedule", files: null, treeIsPrHead: true, prRunGreen: true })).toBe("nightly");
    expect(tier({ event: "schedule", alreadyCovered: true })).toBe("idle");
    for (const covered of [false, undefined, null, "true", 1]) {
      expect(tier({ event: "schedule", alreadyCovered: covered }), String(covered)).toBe("nightly");
    }
    // alreadyCovered means nothing elsewhere.
    expect(tier({ event: "push", files: ["lib/ids.ts"], alreadyCovered: true })).toBe("full");
  });

  it("no file, an unreadable diff and any other event run everything", () => {
    for (const event of ["pull_request", "push"]) {
      expect(tier({ event, files: [], draft: true, treeIsPrHead: true }), event).toBe("full");
      expect(tier({ event, files: null, draft: true, treeIsPrHead: true }), event).toBe("full");
      expect(tier({ event, files: "TODO.md" as unknown as string[], draft: true, treeIsPrHead: true }), event).toBe("full");
    }
    for (const event of ["workflow_dispatch", "merge_group", "pull_request_target", "workflow_run", "Schedule", "", undefined]) {
      expect(tier({ event, files: ["TODO.md"], draft: true, treeIsPrHead: true, prRunGreen: true, alreadyCovered: true }), String(event)).toBe("full");
    }
  });

  it("every verdict says why", () => {
    for (const input of [
      { event: "pull_request", files: ["TODO.md"] },
      { event: "pull_request", files: ["lib/a.ts"], draft: true },
      { event: "pull_request", files: ["lib/a.ts"] },
      { event: "push", files: ["lib/a.ts"], treeIsPrHead: true, prRunGreen: true },
      { event: "push", files: ["lib/a.ts"], treeIsPrHead: true },
      { event: "push", files: ["lib/a.ts"] },
      { event: "push", files: null },
      { event: "schedule" },
      { event: "schedule", alreadyCovered: true },
    ]) {
      expect(classifyChange(input).reason.length).toBeGreaterThan(20);
    }
  });
});

// The script as CI runs it: a real repository, a real merge commit — and, on
// main, a fake GitHub API on loopback for the lookup (never the real one).
// Each run is a Node process and a few git commands; a failing API is asked
// twice, two seconds apart (the script's one retry).
describe("scripts/ci-classify-change.mjs", { timeout: 60_000 }, () => {
  const tmp: string[] = [];
  const servers: Server[] = [];
  afterAll(() => {
    for (const dir of tmp) rmSync(dir, { recursive: true, force: true });
    for (const server of servers) server.close();
  });

  const out = (tier: string, on: Record<string, boolean>, coverage: boolean) =>
    `tier=${tier}\n${["static", "unit", "heavy", "frames", "warm", "docs"].map((g) => `${g}=${on[g] ? "true" : "false"}`).join("\n")}\ncoverage=${coverage}\n`;
  const FULL_PR = out("full", { static: true, unit: true, heavy: true, frames: true }, false);
  const FULL_MAIN = out("full", { static: true, unit: true, heavy: true, frames: true }, true);
  const VERIFIED = out("verified", { frames: true, warm: true }, false);
  const DRAFT = out("draft", { static: true, docs: true }, false);
  const NOTES = out("notes", { docs: true }, false);
  const NIGHTLY = out("nightly", { unit: true }, true);
  const IDLE = out("idle", {}, false);

  it("the expected outputs are the library's own", () => {
    expect(FULL_PR).toBe(`${Object.entries(tierOutputs("full", "pull_request")).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
    expect(VERIFIED).toBe(`${Object.entries(tierOutputs("verified", "push")).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
    expect(NIGHTLY).toBe(`${Object.entries(tierOutputs("nightly", "schedule")).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
  });

  type Git = (...args: string[]) => void;

  /**
   * main ← a merge of branch `pr`. `mainMoves`: a commit lands on main after
   * the branch was cut (the branch does NOT hold all of main). `merge:
   * false` leaves HEAD on the branch's own commit.
   */
  function repo(change: (dir: string, git: Git) => void, opts: { merge?: boolean; mainMoves?: boolean } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "ci-classify-"));
    tmp.push(dir);
    const git: Git = (...args) => {
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
    };
    git("init", "-q", "-b", "main");
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    put("TODO.md", "one\n");
    put("docs/FRAMES.md", "frames\n");
    put("lib/code.ts", "export const a = 1;\n");
    put("lib/other.ts", "export const b = 1;\n");
    put("lib/frames/frame-manifest.json", "{}\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "pr");
    change(dir, git);
    git("add", "-A");
    git("commit", "-q", "-m", "change", "--allow-empty");
    if (opts.mainMoves) {
      git("checkout", "-q", "main");
      put("lib/other.ts", "export const b = 2;\n");
      git("add", ".");
      git("commit", "-q", "-m", "main moves");
      git("checkout", "-q", "pr");
    }
    if (opts.merge !== false) {
      git("checkout", "-q", "main");
      git("merge", "-q", "--no-ff", "-m", "merge", "pr");
    }
    return dir;
  }

  const rev = (dir: string, ref: string) => execFileSync("git", ["rev-parse", ref], { cwd: dir, encoding: "utf8" }).trim();

  /** No token, no API: whatever the machine running the tests has set. */
  const NO_API = { GH_TOKEN: "", GITHUB_REPOSITORY: "", GITHUB_WORKFLOW_REF: "", GITHUB_API_URL: "", GITHUB_RUN_ID: "" };

  function envFor(dir: string, event: string | undefined, env: Record<string, string>) {
    const outFile = join(dir, ".out");
    writeFileSync(outFile, "");
    return {
      outFile,
      env: { ...process.env, ...NO_API, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: "", GITHUB_EVENT_NAME: event ?? "", PR_DRAFT: "", GIT_CEILING_DIRECTORIES: dirname(dir), ...env },
    };
  }

  function run(dir: string, event: string | undefined, env: Record<string, string> = {}) {
    const { outFile, env: fullEnv } = envFor(dir, event, env);
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci-classify-change.mjs")], { cwd: dir, env: fullEnv, encoding: "utf8" });
    return { status: r.status, output: readFileSync(outFile, "utf8"), stdout: r.stdout };
  }

  /** The same, without blocking this process (the fake API answers from it). */
  function runAsync(dir: string, event: string, env: Record<string, string>): Promise<{ status: number | null; output: string; stdout: string }> {
    const { outFile, env: fullEnv } = envFor(dir, event, env);
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(ROOT, "scripts/ci-classify-change.mjs")], { cwd: dir, env: fullEnv });
      let stdout = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, output: readFileSync(outFile, "utf8"), stdout }));
    });
  }

  type Mode = "green" | "draft-run" | "red-job" | "none" | "500" | "404" | "covered" | "covered-by-this-run";

  /** A fake GitHub API. Its runs carry whatever head_sha was asked for. */
  async function fakeApi(mode: Mode) {
    const requests: { path: string; auth: string | undefined }[] = [];
    const runOf = (sha: string, event: string) => ({
      id: mode === "covered-by-this-run" ? 999 : 4242,
      event,
      head_sha: sha,
      status: "completed",
      conclusion: "success",
      path: ".github/workflows/ci.yml",
      run_attempt: 1,
      created_at: "2026-10-16T00:00:00Z",
      html_url: "https://github.test/run/4242",
      repository: { full_name: "o/r" },
      head_repository: { full_name: "o/r" },
    });
    const greenJobs = [...FULL_RUN_JOBS, "Typecheck, lint, build", "Unit tests (1/6)", "Unit tests (2/6)"].map((name) => ({ name, status: "completed", conclusion: "success" }));
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://x");
      requests.push({ path: url.pathname + url.search, auth: req.headers.authorization });
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (mode === "500") return json(500, { message: "boom" });
      if (mode === "404") return json(404, { message: "Not Found" });
      if (url.pathname === "/repos/o/r/actions/workflows/ci.yml/runs") {
        const sha = url.searchParams.get("head_sha") ?? "";
        if (mode === "none") return json(200, { total_count: 0, workflow_runs: [] });
        const event = mode === "covered" || mode === "covered-by-this-run" ? "push" : "pull_request";
        return json(200, { total_count: 1, workflow_runs: [runOf(sha, event)] });
      }
      if (/^\/repos\/o\/r\/actions\/runs\/\d+\/jobs$/.test(url.pathname)) {
        let jobs = greenJobs;
        if (mode === "draft-run") jobs = greenJobs.map((job) => (["E2E (local Supabase)", "Visual regression", "Preview parity"].includes(job.name) ? { ...job, conclusion: "skipped" } : job));
        if (mode === "red-job") jobs = [...greenJobs, { name: "Unit tests (3/6)", status: "completed", conclusion: "failure" }];
        if (mode === "covered" || mode === "covered-by-this-run") jobs = [{ name: "Unit coverage", status: "completed", conclusion: "success" }];
        return json(200, { total_count: jobs.length, jobs });
      }
      return json(404, { message: "Not Found" });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const { port } = server.address() as AddressInfo;
    const env = {
      GH_TOKEN: "test-token",
      GITHUB_REPOSITORY: "o/r",
      GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ci.yml@refs/heads/main",
      GITHUB_API_URL: `http://127.0.0.1:${port}`,
      GITHUB_RUN_ID: "999",
    };
    return { env, requests };
  }

  const code = (d: string) => writeFileSync(join(d, "lib/code.ts"), "export const a = 2;\n");
  const notes = (d: string) => {
    writeFileSync(join(d, "TODO.md"), "two\n");
    writeFileSync(join(d, "docs/FRAMES.md"), "frames 2\n");
  };

  it("a pull request that changes notes only → notes, draft or not", () => {
    const dir = repo(notes);
    expect(run(dir, "pull_request")).toMatchObject({ status: 0, output: NOTES });
    expect(run(dir, "pull_request", { PR_DRAFT: "true" }).output).toBe(NOTES);
  });

  it("a pull request with code → full (no coverage) when ready, draft when PR_DRAFT is exactly true; the tier and the file are named", () => {
    const dir = repo((d) => {
      notes(d);
      code(d);
    });
    const ready = run(dir, "pull_request", { PR_DRAFT: "false" });
    expect(ready).toMatchObject({ status: 0, output: FULL_PR });
    expect(ready.stdout).toContain("**CI tier: full**");
    expect(ready.stdout).toContain("lib/code.ts");
    expect(run(dir, "pull_request").output).toBe(FULL_PR);
    expect(run(dir, "pull_request", { PR_DRAFT: "TRUE" }).output).toBe(FULL_PR);
    const draft = run(dir, "pull_request", { PR_DRAFT: "true" });
    expect(draft.output).toBe(DRAFT);
    expect(draft.stdout).toContain("**CI tier: draft**");
  });

  it("a pull request never asks the API, even with a token", async () => {
    const api = await fakeApi("green");
    const dir = repo(code);
    expect((await runAsync(dir, "pull_request", api.env)).output).toBe(FULL_PR);
    expect(api.requests).toEqual([]);
  });

  it("a code file RENAMED to a notes name, and a deleted code file → full", () => {
    const renamed = repo((d) => {
      writeFileSync(join(d, "NOTES.md"), readFileSync(join(d, "lib/code.ts")));
      rmSync(join(d, "lib/code.ts"));
    });
    expect(run(renamed, "pull_request").output).toBe(FULL_PR);
    expect(run(repo((d) => rmSync(join(d, "lib/code.ts"))), "pull_request").output).toBe(FULL_PR);
  });

  it("a merge to main of notes only → notes", () => {
    expect(run(repo(notes), "push").output).toBe(NOTES);
    // …whether or not main had moved: its own run covered that commit.
    expect(run(repo(notes, { mainMoves: true }), "push").output).toBe(NOTES);
  });

  it("a merge to main of a branch that held all of main → verified with a green full PR run of its head (asked by sha, with the token)", async () => {
    const dir = repo(code);
    const api = await fakeApi("green");
    const r = await runAsync(dir, "push", { ...api.env, PR_DRAFT: "true" });
    expect(r).toMatchObject({ status: 0, output: VERIFIED });
    expect(r.stdout).toContain("**CI tier: verified**");
    const head = rev(dir, "HEAD^2");
    expect(api.requests[0].path).toBe(`/repos/o/r/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${head}&status=success&per_page=50`);
    expect(api.requests[1].path).toBe("/repos/o/r/actions/runs/4242/jobs?filter=latest&per_page=100");
    expect(api.requests.every((req) => req.auth === "Bearer test-token")).toBe(true);
    // The same commit seen as a pull request's merge is a full run.
    expect(run(dir, "pull_request").output).toBe(FULL_PR);
  });

  it("…and FULL, with coverage, whenever that run cannot be proven green in the full tier", async () => {
    const dir = repo(code);
    // No token (or no repository / workflow ref): not looked up.
    expect(run(dir, "push").output).toBe(FULL_MAIN);
    for (const mode of ["none", "draft-run", "red-job", "500", "404"] as const) {
      const api = await fakeApi(mode);
      const r = await runAsync(dir, "push", api.env);
      expect(r.output, mode).toBe(FULL_MAIN);
      expect(r.stdout, mode).toContain("**CI tier: full**");
    }
    // Nothing listens there.
    expect((await runAsync(dir, "push", { GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ci.yml@refs/heads/main", GITHUB_API_URL: "http://127.0.0.1:9" })).output).toBe(FULL_MAIN);
    // An API that is not https (nor loopback) is refused.
    expect((await runAsync(dir, "push", { GH_TOKEN: "t", GITHUB_REPOSITORY: "o/r", GITHUB_WORKFLOW_REF: "o/r/.github/workflows/ci.yml@refs/heads/main", GITHUB_API_URL: "http://api.example.test" })).output).toBe(FULL_MAIN);
    // A workflow ref of another shape.
    const api = await fakeApi("green");
    expect((await runAsync(dir, "push", { ...api.env, GITHUB_WORKFLOW_REF: "ci.yml" })).output).toBe(FULL_MAIN);
  });

  it("a branch that merged main into itself before merging is verified too", async () => {
    const dir = repo((d, git) => {
      code(d);
      git("add", "-A");
      git("commit", "-q", "-m", "work");
      // main moves, and the branch takes it in.
      git("checkout", "-q", "main");
      writeFileSync(join(d, "lib/other.ts"), "export const b = 2;\n");
      git("add", "-A");
      git("commit", "-q", "-m", "main moves");
      git("checkout", "-q", "pr");
      git("merge", "-q", "--no-ff", "-m", "take main", "main");
    });
    const api = await fakeApi("green");
    expect((await runAsync(dir, "push", api.env)).output).toBe(VERIFIED);
  });

  it("a merge to main after main moved under the branch → full, and the API is not even asked", async () => {
    const api = await fakeApi("green");
    expect((await runAsync(repo(code, { mainMoves: true }), "push", api.env)).output).toBe(FULL_MAIN);
    expect(api.requests).toEqual([]);
  });

  it("a merge to main that changes the frame manifest on the branch's own tree → verified (the warm-up saves the caches)", async () => {
    const dir = repo((d) => {
      code(d);
      writeFileSync(join(d, "lib/frames/frame-manifest.json"), '{"a":1}\n');
    });
    const api = await fakeApi("green");
    expect((await runAsync(dir, "push", api.env)).output).toBe(VERIFIED);
  });

  it("a SHALLOW clone of main (CI's depth 2) deepens itself to see the ancestry", async () => {
    const origin = repo((d, git) => {
      // Three commits on the branch: depth 2 cannot see where it left main.
      for (const n of [2, 3, 4]) {
        writeFileSync(join(d, "lib/code.ts"), `export const a = ${n};\n`);
        git("add", "-A");
        git("commit", "-q", "-m", `work ${n}`);
      }
    });
    const clone = mkdtempSync(join(tmpdir(), "ci-classify-shallow-"));
    tmp.push(clone);
    execFileSync("git", ["clone", "-q", "--depth", "2", `file://${origin}`, clone], { stdio: "pipe" });
    expect(execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: clone, encoding: "utf8" }).trim()).toBe("true");
    const api = await fakeApi("green");
    expect((await runAsync(clone, "push", api.env)).output).toBe(VERIFIED);
  });

  it("the schedule → nightly; idle only when ANOTHER run of ci.yml on this commit passed the floors", async () => {
    const dir = repo(code);
    expect(run(dir, "schedule")).toMatchObject({ status: 0, output: NIGHTLY });
    const covered = await fakeApi("covered");
    expect((await runAsync(dir, "schedule", covered.env)).output).toBe(IDLE);
    expect(covered.requests[0].path).toBe(`/repos/o/r/actions/workflows/ci.yml/runs?head_sha=${rev(dir, "HEAD")}&status=success&per_page=50`);
    for (const mode of ["covered-by-this-run", "green", "none", "500"] as const) {
      const api = await fakeApi(mode);
      expect((await runAsync(dir, "schedule", api.env)).output, mode).toBe(NIGHTLY);
    }
  });

  it("an empty change, a HEAD that is no merge commit, another event and no repository at all → full", () => {
    for (const [event, FULL] of [
      ["pull_request", FULL_PR],
      ["push", FULL_MAIN],
    ] as const) {
      expect(run(repo(() => {}), event, { PR_DRAFT: "true" }).output, event).toBe(FULL);
      expect(run(repo(code, { merge: false }), event, { PR_DRAFT: "true" }).output, event).toBe(FULL);
      const bare = mkdtempSync(join(tmpdir(), "ci-classify-none-"));
      tmp.push(bare);
      expect(run(bare, event, { PR_DRAFT: "true" })).toMatchObject({ status: 0, output: FULL });
    }
    // Not a pull request: the shards cover.
    expect(run(repo(notes), "workflow_dispatch").output).toBe(FULL_MAIN);
    expect(run(repo(notes), undefined).output).toBe(FULL_MAIN);
  });
});

describe("the workflow", () => {
  it("starts on every pull request push, on 'ready for review', on every push to main and nightly — never filtered by path", () => {
    // A workflow that does not start leaves its required checks "Waiting for
    // status to be reported": the pull request could never merge.
    // `ready_for_review` starts the full run of a draft's head; with the
    // default types alone, marking a draft ready would start nothing. The
    // schedule is the nightly coverage run (the nightly / idle tiers).
    expect(yaml).toMatch(
      /\non:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]\n {2}push:\n {4}branches: \[main\]\n {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \*"\n\n/,
    );
    expect(yaml).not.toMatch(/paths(-ignore)?:|branches-ignore:|\[skip ci\]|converted_to_draft|workflow_dispatch/);
  });

  it("a newer run cancels a pull request's run in flight; a merge to main never cancels another's", () => {
    expect(yaml).toContain(
      "\nconcurrency:\n  group: ci-${{ github.event_name == 'pull_request' && github.ref || github.sha }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n",
    );
  });

  it("keeps the required check names, each on exactly one job", () => {
    for (const name of ["E2E (local Supabase)", "Frames published", "Visual regression"]) {
      expect(yaml.split("\n").filter((line) => line === `    name: ${name}`), name).toHaveLength(1);
    }
    expect(jobOf("e2e")).toMatch(/^ {4}name: E2E \(local Supabase\)$/m);
    expect(jobOf("frames")).toMatch(/^ {4}name: Frames published$/m);
    expect(jobOf("visual")).toMatch(/^ {4}name: Visual regression$/m);
    // The gate: the required name in every tier but the draft one, where a
    // green check under that name would outlive the draft (see the gate).
    expect(`\n${jobOf("checks")}`).toContain(`\n    name: \${{ needs.changes.outputs.tier == 'draft' && 'Draft checks (typecheck, lint, build)' || 'Typecheck, lint, unit' }}\n`);
    expect(yaml.match(/'Typecheck, lint, unit'/g)).toHaveLength(1);
    expect(yaml).not.toMatch(/name: Typecheck, lint, unit/);
  });

  it("the lookup's job names are the workflow's own — a rename that forgot ci-runs.mjs would make every merge a full run", () => {
    expect(FULL_RUN_JOBS).toEqual(["Typecheck, lint, unit", "E2E (local Supabase)", "Visual regression", "Frames published", "Preview parity"]);
    expect(jobOf("parity")).toMatch(/^ {4}name: Preview parity$/m);
    expect(jobOf("coverage")).toMatch(/^ {4}name: Unit coverage$/m);
    // Each of them runs only in the full tier — what makes a green one proof of it.
    for (const id of ["e2e", "visual", "parity"]) expect(jobOf(id), id).toContain("needs.changes.outputs.heavy != 'false'");
  });

  it("every job is the classifier, the gate, its cancelled-run marker, the coverage alert or in one group — a new job picks a side here", () => {
    expect([...JOB_IDS].sort()).toEqual(["changes", "checks", "superseded", "coverage-alert", ...Object.values(GROUP_JOBS).flat()].sort());
  });

  it("the classifier runs first on every event, on the checkout and a READ-ONLY token", () => {
    const job = jobOf("changes");
    expect(job).not.toMatch(/^ {4}(if|needs):/m);
    expect(job).toMatch(/^ {4}timeout-minutes: \d+$/m);
    for (const output of ["tier", "static", "unit", "heavy", "frames", "warm", "docs", "coverage"]) {
      expect(job, output).toContain(`\n      ${output}: \${{ steps.classify.outputs.${output} }}\n`);
    }
    // HEAD^1 must be there: the diff is the merge commit's against its base.
    expect(job).toMatch(/uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 2\n/);
    expect(job).toContain(
      "\n        id: classify\n        env:\n          PR_DRAFT: ${{ github.event.pull_request.draft }}\n          GH_TOKEN: ${{ github.token }}\n        run: node scripts/ci-classify-change.mjs\n",
    );
    // The token reads the repository and its runs, nothing else.
    expect(job).toContain("\n    permissions:\n      contents: read\n      actions: read\n    outputs:\n");
    expect(yaml).toMatch(/\npermissions:\n {2}contents: read\n\njobs:/);
    // No third-party action, no secret, nothing that may swallow a failure.
    expect([...job.matchAll(/uses: (\S+)/g)].map((m) => m[1])).toEqual(["actions/checkout@v4"]);
    expect(job).not.toMatch(/continue-on-error|\|\| true|secrets\.|write/);
    // …and the scripts import nothing a bare runner lacks.
    const imports = [...read("scripts/ci-classify-change.mjs").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["node:child_process", "node:fs", "./lib/ci-docs-only.mjs", "./lib/ci-runs.mjs"]);
    expect(read("scripts/lib/ci-docs-only.mjs")).not.toMatch(/^import /m);
    expect(read("scripts/lib/ci-runs.mjs")).not.toMatch(/^import /m);
  });

  it("every job a tier may skip runs unless the classifier SAID no — a failed classifier runs them all", () => {
    for (const group of ["static", "unit", "coverage", "heavy", "frames", "warm"] as const) {
      for (const id of GROUP_JOBS[group]) {
        const job = jobOf(id);
        // `!cancelled()`: with no status function a FAILED `changes` would
        // skip the job, and a skipped required check counts as passing.
        // `!= 'false'`: an empty output (no verdict) runs the job.
        expect(job.match(/^ {4}if: .*$/gm), id).toEqual([`    if: \${{ !cancelled() && needs.changes.outputs.${group} != 'false' }}`]);
        const needs = /^ {4}needs: (.+)$/m.exec(job)?.[1] ?? "";
        expect(needs.replace(/[[\]]/g, "").split(", "), id).toContain("changes");
      }
    }
    // Nothing else reads the classifier: these conditions, the unit shards'
    // two runs and their upload (ci-unit-shards.test.ts), the notes job's,
    // the gate's name, its TIER and its COVERAGE.
    const skippable = ["static", "unit", "coverage", "heavy", "frames", "warm"].reduce((n, g) => n + GROUP_JOBS[g as keyof typeof GROUP_JOBS].length, 0);
    expect(yaml.match(/needs\.changes\.outputs\.\w+/g)).toHaveLength(skippable + 3 + 4);
    expect(yaml.match(/needs\.changes\.outputs\.\w+ != 'false'/g)).toHaveLength(skippable + 2);
    expect(yaml.match(/needs\.changes\.outputs\.coverage == 'false'/g)).toHaveLength(1);
  });

  it("the cache warm-up saves the very caches the pull request jobs restore — same keys, same paths", () => {
    const warm = jobOf("warm");
    const keyOf = (path: string, text: string) =>
      [...text.matchAll(new RegExp(`path: ${path.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\n {10}key: (.+)`, "g"))].map((m) => m[1]);
    const FRAMES_KEY = "frames-${{ hashFiles('lib/frames/frame-manifest.json') }}";
    const VISUAL_KEY = "visual-frames-${{ hashFiles('lib/frames/frame-manifest.json') }}";
    // The readers.
    expect(new Set(keyOf(".frames-cache", jobOf("unit")))).toEqual(new Set([FRAMES_KEY]));
    for (const id of ["visual-bake", "parity"]) expect(keyOf("tmp/visual/frames", jobOf(id)), id).toEqual([VISUAL_KEY]);
    // The warm-up: looked up, seeded, fetched, saved — under the same key.
    expect(keyOf(".frames-cache", warm)).toEqual([FRAMES_KEY, FRAMES_KEY, FRAMES_KEY]);
    expect(keyOf("tmp/visual/frames", warm)).toEqual([VISUAL_KEY, VISUAL_KEY, VISUAL_KEY]);
    expect(warm.match(/lookup-only: true/g)).toHaveLength(2);
    expect(warm.match(/uses: actions\/cache\/save@v4/g)).toHaveLength(2);
    // The same fetches as the readers.
    expect(warm).toContain("node scripts/frames-fetch.mjs --out .frames-cache\n          --fallback-origin https://znipzaxgpaiandwiqabn.supabase.co/storage/v1/object/public/frames");
    expect(jobOf("unit")).toContain("node scripts/frames-fetch.mjs --out .frames-cache\n          --fallback-origin https://znipzaxgpaiandwiqabn.supabase.co/storage/v1/object/public/frames");
    expect(warm).toContain("run: node scripts/visual-regression.mjs --fetch-only");
    expect(read("scripts/visual-regression.mjs")).toMatch(/if \(flags\.has\("--fetch-only"\)\) \{\n {2}await fetchFrames\(\);\n {2}process\.exit\(0\);\n\}/);
    // setup-node's npm cache: saved after the job when its key missed.
    expect(warm).toMatch(/- id: node\n {8}uses: actions\/setup-node@v4\n {8}with:\n {10}node-version: 24\n {10}cache: npm\n/);
    expect(warm).toContain("if: steps.node.outputs.cache-hit != 'true'\n        run: npm ci");
    // Nothing on it may pass a failure.
    expect(warm).not.toMatch(/continue-on-error|\|\| true|secrets\./);
    expect(warm).toMatch(/^ {4}timeout-minutes: \d+$/m);
  });

  it("the coverage alert runs off a pull request only, writes issues only, and judges nothing", () => {
    const alert = jobOf("coverage-alert");
    expect(alert).toMatch(/^ {4}needs: \[changes, coverage\]$/m);
    expect(alert.match(/^ {4}if: .*$/gm)).toEqual([
      "    if: ${{ !cancelled() && github.event_name != 'pull_request' && (needs.coverage.result == 'failure' || needs.coverage.result == 'success') }}",
    ]);
    expect(alert).toContain("\n    permissions:\n      issues: write\n    steps:\n");
    expect(alert).not.toMatch(/uses:|secrets\.|continue-on-error/);
    expect(alert).toContain('title="CI: unit coverage is red on main"');
    expect(alert).toMatch(/gh issue create --title "\$title"/);
    expect(alert).toMatch(/gh issue close "\$open"/);
    // No other job may write anything.
    const writes = [...yaml.matchAll(/^ {6}(\w[\w-]*): write$/gm)].map((m) => m[1]);
    expect(writes).toEqual(["issues"]);
    expect(jobOf("checks")).not.toContain("coverage-alert");
  });

  it("the notes job runs only on the classifier's yes, and runs the notes tests", () => {
    const job = jobOf("docs");
    expect(job).toMatch(/^ {4}needs: changes$/m);
    expect(job.match(/^ {4}if: .*$/gm)).toEqual(["    if: ${{ needs.changes.outputs.docs == 'true' }}"]);
    expect(job).toMatch(/^ {4}timeout-minutes: \d+$/m);
    expect(job).toMatch(/^ {6}- run: npm ci\n {6}- run: npm run test:docs$/m);
    expect(job).not.toMatch(/continue-on-error|\|\| true|passWithNoTests/);
  });

  it("every artifact names how long it is kept — a week at most", () => {
    const uploads = [...yaml.matchAll(/uses: actions\/upload-artifact@v4\n {8}with:\n((?: {10,}.*\n)+)/g)].map((m) => m[1]);
    const kept = Object.fromEntries(uploads.map((block) => [/name: (\S+)/.exec(block)?.[1], Number(/retention-days: (\d+)/.exec(block)?.[1])]));
    expect(kept).toEqual({
      // Read by the same run's `coverage` job only.
      "unit-blob-${{": 1,
      // Diagnostics of one run.
      coverage: 3,
      "playwright-report": 3,
      "visual-results-${{": 3,
      "parity-report": 3,
      "parity-differences": 3,
      // What a contributor fetches to commit (`gh run download`).
      "visual-baseline": 7,
      "parity-baseline": 7,
    });
  });
});

describe("the gate, tier by tier", () => {
  const gate = jobOf("checks");
  const program = /jq -e --arg tier "\$TIER" --arg coverage "\$COVERAGE" '([^']+)' > \/dev\/null/.exec(gate)?.[1] ?? "";
  const hasJq = spawnSync("jq", ["--version"]).status === 0;
  const NEEDS = ["changes", "static", "unit", "coverage", "docs", "frames", "e2e", "visual", "warm"];

  it("reads every job it covers and the classifier's own word, and finishes after every required job", () => {
    expect(program.length).toBeGreaterThan(100);
    expect(gate).toContain(`\n    needs: [${[...NEEDS, "superseded"].join(", ")}]\n`);
    expect(gate.match(/^ {4}if: .*$/gm)).toEqual(["    if: ${{ always() }}"]);
    expect(gate).toContain("NEEDS: ${{ toJSON(needs) }}");
    expect(gate).toContain("TIER: ${{ needs.changes.outputs.tier }}");
    expect(gate).toContain("COVERAGE: ${{ needs.changes.outputs.coverage }}");
    expect(gate).toContain("SUPERSEDED: ${{ needs.superseded.result }}");
    expect(program).toContain(`length == ${NEEDS.length}`);
    expect(gate).not.toMatch(/continue-on-error|\|\| true/);
  });

  // The marker: a job whose condition is `cancelled()` runs only in a run
  // that was cancelled as a whole — the one signal a job's condition sees
  // and a step's does not. It waits for everything the gate covers (so it is
  // judged after the cancel), reads no classifier output and judges nothing.
  it("has a cancelled-run marker that runs only in a cancelled run, after every job the gate covers", () => {
    const marker = jobOf("superseded");
    expect(marker).toContain(`\n    needs: [${NEEDS.join(", ")}]\n`);
    expect(marker.match(/^ {4}if: .*$/gm)).toEqual(["    if: ${{ cancelled() }}"]);
    expect(marker).not.toMatch(/needs\.|continue-on-error|uses:/);
    // Nothing else reads it.
    expect(yaml.match(/needs\.superseded\./g)).toHaveLength(1);
  });

  const off = { frames: "skipped", e2e: "skipped", visual: "skipped", warm: "skipped" };
  /** Each tier's one passing shape, with the classifier's `coverage` it is judged with. */
  const SHAPES: Record<string, { coverage: string; results: Record<string, string> }> = {
    "full (pull request)": {
      coverage: "false",
      results: { changes: "success", static: "success", unit: "success", coverage: "skipped", docs: "skipped", frames: "success", e2e: "success", visual: "success", warm: "skipped" },
    },
    "full (main)": {
      coverage: "true",
      results: { changes: "success", static: "success", unit: "success", coverage: "success", docs: "skipped", frames: "success", e2e: "success", visual: "success", warm: "skipped" },
    },
    verified: {
      coverage: "false",
      results: { changes: "success", static: "skipped", unit: "skipped", coverage: "skipped", docs: "skipped", ...off, frames: "success", warm: "success" },
    },
    nightly: { coverage: "true", results: { changes: "success", static: "skipped", unit: "success", coverage: "success", docs: "skipped", ...off } },
    idle: { coverage: "false", results: { changes: "success", static: "skipped", unit: "skipped", coverage: "skipped", docs: "skipped", ...off } },
    draft: { coverage: "false", results: { changes: "success", static: "success", unit: "skipped", coverage: "skipped", docs: "success", ...off } },
    notes: { coverage: "false", results: { changes: "success", static: "skipped", unit: "skipped", coverage: "skipped", docs: "success", ...off } },
  };
  const tierOf = (shape: string) => shape.replace(/ \(.*\)$/, "");
  /** The jobs whose own check carries the verdict: they must RUN. */
  const RAN: Record<string, string[]> = { full: ["frames", "e2e", "visual"], verified: ["frames"] };

  // The gate's whole script, run as the runner runs it (bash -eo pipefail).
  // A cancelled DRAFT run passes as "superseded" — "Draft checks" stayed red
  // on the pull request for good before (the full run reports under the
  // other name), though it is not required and a draft cannot merge. Every
  // other case is judged exactly as before: a draft run that was NOT
  // cancelled fails on a failure or a timeout, and a cancelled run of any
  // other tier — or with no tier, reported under the required name — is RED
  // under "Typecheck, lint, unit".
  it.skipIf(!hasJq && !process.env.CI)("passes a cancelled draft run as superseded, and nothing else it did not pass before", () => {
    const script = /\n {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(`${gate}\n`)?.[1]?.replace(/^ {10}/gm, "") ?? "";
    expect(script).toContain("jq -e --arg tier");
    const gateSays = (tier: string, superseded: string, results: Record<string, string>, coverage = "false") => {
      const needs = Object.fromEntries(Object.entries({ ...results, superseded }).map(([id, result]) => [id, { result, outputs: {} }]));
      return (
        spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", script], {
          env: { ...process.env, NEEDS: JSON.stringify(needs), TIER: tier, COVERAGE: coverage, SUPERSEDED: superseded, GITHUB_STEP_SUMMARY: "/dev/null" },
          encoding: "utf8",
        }).status === 0
      );
    };
    const draft = SHAPES.draft.results;
    const full = SHAPES["full (pull request)"].results;
    const cancelledDraft = { ...draft, static: "cancelled", docs: "cancelled" };
    const cancelledFull = { ...full, unit: "cancelled", e2e: "cancelled" };

    // Not cancelled (the marker skipped): judged as before.
    expect(gateSays("draft", "skipped", draft)).toBe(true);
    expect(gateSays("draft", "skipped", { ...draft, static: "failure" })).toBe(false);
    expect(gateSays("draft", "skipped", { ...draft, static: "cancelled" })).toBe(false); // a timeout
    expect(gateSays("full", "skipped", full)).toBe(true);
    expect(gateSays("full", "skipped", { ...full, static: "failure" })).toBe(false);
    expect(gateSays("full", "skipped", { ...full, unit: "failure" })).toBe(false);
    // Cancelled: a draft run passes as superseded, whatever its jobs say…
    expect(gateSays("draft", "success", cancelledDraft)).toBe(true);
    expect(gateSays("draft", "success", { ...draft, static: "failure" })).toBe(true);
    // …and every other tier, or none, is judged — red.
    for (const tier of ["full", "verified", "nightly", "idle", "notes", "light", "", "FULL"]) {
      expect(gateSays(tier, "success", cancelledFull), `cancelled, tier "${tier}"`).toBe(false);
      expect(gateSays(tier, "success", { ...cancelledFull, changes: "cancelled" }), `cancelled classifier, tier "${tier}"`).toBe(false);
    }
    // The marker in any state but "success" is no cancel: a draft is judged.
    for (const marker of ["skipped", "failure", "cancelled", ""]) {
      expect(gateSays("draft", marker, cancelledDraft), `marker ${marker}`).toBe(false);
    }
  });

  // CI's runners have jq; a machine without it skips the truth table only
  // outside CI.
  it.skipIf(!hasJq && !process.env.CI)("accepts exactly one shape per tier (and coverage only where the classifier asked for it)", () => {
    const verdict = (tier: string, coverage: string, results: Record<string, string>) => {
      const needs = Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }]));
      return spawnSync("jq", ["-e", "--arg", "tier", tier, "--arg", "coverage", coverage, program], { input: JSON.stringify(needs), encoding: "utf8" }).status === 0;
    };
    expect([...new Set(Object.keys(SHAPES).map(tierOf))].sort()).toEqual(Object.keys(TIERS).sort());
    // The coverage each shape is judged with is the classifier's own.
    expect(SHAPES["full (pull request)"].coverage).toBe(tierOutputs("full", "pull_request").coverage);
    expect(SHAPES["full (main)"].coverage).toBe(tierOutputs("full", "push").coverage);
    for (const t of ["verified", "nightly", "idle", "draft", "notes"]) {
      expect(SHAPES[t].coverage, t).toBe(tierOutputs(t, t === "nightly" ? "schedule" : t === "draft" ? "pull_request" : "push").coverage);
    }

    // Each tier's own shape passes; every other shape fails under it.
    for (const [name, { coverage }] of Object.entries(SHAPES)) {
      for (const [other, { results }] of Object.entries(SHAPES)) {
        expect(verdict(tierOf(name), coverage, results), `tier ${name}, shape ${other}`).toBe(name === other);
      }
    }
    // A pull request's full run never passes WITH coverage missing unless the
    // classifier said "false"; an empty coverage output covers.
    expect(verdict("full", "", SHAPES["full (pull request)"].results)).toBe(false);
    expect(verdict("full", "", SHAPES["full (main)"].results)).toBe(true);
    expect(verdict("nightly", "false", SHAPES.nightly.results)).toBe(false);
    // No tier, or one nobody knows, is judged as full.
    for (const tier of ["", "FULL", "main", "true", "light"]) {
      for (const [name, { coverage, results }] of Object.entries(SHAPES)) {
        expect(verdict(tier, coverage, results), `tier "${tier}", shape ${name}`).toBe(tierOf(name) === "full");
      }
    }

    // In every tier: any job that moves off its expected result is red —
    // a failure, a cancel (a timeout ends as "cancelled"), a stray skip, or
    // a job that ran where the tier says it must not.
    for (const [name, { coverage, results }] of Object.entries(SHAPES)) {
      const tier = tierOf(name);
      const ran = RAN[tier] ?? [];
      for (const id of NEEDS) {
        for (const result of ["success", "failure", "cancelled", "skipped"]) {
          if (result === results[id]) continue;
          // A job whose own check carries the verdict passes the gate once it RAN.
          const want = ran.includes(id) && result !== "skipped";
          expect(verdict(tier, coverage, { ...results, [id]: result }), `${name}: ${id} ${result}`).toBe(want);
        }
      }
      // A job missing from `needs`, or one more.
      const { docs: _docs, ...missing } = results;
      void _docs;
      expect(verdict(tier, coverage, missing), `${name}: a need missing`).toBe(false);
      expect(verdict(tier, coverage, { ...results, extra: "success" }), `${name}: a need added`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The list cannot rot: every unit test that names a notes file is on it.
// ---------------------------------------------------------------------------
describe("the tests a notes-only pull request runs", () => {
  /** A quoted string that names Markdown, the docs directory or .claude. */
  const NOTES_LITERAL = /(["'`])(?:[^"'`\n]*\.md(?![A-Za-z0-9])[^"'`\n]*|docs(?:\/[^"'`\n]*)?|\.claude[^"'`\n]*|[^"'`\n]*(?:README|LICENSE)[^"'`\n]*)\1/;

  function sources(dir: string): string[] {
    return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "fixtures" ? [] : sources(rel);
      return /\.(ts|tsx|mjs|js)$/.test(entry.name) ? [rel] : [];
    });
  }

  /** The file's code lines that hold such a literal (comment lines dropped). */
  function notesLines(rel: string): string[] {
    return read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line) && NOTES_LITERAL.test(line));
  }

  // Unit-test sources (helpers beside them included) that NAME a notes file
  // in a string without reading one — each with the reason.
  const MENTIONS_ONLY: Record<string, string> = {
    "tests/unit/render/parity-matrix.test.ts": "failure messages that point the reader at tests/parity/README.md",
    "tests/unit/devops/ci-docs-only.test.ts": "this file: the paths the classifier is tested with",
    "tests/unit/devops/ci-unit-shards.test.ts": "the workflow's job id `docs`, in a list of job ids",
  };

  it("npm run test:docs is exactly the list", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:docs"]).toBe(`vitest run ${DOCS_READING_TESTS.join(" ")}`);
    for (const file of DOCS_READING_TESTS) expect(existsSync(join(ROOT, file)), file).toBe(true);
    expect(new Set(DOCS_READING_TESTS).size).toBe(DOCS_READING_TESTS.length);
  });

  it("every unit-test file that names a notes file is on the list (or says why it only mentions one)", () => {
    const naming = sources("tests/unit").filter((rel) => notesLines(rel).length > 0);
    expect(naming.sort()).toEqual([...DOCS_READING_TESTS, ...Object.keys(MENTIONS_ONLY)].sort());
    // The detector sees the reads that exist today.
    expect(notesLines("tests/unit/content/frames-doc.test.ts").join("\n")).toContain('read("docs/FRAMES.md")');
    expect(notesLines("tests/unit/content/frames-doc.test.ts").join("\n")).toContain('read("CLAUDE.md")');
    expect(notesLines("tests/unit/render/art-window-coverage.test.ts").join("\n")).toContain('"TODO.md"');
  });

  it("no app, library, component or build code reads a Markdown file (it would not be notes)", () => {
    const PATH_LITERAL = /(["'`])[^"'`\n]*\.md\1/;
    const files = [...["app", "lib", "components", "types"].flatMap(sources), "proxy.ts", "next.config.ts"];
    expect(files.length).toBeGreaterThan(500);
    const reading = files.filter((rel) =>
      read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .some((line) => !/^\s*(\/\/|\*)/.test(line) && PATH_LITERAL.test(line)),
    );
    expect(reading).toEqual([]);
  });
});
