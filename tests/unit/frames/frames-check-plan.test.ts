import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findMissing, frameObjectKey } from "@/scripts/lib/frame-objects.mjs";
import { CANARY_SIZE, canarySample, planFramesCheck, readManifestAt, runGit } from "@/scripts/lib/frames-check-plan.mjs";

// The production build's frames check (scripts/frames-check.mjs
// --if-production --incremental; owner 2026-11-02): only the objects new or
// changed since the last successful deployment of the branch, plus a
// rotating canary of the rest — and the FULL check on any doubt.

type Entry = { hash: string; bytes: number; sha256?: string };
type Manifest = { version: 1; bucket: string; files: Record<string, Entry> };

const hex = (n: number, len = 12) => n.toString(16).padStart(len, "0").slice(-len);
const sha = (n: number) => hex(n, 40);
const manifestOf = (count: number, offset = 0): Manifest => ({
  version: 1,
  bucket: "frames",
  files: Object.fromEntries(Array.from({ length: count }, (_, i) => [`t${i}/w.png`, { hash: hex(i + 1 + offset), bytes: 1000 + i }])),
});
const HEAD = sha(0xabc);
const BASE = sha(0xdef);
const prodEnv = (extra: Record<string, string | undefined> = {}) => ({
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_SHA: HEAD,
  VERCEL_GIT_PREVIOUS_SHA: BASE,
  ...extra,
});
const keysOf = (entries: Array<[string, Entry]>) => entries.map(([key]) => key);

/** A plan against `base` (the manifest at VERCEL_GIT_PREVIOUS_SHA). */
function plan(current: Manifest, base: Manifest | { error: string } | (() => never), env = prodEnv(), extra: { incremental?: boolean; originIsProduction?: boolean; canarySize?: number } = {}) {
  return planFramesCheck({
    manifest: current,
    incremental: extra.incremental ?? true,
    originIsProduction: extra.originIsProduction ?? true,
    env,
    canarySize: extra.canarySize,
    readBase: (asked: string) => {
      expect(asked).toBe(env.VERCEL_GIT_PREVIOUS_SHA);
      if (typeof base === "function") return base();
      return "error" in base ? base : { manifest: base };
    },
  });
}

describe("which objects an incremental check looks up", () => {
  const base = manifestOf(1000);

  it("every NEW object and every CHANGED one (another hash or size), plus the canary — never a removed one", () => {
    const current = structuredClone(base);
    current.files["new/w.png"] = { hash: "aaaaaaaaaaaa", bytes: 5 };
    current.files["new/u.webp"] = { hash: "bbbbbbbbbbbb", bytes: 6 };
    current.files["t3/w.png"] = { ...current.files["t3/w.png"], hash: "cccccccccccc" };
    current.files["t4/w.png"] = { ...current.files["t4/w.png"], bytes: 1 };
    delete current.files["t5/w.png"];
    delete current.files["t6/w.png"];
    const p = plan(current, base);
    expect(p.mode).toBe("incremental");
    if (p.mode !== "incremental") return;
    expect(keysOf(p.changed).sort()).toEqual(["new/u.webp", "new/w.png", "t3/w.png", "t4/w.png"]);
    expect(p.baseSha).toBe(BASE);
    expect(p.unchanged).toBe(1000 - 4);
    expect(p.canary).toHaveLength(CANARY_SIZE);
    expect(p.entries).toEqual([...p.changed, ...p.canary]);
    // The removed objects are nowhere: nothing references them any more.
    for (const gone of ["t5/w.png", "t6/w.png"]) expect(keysOf(p.entries)).not.toContain(gone);
    // The canary is drawn from the unchanged objects only.
    for (const [key, entry] of p.canary) expect(base.files[key]).toEqual(entry);
    expect(new Set(keysOf(p.entries)).size).toBe(p.entries.length);
  });

  it("an entry the base manifest holds in another shape (no hash, a string size) counts as changed — looked up", () => {
    const odd = structuredClone(base) as unknown as { files: Record<string, unknown> };
    odd.files["t1/w.png"] = { bytes: 1001 };
    odd.files["t2/w.png"] = { hash: base.files["t2/w.png"].hash, bytes: "1002" };
    odd.files["t7/w.png"] = null;
    const p = plan(base, odd as unknown as Manifest);
    if (p.mode !== "incremental") throw new Error(p.reason);
    expect(keysOf(p.changed).sort()).toEqual(["t1/w.png", "t2/w.png", "t7/w.png"]);
  });

  // VERCEL_GIT_PREVIOUS_SHA is the last SUCCESSFUL deployment: one the
  // Ignored Build Step skipped (CANCELED), or a build that failed, never
  // becomes the base. The base is then OLDER, and the diff against it holds
  // every change since — a superset of what a newer base would give.
  it("an older base (a skipped or failed deployment in between) checks MORE, never less", () => {
    const older = manifestOf(800);
    const middle = structuredClone(older);
    middle.files["mid/w.png"] = { hash: "dddddddddddd", bytes: 7 };
    middle.files["t1/w.png"] = { ...middle.files["t1/w.png"], hash: "eeeeeeeeeeee" };
    const current = structuredClone(middle);
    current.files["new/w.png"] = { hash: "aaaaaaaaaaaa", bytes: 5 };
    const fromMiddle = plan(current, middle);
    const fromOlder = plan(current, older);
    if (fromMiddle.mode !== "incremental" || fromOlder.mode !== "incremental") throw new Error("expected incremental");
    expect(keysOf(fromMiddle.changed)).toEqual(["new/w.png"]);
    expect(keysOf(fromOlder.changed).sort()).toEqual(["mid/w.png", "new/w.png", "t1/w.png"]);
    for (const key of keysOf(fromMiddle.changed)) expect(keysOf(fromOlder.changed)).toContain(key);
  });

  it("a manifest with nothing new looks up the canary alone; a small one is looked up whole", () => {
    const p = plan(base, base);
    if (p.mode !== "incremental") throw new Error(p.reason);
    expect(p.changed).toEqual([]);
    expect(p.entries).toHaveLength(CANARY_SIZE);
    const small = manifestOf(30);
    const q = plan(small, small);
    if (q.mode !== "incremental") throw new Error(q.reason);
    expect(keysOf(q.entries)).toEqual(Object.keys(small.files));
  });
});

describe("the canary", () => {
  const entries = Object.entries(manifestOf(4280).files) as Array<[string, Entry]>;

  it("is the same for one commit and rotates from commit to commit", () => {
    const a = keysOf(canarySample(entries, HEAD, 200));
    expect(a).toHaveLength(200);
    expect(keysOf(canarySample(entries, HEAD, 200))).toEqual(a);
    // Order of the input does not change the pick.
    expect(keysOf(canarySample([...entries].reverse(), HEAD, 200)).sort()).toEqual([...a].sort());
    const seen = new Set(a);
    for (let i = 1; i <= 20; i += 1) {
      const b = keysOf(canarySample(entries, sha(0xabc + i), 200));
      expect(b).toHaveLength(200);
      expect(b).not.toEqual(a);
      // Another commit picks mostly other objects (200 of 4280: ~9 shared).
      expect(b.filter((key) => a.includes(key)).length).toBeLessThan(40);
      for (const key of b) seen.add(key);
    }
    // Over 21 commits the canary has looked at a good part of the bucket.
    expect(seen.size).toBeGreaterThan(2500);
  });

  it("follows the commit through the plan (VERCEL_GIT_COMMIT_SHA is the seed)", () => {
    const base = manifestOf(1000);
    const one = plan(base, base);
    const again = plan(base, base);
    const other = plan(base, base, prodEnv({ VERCEL_GIT_COMMIT_SHA: sha(0x123) }));
    if (one.mode !== "incremental" || again.mode !== "incremental" || other.mode !== "incremental") throw new Error("expected incremental");
    expect(keysOf(again.canary)).toEqual(keysOf(one.canary));
    expect(keysOf(other.canary)).not.toEqual(keysOf(one.canary));
  });

  it("never asks for more than there is, and none when told none", () => {
    expect(canarySample(entries.slice(0, 5), HEAD, 200)).toEqual(entries.slice(0, 5));
    expect(canarySample(entries, HEAD, 0)).toEqual([]);
  });
});

describe("any doubt is the FULL check", () => {
  const base = manifestOf(500);
  const current = manifestOf(510);
  const expectFull = (p: ReturnType<typeof plan>, reason: RegExp) => {
    expect(p.mode).toBe("full");
    if (p.mode !== "full") return;
    expect(p.reason).toMatch(reason);
    expect(p.entries).toEqual(Object.entries(current.files));
  };

  it("no previous SHA (the branch's first deployment, or no Ignored Build Step) → full", () => {
    expectFull(plan(current, base, prodEnv({ VERCEL_GIT_PREVIOUS_SHA: undefined })), /VERCEL_GIT_PREVIOUS_SHA is empty/);
    expectFull(plan(current, base, prodEnv({ VERCEL_GIT_PREVIOUS_SHA: "" })), /VERCEL_GIT_PREVIOUS_SHA is empty/);
  });

  it("a previous or current SHA that is not a full commit SHA → full (never handed to git)", () => {
    for (const bad of ["HEAD", "HEAD~1", "abc123", `${BASE} `, `--upload-pack=x`, BASE.toUpperCase(), `${BASE}0`]) {
      expectFull(plan(current, base, prodEnv({ VERCEL_GIT_PREVIOUS_SHA: bad })), /VERCEL_GIT_PREVIOUS_SHA .* is not a full commit SHA/);
    }
    for (const bad of [undefined, "", "main", HEAD.slice(1)]) {
      expectFull(plan(current, base, prodEnv({ VERCEL_GIT_COMMIT_SHA: bad })), /VERCEL_GIT_COMMIT_SHA .* is not a full commit SHA/);
    }
  });

  it("a git failure → full, whether reported or thrown", () => {
    expectFull(plan(current, { error: "git could not read it" }), /git could not read it/);
    expectFull(
      plan(current, () => {
        throw new Error("spawn git ENOENT");
      }),
      /threw \(spawn git ENOENT\)/,
    );
  });

  it("a base manifest that names another bucket → full", () => {
    expectFull(plan(current, { ...base, bucket: "frames-dev" } as Manifest), /another bucket/);
  });

  it("not asked for, not a production build, another origin, or FRAMES_CHECK_FULL=1 → full", () => {
    expectFull(plan(current, base, prodEnv(), { incremental: false }), /--incremental was not asked for/);
    for (const env of ["preview", "development", "", undefined, "Production"]) {
      expectFull(plan(current, base, prodEnv({ VERCEL_ENV: env })), /not a production build/);
    }
    expectFull(plan(current, base, prodEnv(), { originIsProduction: false }), /--origin is not production's bucket/);
    expectFull(plan(current, base, prodEnv({ FRAMES_CHECK_FULL: "1" })), /FRAMES_CHECK_FULL=1/);
  });
});

describe("a missing object still fails the check", () => {
  it("a new object the bucket lacks is reported missing; the removed and unchanged ones are never asked for", async () => {
    const base = manifestOf(600);
    const current = structuredClone(base);
    current.files["new/w.png"] = { hash: "aaaaaaaaaaaa", bytes: 5 };
    delete current.files["t9/w.png"];
    const p = plan(current, base);
    if (p.mode !== "incremental") throw new Error(p.reason);
    const asked: string[] = [];
    const missing = await findMissing(
      p.entries,
      async ([key, entry]: [string, Entry]) => {
        asked.push(frameObjectKey(key, entry.hash));
        return key === "new/w.png" ? { ok: false, status: "404" } : { ok: true, status: "206" };
      },
      { confirmDelayMs: 0 },
    );
    expect(missing.map(({ item: [key], status }) => [key, status])).toEqual([["new/w.png", "404"]]);
    expect(asked).toContain(frameObjectKey("new/w.png", "aaaaaaaaaaaa"));
    expect(asked).not.toContain(frameObjectKey("t9/w.png", base.files["t9/w.png"].hash));
    // The first pass plus the confirm pass's look at the miss — nothing else.
    expect(asked).toHaveLength(1 + CANARY_SIZE + 1);
  });

  it("a canary object the bucket lost fails it too", async () => {
    const base = manifestOf(600);
    const p = plan(base, base);
    if (p.mode !== "incremental") throw new Error(p.reason);
    const [lost] = p.canary[0];
    const missing = await findMissing(p.entries, async ([key]: [string, Entry]) => (key === lost ? { ok: false, status: "400" } : { ok: true, status: "206" }), {
      confirmDelayMs: 0,
    });
    expect(missing.map(({ item: [key] }) => key)).toEqual([lost]);
  });
});

describe("reading the manifest at the previous deployment's commit (git)", () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
  const repo = () => {
    const dir = mkdtempSync(join(tmpdir(), "frames-plan-"));
    dirs.push(dir);
    const git = (...args: string[]) => runGit(["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir });
    git("init", "-q");
    return { dir, git, read: (at: string) => readManifestAt(at, { git: (args) => runGit(args, { cwd: dir }) }) };
  };
  const commit = (r: ReturnType<typeof repo>, text: string) => {
    writeFileSync(join(r.dir, "manifest.json"), text);
    r.git("add", "manifest.json");
    r.git("commit", "-q", "-m", "m");
    return r.git("rev-parse", "HEAD").trim();
  };
  const readAt = (r: ReturnType<typeof repo>, at: string) => readManifestAt(at, { git: (args) => runGit(args, { cwd: r.dir }), file: "manifest.json" });

  it("reads the manifest of a commit in the clone", () => {
    const r = repo();
    const m = manifestOf(3);
    const first = commit(r, JSON.stringify(m));
    commit(r, JSON.stringify(manifestOf(4)));
    expect(readAt(r, first)).toEqual({ manifest: m });
  });

  it("a commit the clone lacks and cannot fetch (no remote) is an error, never a throw", () => {
    const r = repo();
    commit(r, JSON.stringify(manifestOf(3)));
    const result = readAt(r, sha(0x5eed));
    expect(result).toMatchObject({ error: expect.stringMatching(/git could not read manifest\.json at 000000000000/) });
    // …and the plan turns it into the full check.
    const current = manifestOf(3);
    const p = planFramesCheck({ manifest: current, incremental: true, originIsProduction: true, env: prodEnv({ VERCEL_GIT_PREVIOUS_SHA: sha(0x5eed) }), readBase: (at) => readAt(r, at) });
    expect(p.mode).toBe("full");
  });

  it("a commit without the file, or with a file that is not a version-1 manifest, is an error", () => {
    const r = repo();
    const garbled = commit(r, "{ not json");
    expect(readAt(r, garbled)).toMatchObject({ error: expect.any(String) });
    const wrong = commit(r, JSON.stringify({ version: 2, files: {} }));
    expect(readAt(r, wrong)).toMatchObject({ error: expect.stringMatching(/not a version-1 frame manifest/) });
    const arrayFiles = commit(r, JSON.stringify({ version: 1, files: [] }));
    expect(readAt(r, arrayFiles)).toMatchObject({ error: expect.stringMatching(/not a version-1 frame manifest/) });
    const ok = commit(r, JSON.stringify(manifestOf(1)));
    expect(r.read(ok)).toMatchObject({ error: expect.stringMatching(/git could not read lib\/frames\/frame-manifest\.json/) });
  });

  it("asks git for the commit only by its full SHA", () => {
    const calls: string[][] = [];
    const git = (args: string[]) => {
      calls.push(args);
      throw new Error("no");
    };
    expect(readManifestAt("HEAD", { git })).toMatchObject({ error: expect.stringMatching(/not a full commit SHA/) });
    expect(calls).toEqual([]);
    readManifestAt(BASE, { git });
    // Not in the shallow clone: one fetch of that commit alone, then give up.
    expect(calls).toEqual([
      ["cat-file", "-e", `${BASE}^{commit}`],
      ["fetch", "--no-tags", "--depth=1", "origin", BASE],
    ]);
  });
});

describe("the production build is wired to it", () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("npm run build checks incrementally, in production only", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build).toBe("node scripts/frames-check.mjs --if-production --incremental && next build");
    // The manual / CI check stays full.
    expect(pkg.scripts["frames:check"]).toBe("node scripts/frames-check.mjs");
  });

  // VERCEL_GIT_PREVIOUS_SHA is set ONLY when the project has an Ignored Build
  // Step: without one every production build silently falls back to the
  // full check. WHICH step it is (one that always builds, or the notes-only
  // skip) is its own concern and its own tests'.
  it("vercel.json has an Ignored Build Step (what makes Vercel set VERCEL_GIT_PREVIOUS_SHA)", () => {
    const { ignoreCommand } = JSON.parse(read("vercel.json"));
    expect(typeof ignoreCommand).toBe("string");
    expect(ignoreCommand.trim()).not.toBe("");
  });
});
