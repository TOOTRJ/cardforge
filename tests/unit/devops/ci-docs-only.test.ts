import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyChange, DOCS_READING_TESTS, FRAME_MANIFEST, isNotesFile, NOTES_ALLOW_LIST, TIERS } from "@/scripts/lib/ci-docs-only.mjs";

// ---------------------------------------------------------------------------
// CI's tiers (.github/workflows/ci.yml, owner 2026-10-13: Actions minutes are
// billed once the repo is private). The `changes` job puts every run in one:
// full (everything), notes (a change of notes only: the notes tests), draft
// (a draft pull request: typecheck, lint, build + the notes tests) or light
// (a merge to main of the tree its pull request already tested: no e2e,
// visual, parity or frames again). What must hold, and would fail SILENTLY
// if it stopped holding:
//
//   - "notes" is an allow-list, and nothing the app or a build reads is on it;
//   - anything unclear is the FULL tier (one code file on a ready pull
//     request, no file, a failed diff, an unknown event, a main that moved);
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
  unit: ["unit", "coverage"],
  heavy: ["frames", "e2e", "visual-bake", "visual", "parity"],
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
  const push = (files: string[] | null, treeIsPrHead = false) => tier({ event: "push", files, treeIsPrHead });

  it("what each tier runs", () => {
    expect(TIERS).toEqual({
      full: { static: true, unit: true, heavy: true, docs: false },
      light: { static: true, unit: true, heavy: false, docs: false },
      draft: { static: true, unit: false, heavy: false, docs: true },
      notes: { static: false, unit: false, heavy: false, docs: true },
    });
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
    // The light tier is main's alone.
    expect(tier({ event: "pull_request", files: ["lib/ids.ts"], draft: false, treeIsPrHead: true })).toBe("full");
  });

  it("a merge to main: notes; light only for the pull request head's own tree; else everything", () => {
    expect(push(["TODO.md"])).toBe("notes");
    expect(push(["TODO.md"], true)).toBe("notes");
    expect(push(["lib/ids.ts"], true)).toBe("light");
    expect(push(["lib/ids.ts", "TODO.md", "supabase/migrations/0001_x.sql"], true)).toBe("light");
    expect(push(["lib/ids.ts"], false)).toBe("full");
    for (const same of [undefined, null, "true", 1]) {
      expect(tier({ event: "push", files: ["lib/ids.ts"], treeIsPrHead: same }), String(same)).toBe("full");
    }
    // main's run saves the frame caches every pull request restores.
    expect(FRAME_MANIFEST).toBe("lib/frames/frame-manifest.json");
    expect(existsSync(join(ROOT, FRAME_MANIFEST))).toBe(true);
    expect(push(["lib/ids.ts", FRAME_MANIFEST], true)).toBe("full");
    // A draft flag means nothing on a push.
    expect(tier({ event: "push", files: ["lib/ids.ts"], draft: true })).toBe("full");
  });

  it("no file, an unreadable diff and any other event run everything", () => {
    for (const event of ["pull_request", "push"]) {
      expect(tier({ event, files: [], draft: true, treeIsPrHead: true }), event).toBe("full");
      expect(tier({ event, files: null, draft: true, treeIsPrHead: true }), event).toBe("full");
      expect(tier({ event, files: "TODO.md" as unknown as string[], draft: true, treeIsPrHead: true }), event).toBe("full");
    }
    for (const event of ["workflow_dispatch", "merge_group", "pull_request_target", "schedule", "", undefined]) {
      expect(tier({ event, files: ["TODO.md"], draft: true, treeIsPrHead: true }), String(event)).toBe("full");
    }
  });

  it("every verdict says why", () => {
    for (const input of [
      { event: "pull_request", files: ["TODO.md"] },
      { event: "pull_request", files: ["lib/a.ts"], draft: true },
      { event: "pull_request", files: ["lib/a.ts"] },
      { event: "push", files: ["lib/a.ts"], treeIsPrHead: true },
      { event: "push", files: ["lib/a.ts"] },
      { event: "push", files: null },
    ]) {
      expect(classifyChange(input).reason.length).toBeGreaterThan(20);
    }
  });
});

// The script as CI runs it: a real repository, a real merge commit.
describe("scripts/ci-classify-change.mjs", () => {
  const tmp: string[] = [];
  afterAll(() => {
    for (const dir of tmp) rmSync(dir, { recursive: true, force: true });
  });

  const FULL = "tier=full\nstatic=true\nunit=true\nheavy=true\ndocs=false\n";
  const LIGHT = "tier=light\nstatic=true\nunit=true\nheavy=false\ndocs=false\n";
  const DRAFT = "tier=draft\nstatic=true\nunit=false\nheavy=false\ndocs=true\n";
  const NOTES = "tier=notes\nstatic=false\nunit=false\nheavy=false\ndocs=true\n";

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

  function run(dir: string, event: string | undefined, env: Record<string, string> = {}) {
    const out = join(dir, ".out");
    writeFileSync(out, "");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci-classify-change.mjs")], {
      cwd: dir,
      env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: "", GITHUB_EVENT_NAME: event ?? "", PR_DRAFT: "", GIT_CEILING_DIRECTORIES: dirname(dir), ...env },
      encoding: "utf8",
    });
    return { status: r.status, output: readFileSync(out, "utf8"), stdout: r.stdout };
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

  it("a pull request with code → full when ready, draft when PR_DRAFT is exactly true; the tier and the file are named", () => {
    const dir = repo((d) => {
      notes(d);
      code(d);
    });
    const ready = run(dir, "pull_request", { PR_DRAFT: "false" });
    expect(ready).toMatchObject({ status: 0, output: FULL });
    expect(ready.stdout).toContain("**CI tier: full**");
    expect(ready.stdout).toContain("lib/code.ts");
    expect(run(dir, "pull_request").output).toBe(FULL);
    expect(run(dir, "pull_request", { PR_DRAFT: "TRUE" }).output).toBe(FULL);
    const draft = run(dir, "pull_request", { PR_DRAFT: "true" });
    expect(draft.output).toBe(DRAFT);
    expect(draft.stdout).toContain("**CI tier: draft**");
  });

  it("a code file RENAMED to a notes name, and a deleted code file → full", () => {
    const renamed = repo((d) => {
      writeFileSync(join(d, "NOTES.md"), readFileSync(join(d, "lib/code.ts")));
      rmSync(join(d, "lib/code.ts"));
    });
    expect(run(renamed, "pull_request").output).toBe(FULL);
    expect(run(repo((d) => rmSync(join(d, "lib/code.ts"))), "pull_request").output).toBe(FULL);
  });

  it("a merge to main of notes only → notes", () => {
    expect(run(repo(notes), "push").output).toBe(NOTES);
    // …whether or not main had moved: its own run covered that commit.
    expect(run(repo(notes, { mainMoves: true }), "push").output).toBe(NOTES);
  });

  it("a merge to main of a branch that held all of main → light; the draft flag is ignored", () => {
    const dir = repo(code);
    expect(run(dir, "push")).toMatchObject({ status: 0, output: LIGHT });
    expect(run(dir, "push", { PR_DRAFT: "true" }).output).toBe(LIGHT);
    // The same commit seen as a pull request's merge is a full run.
    expect(run(dir, "pull_request").output).toBe(FULL);
  });

  it("a branch that merged main into itself before merging is light too", () => {
    const dir = repo(
      (d, git) => {
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
      },
    );
    expect(run(dir, "push").output).toBe(LIGHT);
  });

  it("a merge to main after main moved under the branch → full (the merged tree was never tested)", () => {
    expect(run(repo(code, { mainMoves: true }), "push").output).toBe(FULL);
  });

  it("a merge to main that changes the frame manifest → full, even on the branch's own tree", () => {
    const dir = repo((d) => {
      code(d);
      writeFileSync(join(d, "lib/frames/frame-manifest.json"), '{"a":1}\n');
    });
    expect(run(dir, "push").output).toBe(FULL);
  });

  it("a SHALLOW clone of main (CI's depth 2) deepens itself to see the ancestry", () => {
    const origin = repo(
      (d, git) => {
        // Three commits on the branch: depth 2 cannot see where it left main.
        for (const n of [2, 3, 4]) {
          writeFileSync(join(d, "lib/code.ts"), `export const a = ${n};\n`);
          git("add", "-A");
          git("commit", "-q", "-m", `work ${n}`);
        }
      },
    );
    const clone = mkdtempSync(join(tmpdir(), "ci-classify-shallow-"));
    tmp.push(clone);
    execFileSync("git", ["clone", "-q", "--depth", "2", `file://${origin}`, clone], { stdio: "pipe" });
    expect(execFileSync("git", ["rev-parse", "--is-shallow-repository"], { cwd: clone, encoding: "utf8" }).trim()).toBe("true");
    expect(run(clone, "push").output).toBe(LIGHT);
  });

  it("an empty change, a HEAD that is no merge commit, another event and no repository at all → full", () => {
    for (const event of ["pull_request", "push"]) {
      expect(run(repo(() => {}), event, { PR_DRAFT: "true" }).output, event).toBe(FULL);
      expect(run(repo(code, { merge: false }), event, { PR_DRAFT: "true" }).output, event).toBe(FULL);
      const bare = mkdtempSync(join(tmpdir(), "ci-classify-none-"));
      tmp.push(bare);
      expect(run(bare, event, { PR_DRAFT: "true" })).toMatchObject({ status: 0, output: FULL });
    }
    expect(run(repo(notes), "workflow_dispatch").output).toBe(FULL);
    expect(run(repo(notes), undefined).output).toBe(FULL);
  });
});

describe("the workflow", () => {
  it("starts on every pull request push, on 'ready for review' and on every push to main — never filtered by path", () => {
    // A workflow that does not start leaves its required checks "Waiting for
    // status to be reported": the pull request could never merge.
    // `ready_for_review` starts the full run of a draft's head; with the
    // default types alone, marking a draft ready would start nothing.
    expect(yaml).toMatch(/\non:\n {2}pull_request:\n {4}types: \[opened, synchronize, reopened, ready_for_review\]\n {2}push:\n {4}branches: \[main\]\n\n/);
    expect(yaml).not.toMatch(/paths(-ignore)?:|branches-ignore:|\[skip ci\]|converted_to_draft/);
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

  it("every job is the classifier, the gate or in one group — a new job picks a side here", () => {
    expect([...JOB_IDS].sort()).toEqual(["changes", "checks", ...Object.values(GROUP_JOBS).flat()].sort());
  });

  it("the classifier runs first on every event, on the checkout alone", () => {
    const job = jobOf("changes");
    expect(job).not.toMatch(/^ {4}(if|needs):/m);
    expect(job).toMatch(/^ {4}timeout-minutes: \d+$/m);
    for (const output of ["tier", "static", "unit", "heavy", "docs"]) {
      expect(job, output).toContain(`\n      ${output}: \${{ steps.classify.outputs.${output} }}\n`);
    }
    // HEAD^1 must be there: the diff is the merge commit's against its base.
    expect(job).toMatch(/uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 2\n/);
    expect(job).toContain("\n        id: classify\n        env:\n          PR_DRAFT: ${{ github.event.pull_request.draft }}\n        run: node scripts/ci-classify-change.mjs\n");
    // No third-party action, no token, nothing that may swallow a failure.
    expect([...job.matchAll(/uses: (\S+)/g)].map((m) => m[1])).toEqual(["actions/checkout@v4"]);
    expect(job).not.toMatch(/continue-on-error|\|\| true|secrets\.|GITHUB_TOKEN/);
    // …and the script imports nothing a bare runner lacks.
    const imports = [...read("scripts/ci-classify-change.mjs").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["node:child_process", "node:fs", "./lib/ci-docs-only.mjs"]);
    expect(read("scripts/lib/ci-docs-only.mjs")).not.toMatch(/^import /m);
  });

  it("every job a tier may skip runs unless the classifier SAID no — a failed classifier runs them all", () => {
    for (const group of ["static", "unit", "heavy"] as const) {
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
    // Nothing else reads the classifier: these conditions, the notes job's,
    // the gate's name, its condition and its TIER.
    const skippable = GROUP_JOBS.static.length + GROUP_JOBS.unit.length + GROUP_JOBS.heavy.length;
    expect(yaml.match(/needs\.changes\.outputs\.\w+/g)).toHaveLength(skippable + 4);
    expect(yaml.match(/needs\.changes\.outputs\.\w+ != 'false'/g)).toHaveLength(skippable);
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
  const program = /jq -e --arg tier "\$TIER" '([^']+)' > \/dev\/null/.exec(gate)?.[1] ?? "";
  const hasJq = spawnSync("jq", ["--version"]).status === 0;
  const NEEDS = ["changes", "static", "unit", "coverage", "docs", "frames", "e2e", "visual"];

  it("reads every job it covers and the classifier's own word, and finishes after every required job", () => {
    expect(gate).toContain(`\n    needs: [${NEEDS.join(", ")}]\n`);
    expect(gate).toContain("NEEDS: ${{ toJSON(needs) }}");
    expect(gate).toContain("TIER: ${{ needs.changes.outputs.tier }}");
    expect(program).toContain(`length == ${NEEDS.length}`);
    expect(gate).not.toMatch(/continue-on-error|\|\| true/);
  });

  // It runs whatever became of the jobs it covers, but for ONE case: a DRAFT
  // run that was cancelled (by "ready for review" or a newer push) skips it,
  // so "Draft checks" does not stay red on the pull request — it is not a
  // required name and nothing else replaces it. A cancelled run of any other
  // tier, or with no tier at all, still runs it: a "skipped" required check
  // counts as passing, so a cancelled full run must stay RED under
  // "Typecheck, lint, unit".
  it("runs in every case but a cancelled draft run — a cancelled full run stays red", () => {
    const conditions = gate.match(/^ {4}if: .*$/gm) ?? [];
    expect(conditions).toEqual(["    if: ${{ !cancelled() || needs.changes.outputs.tier != 'draft' }}"]);
    // The condition as written, read as GitHub reads it: a status function
    // is in it (else a failed need would skip the gate), and these are its
    // only terms — so it can be evaluated here.
    const expression = /^ {4}if: \$\{\{ (.*) \}\}$/.exec(conditions[0] ?? "")?.[1] ?? "";
    expect(expression.replace(/!cancelled\(\)|needs\.changes\.outputs\.tier|'draft'|!=|\|\||\s/g, "")).toBe("");
    const runs = (cancelled: boolean, tier: string) =>
      new Function("cancelled", "tier", `return ${expression.replace("needs.changes.outputs.tier", "tier")};`)(() => cancelled, tier) as boolean;
    for (const tier of ["full", "light", "notes", "draft", ""]) {
      // Not cancelled: always runs (a failed, skipped or timed-out job is
      // judged — a job's own timeout is not the run's cancel).
      expect(runs(false, tier), `not cancelled, tier "${tier}"`).toBe(true);
      // Cancelled: skipped only for a draft.
      expect(runs(true, tier), `cancelled, tier "${tier}"`).toBe(tier !== "draft");
    }
  });

  // CI's runners have jq; a machine without it skips the truth table only
  // outside CI.
  it.skipIf(!hasJq && !process.env.CI)("accepts exactly one shape per tier", () => {
    const verdict = (tier: string, results: Record<string, string>) => {
      const needs = Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }]));
      return spawnSync("jq", ["-e", "--arg", "tier", tier, program], { input: JSON.stringify(needs), encoding: "utf8" }).status === 0;
    };
    const ran = { frames: "success", e2e: "success", visual: "success" };
    const off = { frames: "skipped", e2e: "skipped", visual: "skipped" };
    const SHAPES: Record<string, Record<string, string>> = {
      full: { changes: "success", static: "success", unit: "success", coverage: "success", docs: "skipped", ...ran },
      light: { changes: "success", static: "success", unit: "success", coverage: "success", docs: "skipped", ...off },
      draft: { changes: "success", static: "success", unit: "skipped", coverage: "skipped", docs: "success", ...off },
      notes: { changes: "success", static: "skipped", unit: "skipped", coverage: "skipped", docs: "success", ...off },
    };
    expect(Object.keys(SHAPES).sort()).toEqual(Object.keys(TIERS).sort());

    // Each tier's own shape passes; every other tier's shape fails under it.
    for (const tier of Object.keys(SHAPES)) {
      for (const [shape, results] of Object.entries(SHAPES)) {
        expect(verdict(tier, results), `tier ${tier}, shape ${shape}`).toBe(tier === shape);
      }
    }
    // No tier, or one nobody knows, is judged as full.
    for (const tier of ["", "FULL", "main", "true"]) {
      for (const [shape, results] of Object.entries(SHAPES)) {
        expect(verdict(tier, results), `tier "${tier}", shape ${shape}`).toBe(shape === "full");
      }
    }

    // In every tier: any job that moves off its expected result is red —
    // a failure, a cancel (a timeout ends as "cancelled"), a stray skip, or
    // a job that ran where the tier says it must not.
    for (const [tier, shape] of Object.entries(SHAPES)) {
      for (const id of ["changes", "static", "unit", "coverage", "docs"]) {
        for (const result of ["success", "failure", "cancelled", "skipped"]) {
          if (result === shape[id]) continue;
          expect(verdict(tier, { ...shape, [id]: result }), `${tier}: ${id} ${result}`).toBe(false);
        }
      }
      for (const id of ["frames", "e2e", "visual"]) {
        // Full: the job must have RUN — its own required check carries its
        // verdict (a red e2e is red under its own name). Elsewhere: skipped.
        expect(verdict(tier, { ...shape, [id]: "skipped" }), `${tier}: ${id} skipped`).toBe(tier !== "full");
        for (const result of ["success", "failure", "cancelled"]) {
          expect(verdict(tier, { ...shape, [id]: result }), `${tier}: ${id} ${result}`).toBe(tier === "full");
        }
      }
      // A job missing from `needs`, or one more.
      const { docs: _docs, ...missing } = shape;
      void _docs;
      expect(verdict(tier, missing), `${tier}: a need missing`).toBe(false);
      expect(verdict(tier, { ...shape, extra: "success" }), `${tier}: a need added`).toBe(false);
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
