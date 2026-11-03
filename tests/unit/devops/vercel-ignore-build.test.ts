import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BUILD, decide, run, SKIP } from "@/scripts/lib/vercel-ignore-build.mjs";

// ---------------------------------------------------------------------------
// Vercel's Ignored Build Step (owner 2026-11-02,
// docs/research/vercel-build-cost-2026-11.md §3.2): exit 0 SKIPS the build,
// exit 1 BUILDS. It decides whether PRODUCTION builds at all, so what must
// hold is "any doubt builds": it skips only a diff it read in full, between
// two full SHAs, whose every file is on CI's notes allow-list.
// ---------------------------------------------------------------------------

const ROOT = process.cwd();
const ENTRY = join(ROOT, "scripts/vercel-ignore-build.mjs");
const PREV = "a".repeat(40);
const CUR = "b".repeat(40);

type GitResult = { ok: boolean; stdout: string; stderr: string };

/** A git that has both commits and answers `diff` with these files. */
function fakeGit(files: string[] | null, { has = () => true, fetchOk = true }: { has?: (sha: string) => boolean; fetchOk?: boolean } = {}) {
  const calls: string[][] = [];
  const present = new Set<string>();
  const git = (args: string[]): GitResult => {
    calls.push(args);
    if (args[0] === "cat-file") {
      const sha = args[2].replace("^{commit}", "");
      return { ok: present.has(sha) || has(sha), stdout: "", stderr: "" };
    }
    if (args[0] === "fetch") {
      if (fetchOk) present.add(args[args.length - 1]);
      return { ok: fetchOk, stdout: "", stderr: fetchOk ? "" : "fatal: could not read from remote" };
    }
    if (args[0] === "diff") {
      if (files === null) return { ok: false, stdout: "", stderr: "fatal: bad object" };
      return { ok: true, stdout: files.map((file) => `${file}\0`).join(""), stderr: "" };
    }
    return { ok: false, stdout: "", stderr: `unexpected git ${args.join(" ")}` };
  };
  return { git, calls };
}

const env = { VERCEL_GIT_PREVIOUS_SHA: PREV, VERCEL_GIT_COMMIT_SHA: CUR };
const verdict = (files: string[] | null, extra: Parameters<typeof fakeGit>[1] = {}, e: Record<string, string | undefined> = env) =>
  run({ env: e, git: fakeGit(files, extra).git, log: () => {} });

describe("the Ignored Build Step's rule", () => {
  it("skips a change of notes only", () => {
    expect(verdict(["docs/x.md", "TODO.md", "CLAUDE.md", ".claude/skills/a/SKILL.md", "tests/README.md"])).toBe(SKIP);
    expect(decide({ env, git: fakeGit(["docs/research/x.md"]).git })).toEqual({
      skip: true,
      reason: "all 1 changed file(s) are notes",
      files: ["docs/research/x.md"],
    });
  });

  it("builds when one file is code", () => {
    expect(verdict(["docs/x.md", "lib/cards/anatomy.ts"])).toBe(BUILD);
    expect(decide({ env, git: fakeGit(["docs/x.md", "lib/cards/anatomy.ts"]).git })).toMatchObject({
      skip: false,
      files: ["lib/cards/anatomy.ts"],
    });
  });

  it("builds for anything under supabase/, even a README", () => {
    expect(verdict(["supabase/README.md"])).toBe(BUILD);
    expect(verdict(["supabase/migrations/README.md", "docs/x.md"])).toBe(BUILD);
  });

  it("builds for anything under .github/", () => {
    expect(verdict([".github/pull_request_template.md"])).toBe(BUILD);
    expect(verdict([".github/workflows/ci.yml"])).toBe(BUILD);
  });

  it("builds for an .mdx (a page of the site)", () => {
    expect(verdict(["content/articles/how-to-make-a-custom-mtg-card.mdx"])).toBe(BUILD);
    expect(verdict(["docs/guide.mdx"])).toBe(BUILD);
  });

  it("builds for its own config and script, and for any other kind of file", () => {
    for (const file of ["vercel.json", "next.config.ts", "package.json", "scripts/vercel-ignore-build.mjs", "public/notes.md", "LICENSE", "README.MD"]) {
      expect(verdict([file]), file).toBe(BUILD);
    }
  });

  it("builds when the env is missing or not two full SHAs", () => {
    for (const e of [
      {},
      { VERCEL_GIT_COMMIT_SHA: CUR },
      { VERCEL_GIT_PREVIOUS_SHA: "", VERCEL_GIT_COMMIT_SHA: CUR },
      { VERCEL_GIT_PREVIOUS_SHA: PREV },
      { VERCEL_GIT_PREVIOUS_SHA: "abc1234", VERCEL_GIT_COMMIT_SHA: CUR },
      { VERCEL_GIT_PREVIOUS_SHA: PREV.toUpperCase(), VERCEL_GIT_COMMIT_SHA: CUR },
      { VERCEL_GIT_PREVIOUS_SHA: "--output=/tmp/x", VERCEL_GIT_COMMIT_SHA: CUR },
      { VERCEL_GIT_PREVIOUS_SHA: PREV, VERCEL_GIT_COMMIT_SHA: `${CUR}\n` },
    ]) {
      expect(verdict(["docs/x.md"], {}, e), JSON.stringify(e)).toBe(BUILD);
    }
  });

  it("builds a redeploy of the deployed commit (no diff to read)", () => {
    expect(verdict(["docs/x.md"], {}, { VERCEL_GIT_PREVIOUS_SHA: PREV, VERCEL_GIT_COMMIT_SHA: PREV })).toBe(BUILD);
  });

  it("builds when git fails", () => {
    expect(verdict(null)).toBe(BUILD);
  });

  it("builds on an empty diff", () => {
    expect(verdict([])).toBe(BUILD);
  });

  it("fetches a commit the shallow clone lacks, and builds when that fails", () => {
    const missing = fakeGit(["docs/x.md"], { has: (sha) => sha !== PREV });
    expect(run({ env, git: missing.git, log: () => {} })).toBe(SKIP);
    expect(missing.calls).toContainEqual(["fetch", "--quiet", "--no-tags", "--depth=1", "origin", PREV]);

    expect(verdict(["docs/x.md"], { has: (sha) => sha !== PREV, fetchOk: false })).toBe(BUILD);
    expect(verdict(["docs/x.md"], { has: (sha) => sha !== CUR, fetchOk: false })).toBe(BUILD);
  });

  it("builds when the check throws", () => {
    const logs: string[] = [];
    const throwing = () => {
      throw new Error("spawn git ENOENT");
    };
    expect(run({ env, git: throwing, log: (line) => logs.push(line) })).toBe(BUILD);
    expect(logs[0]).toContain("BUILD");
  });

  it("reads renames as a delete and an add", () => {
    const { git, calls } = fakeGit(["docs/x.md"]);
    decide({ env, git });
    expect(calls.find((args) => args[0] === "diff")).toEqual(["diff", "--name-only", "--no-renames", "-z", PREV, CUR]);
  });

  it("vercel.json runs the entry, which reuses CI's allow-list rather than a copy", () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { ignoreCommand?: string };
    expect(vercel.ignoreCommand).toBe("node scripts/vercel-ignore-build.mjs");
    const lib = readFileSync(join(ROOT, "scripts/lib/vercel-ignore-build.mjs"), "utf8");
    expect(lib).toContain('import { isNotesFile } from "./ci-docs-only.mjs";');
    // Dependency-free: it runs before `npm install`.
    for (const src of [lib, readFileSync(ENTRY, "utf8")]) {
      for (const [, spec] of src.matchAll(/^import .* from "([^"]+)";$/gm)) {
        expect(spec.startsWith("node:") || spec.startsWith("./"), spec).toBe(true);
      }
    }
  });
});

// The entry against a REAL git: a source repository and a shallow clone of
// it, as Vercel clones.
describe("the Ignored Build Step on a real clone", () => {
  const base = mkdtempSync(join(tmpdir(), "vercel-ignore-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const GIT_ENV = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (repo: string, file: string, text = `${file}\n`) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), text);
  };
  const commit = (repo: string, message: string) => {
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "--no-gpg-sign", "-m", message);
    return git(repo, "rev-parse", "HEAD");
  };
  const entry = (cwd: string, previous: string | undefined, current: string) => {
    const result = spawnSync(process.execPath, [ENTRY], {
      cwd,
      env: { ...GIT_ENV, VERCEL_GIT_PREVIOUS_SHA: previous, VERCEL_GIT_COMMIT_SHA: current },
      encoding: "utf8",
      timeout: 60_000,
    });
    return { code: result.status, out: result.stdout };
  };

  const src = join(base, "src");
  mkdirSync(src);
  git(src, "init", "-q", "-b", "main");
  git(src, "config", "uploadpack.allowReachableSHA1InWant", "true");
  write(src, "lib/a.ts");
  write(src, "docs/a.md");
  const first = commit(src, "first");
  write(src, "docs/a.md", "edited\n");
  write(src, "TODO.md");
  const notes = commit(src, "notes");
  write(src, "lib/a.ts", "edited\n");
  const code = commit(src, "code");
  git(src, "mv", "lib/a.ts", "docs/moved.md");
  const renamed = commit(src, "rename");
  write(src, "supabase/README.md");
  const supabase = commit(src, "supabase");

  it("skips notes only and builds code, a rename out of code and supabase/", () => {
    expect(entry(src, first, notes)).toMatchObject({ code: 0 });
    expect(entry(src, first, notes).out).toContain("SKIP");
    expect(entry(src, notes, code)).toMatchObject({ code: 1 });
    expect(entry(src, first, code)).toMatchObject({ code: 1 });
    expect(entry(src, code, renamed)).toMatchObject({ code: 1 });
    expect(entry(src, renamed, supabase)).toMatchObject({ code: 1 });
  });

  it("builds with no previous SHA, or the same SHA", () => {
    expect(entry(src, undefined, notes)).toMatchObject({ code: 1 });
    expect(entry(src, notes, notes)).toMatchObject({ code: 1 });
  });

  it("fetches the previous commit into a shallow clone, and builds when it cannot", () => {
    // A notes-only change whose previous commit is outside the clone.
    write(src, "docs/later.md");
    const head = commit(src, "later notes");
    const clone = join(base, "clone");
    git(base, "clone", "-q", "--depth=1", "--branch", "main", `file://${src}`, clone);
    expect(() => git(clone, "cat-file", "-e", `${supabase}^{commit}`)).toThrow();
    expect(entry(clone, supabase, head)).toMatchObject({ code: 0 });
    git(clone, "cat-file", "-e", `${supabase}^{commit}`);

    // No remote to fetch from: build.
    git(clone, "remote", "remove", "origin");
    expect(entry(clone, first, head)).toMatchObject({ code: 1 });
    // A SHA that exists nowhere: build.
    expect(entry(src, "c".repeat(40), head)).toMatchObject({ code: 1 });
  });

  it("builds outside a git repository", () => {
    const empty = join(base, "not-a-repo");
    mkdirSync(empty);
    expect(entry(empty, first, notes)).toMatchObject({ code: 1 });
  });
});
