import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyChange, DOCS_READING_TESTS, isNotesFile, NOTES_ALLOW_LIST } from "@/scripts/lib/ci-docs-only.mjs";

// ---------------------------------------------------------------------------
// CI's notes-only path (.github/workflows/ci.yml, owner 2026-10-13): a pull
// request that changes nothing but notes runs `changes` + `docs` + the gate
// instead of the ~55 runner-minutes of the whole suite. What must hold, and
// would fail SILENTLY if it stopped holding:
//
//   - "notes" is an allow-list, and nothing the app or a build reads is on it;
//   - anything that is not a notes-only pull request runs every job, exactly
//     as before (one code file, no file, a failed diff, a push to main);
//   - every unit test that READS a notes file still runs on a notes-only
//     pull request (`npm run test:docs`) — the list cannot rot;
//   - the required check names are unchanged and the gate accepts "skipped"
//     only where the classifier put it.
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

/** Skipped on a notes-only pull request; run on everything else. */
const HEAVY_JOBS = ["static", "unit", "coverage", "frames", "e2e", "visual-bake", "visual", "parity"];
const HEAVY_IF = "if: ${{ !cancelled() && needs.changes.outputs.docs_only != 'true' }}";

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
    expect(isNotesFile(undefined as unknown as string)).toBe(false);
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

describe("the verdict", () => {
  const pr = (files: string[] | null) => classifyChange({ event: "pull_request", files }).docsOnly;

  it("is notes-only when EVERY changed file is notes", () => {
    expect(pr(["TODO.md"])).toBe(true);
    expect(pr(["TODO.md", "CLAUDE.md", "docs/FRAMES.md", "tests/README.md"])).toBe(true);
  });

  it("runs everything for one file that is not", () => {
    expect(pr(["TODO.md", "lib/ids.ts"])).toBe(false);
    expect(pr(["docs/FRAMES.md", "supabase/migrations/README.md"])).toBe(false);
    expect(pr(["TODO.md", ".github/workflows/ci.yml"])).toBe(false);
    expect(pr(["content/articles/a.mdx"])).toBe(false);
    expect(classifyChange({ event: "pull_request", files: ["TODO.md", "lib/ids.ts"] }).code).toEqual(["lib/ids.ts"]);
  });

  it("runs everything for no file, an unreadable diff, and anything that is not a pull request", () => {
    expect(pr([])).toBe(false);
    expect(pr(null)).toBe(false);
    expect(classifyChange({ event: "pull_request", files: "TODO.md" as unknown as string[] }).docsOnly).toBe(false);
    for (const event of ["push", "workflow_dispatch", "merge_group", "pull_request_target", "schedule", "", undefined]) {
      expect(classifyChange({ event: event as string, files: ["TODO.md"] }).docsOnly, String(event)).toBe(false);
    }
  });
});

// The script as CI runs it: a real repository, a real merge commit.
describe("scripts/ci-classify-change.mjs", () => {
  const tmp: string[] = [];
  afterAll(() => {
    for (const dir of tmp) rmSync(dir, { recursive: true, force: true });
  });

  function repo(change: (dir: string) => void, opts: { merge?: boolean } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), "ci-classify-"));
    tmp.push(dir);
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    const put = (rel: string, text: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    };
    put("TODO.md", "one\n");
    put("docs/FRAMES.md", "frames\n");
    put("lib/code.ts", "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "pr");
    change(dir);
    git("add", "-A");
    git("commit", "-q", "-m", "change", "--allow-empty");
    if (opts.merge !== false) {
      git("checkout", "-q", "main");
      git("merge", "-q", "--no-ff", "-m", "merge", "pr");
    }
    return dir;
  }

  function run(dir: string, event: string | undefined) {
    const out = join(dir, ".out");
    writeFileSync(out, "");
    const env = { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: "", GITHUB_EVENT_NAME: event ?? "" };
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci-classify-change.mjs")], { cwd: dir, env, encoding: "utf8" });
    return { status: r.status, output: readFileSync(out, "utf8"), stdout: r.stdout };
  }

  it("a merge that changes notes only → docs_only=true", () => {
    const dir = repo((d) => {
      writeFileSync(join(d, "TODO.md"), "two\n");
      writeFileSync(join(d, "docs/FRAMES.md"), "frames 2\n");
    });
    expect(run(dir, "pull_request")).toMatchObject({ status: 0, output: "docs_only=true\n" });
  });

  it("the same merge on a push (main) → false", () => {
    const dir = repo((d) => writeFileSync(join(d, "TODO.md"), "two\n"));
    expect(run(dir, "push")).toMatchObject({ status: 0, output: "docs_only=false\n" });
    expect(run(dir, undefined)).toMatchObject({ status: 0, output: "docs_only=false\n" });
  });

  it("notes and one code file → false, and the file is named", () => {
    const dir = repo((d) => {
      writeFileSync(join(d, "TODO.md"), "two\n");
      writeFileSync(join(d, "lib/code.ts"), "export const a = 2;\n");
    });
    const r = run(dir, "pull_request");
    expect(r).toMatchObject({ status: 0, output: "docs_only=false\n" });
    expect(r.stdout).toContain("lib/code.ts");
  });

  it("a code file RENAMED to a notes name, and a deleted code file → false", () => {
    const renamed = repo((d) => {
      writeFileSync(join(d, "NOTES.md"), readFileSync(join(d, "lib/code.ts")));
      rmSync(join(d, "lib/code.ts"));
    });
    expect(run(renamed, "pull_request").output).toBe("docs_only=false\n");
    const deleted = repo((d) => rmSync(join(d, "lib/code.ts")));
    expect(run(deleted, "pull_request").output).toBe("docs_only=false\n");
  });

  it("an empty change, a HEAD that is no merge commit, and no repository at all → false", () => {
    expect(run(repo(() => {}), "pull_request").output).toBe("docs_only=false\n");
    const noMerge = repo((d) => writeFileSync(join(d, "TODO.md"), "two\n"), { merge: false });
    expect(run(noMerge, "pull_request").output).toBe("docs_only=false\n");
    const bare = mkdtempSync(join(tmpdir(), "ci-classify-none-"));
    tmp.push(bare);
    // GIT_CEILING_DIRECTORIES: never climb into a repository above tmp.
    const out = join(bare, ".out");
    writeFileSync(out, "");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/ci-classify-change.mjs")], {
      cwd: bare,
      env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: "", GITHUB_EVENT_NAME: "pull_request", GIT_CEILING_DIRECTORIES: dirname(bare) },
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(readFileSync(out, "utf8")).toBe("docs_only=false\n");
  });
});

describe("the workflow", () => {
  it("starts on every pull request and every push to main — never filtered by path", () => {
    // A workflow that does not start leaves its required checks "Waiting for
    // status to be reported": the pull request could never merge.
    expect(yaml).toMatch(/\non:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n\n/);
    expect(yaml).not.toMatch(/paths(-ignore)?:|branches-ignore:|\[skip ci\]/);
  });

  it("keeps the required check names, each on exactly one job", () => {
    for (const name of ["Typecheck, lint, unit", "E2E (local Supabase)"]) {
      expect(yaml.split("\n").filter((line) => line === `    name: ${name}`), name).toHaveLength(1);
    }
    expect(jobOf("checks")).toMatch(/^ {4}name: Typecheck, lint, unit$/m);
    expect(jobOf("e2e")).toMatch(/^ {4}name: E2E \(local Supabase\)$/m);
  });

  it("every job is the classifier, the notes job, the gate or a heavy job — a new job picks a side here", () => {
    expect([...JOB_IDS].sort()).toEqual(["changes", "checks", "docs", ...HEAVY_JOBS].sort());
  });

  it("the classifier runs first on every event, on the checkout alone", () => {
    const job = jobOf("changes");
    expect(job).not.toMatch(/^ {4}(if|needs):/m);
    expect(job).toMatch(/^ {4}timeout-minutes: \d+$/m);
    expect(job).toMatch(/^ {4}outputs:\n {6}docs_only: \$\{\{ steps\.classify\.outputs\.docs_only \}\}$/m);
    // HEAD^1 must be there: the diff is the merge commit's against its base.
    expect(job).toMatch(/uses: actions\/checkout@v4\n {8}with:\n {10}fetch-depth: 2\n/);
    expect(job).toMatch(/^ {8}id: classify\n {8}run: node scripts\/ci-classify-change\.mjs$/m);
    // No third-party action, no token, nothing that may swallow a failure.
    expect([...job.matchAll(/uses: (\S+)/g)].map((m) => m[1])).toEqual(["actions/checkout@v4"]);
    expect(job).not.toMatch(/continue-on-error|\|\| true|secrets\.|GITHUB_TOKEN/);
    // …and the script imports nothing a bare runner lacks.
    const imports = [...read("scripts/ci-classify-change.mjs").matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["node:child_process", "node:fs", "./lib/ci-docs-only.mjs"]);
    expect(read("scripts/lib/ci-docs-only.mjs")).not.toMatch(/^import /m);
  });

  it("every heavy job runs unless the classifier SAID notes-only — a failed classifier runs them all", () => {
    for (const id of HEAVY_JOBS) {
      const job = jobOf(id);
      // `!cancelled()`: with no status function a FAILED `changes` would skip
      // the job, and a skipped required check counts as passing.
      expect(job, id).toContain(`\n    ${HEAVY_IF}\n`);
      expect(job.match(/^ {4}if:/gm), id).toHaveLength(1);
      const needs = /^ {4}needs: (.+)$/m.exec(job)?.[1] ?? "";
      expect(needs.replace(/[[\]]/g, "").split(", "), id).toContain("changes");
    }
    // Only these conditions name the classifier's output.
    expect(yaml.match(/needs\.changes\.outputs\.docs_only/g)).toHaveLength(HEAVY_JOBS.length + 2);
    expect(yaml.match(/docs_only != 'true'/g)).toHaveLength(HEAVY_JOBS.length);
  });

  it("the notes job runs only on the classifier's yes, and runs the notes tests", () => {
    const job = jobOf("docs");
    expect(job).toMatch(/^ {4}needs: changes$/m);
    expect(job).toMatch(/^ {4}if: \$\{\{ needs\.changes\.outputs\.docs_only == 'true' \}\}$/m);
    expect(job).toMatch(/^ {4}timeout-minutes: \d+$/m);
    expect(job).toMatch(/^ {6}- run: npm ci\n {6}- run: npm run test:docs$/m);
    expect(job).not.toMatch(/continue-on-error|\|\| true|passWithNoTests/);
  });
});

describe("the gate on a notes-only run", () => {
  const gate = jobOf("checks");
  const program = /jq -e --arg docs "\$DOCS_ONLY" '([^']+)' > \/dev\/null/.exec(gate)?.[1] ?? "";
  const hasJq = spawnSync("jq", ["--version"]).status === 0;

  it("reads every job it covers and the classifier's own word", () => {
    expect(gate).toMatch(/^ {4}needs: \[changes, static, unit, coverage, docs\]$/m);
    expect(gate).toMatch(/^ {4}if: \$\{\{ always\(\) \}\}$/m);
    expect(gate).toContain("DOCS_ONLY: ${{ needs.changes.outputs.docs_only }}");
    expect(program).toContain("length == 5");
  });

  // CI's runners have jq; a machine without it skips the truth table only
  // outside CI.
  it.skipIf(!hasJq && !process.env.CI)("accepts exactly the code shape and the notes shape", () => {
    const verdict = (docs: string, results: Record<string, string>) => {
      const needs = Object.fromEntries(Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }]));
      return spawnSync("jq", ["-e", "--arg", "docs", docs, program], { input: JSON.stringify(needs), encoding: "utf8" }).status === 0;
    };
    const code = { changes: "success", static: "success", unit: "success", coverage: "success", docs: "skipped" };
    const notes = { changes: "success", static: "skipped", unit: "skipped", coverage: "skipped", docs: "success" };

    expect(verdict("false", code)).toBe(true);
    expect(verdict("true", notes)).toBe(true);
    // An empty output (a classifier that wrote nothing) is the code shape.
    expect(verdict("", code)).toBe(true);
    expect(verdict("", notes)).toBe(false);

    // A shape under the other verdict never passes: "skipped" is accepted
    // only where the classifier put it.
    expect(verdict("false", notes)).toBe(false);
    expect(verdict("true", code)).toBe(false);
    expect(verdict("false", { ...code, docs: "success" })).toBe(false);
    expect(verdict("true", { ...notes, static: "success", unit: "success", coverage: "success" })).toBe(false);

    // Any failure, cancel (a timeout ends as "cancelled") or stray skip.
    for (const bad of ["failure", "cancelled", "skipped"]) {
      for (const id of ["changes", "static", "unit", "coverage"]) {
        expect(verdict("false", { ...code, [id]: bad }), `code: ${id} ${bad}`).toBe(false);
      }
      expect(verdict("true", { ...notes, changes: bad }), `notes: changes ${bad}`).toBe(false);
      expect(verdict("true", { ...notes, docs: bad }), `notes: docs ${bad}`).toBe(false);
    }
    for (const bad of ["failure", "cancelled", "success"]) {
      for (const id of ["static", "unit", "coverage"]) {
        expect(verdict("true", { ...notes, [id]: bad }), `notes: ${id} ${bad}`).toBe(false);
      }
    }
    // A job missing from `needs`, or one more.
    expect(verdict("false", { changes: "success", static: "success", unit: "success", coverage: "success" })).toBe(false);
    expect(verdict("false", { ...code, extra: "success" })).toBe(false);
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
