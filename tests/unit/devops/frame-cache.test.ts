import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStoreApart,
  devMissHint,
  linkFileAtomic,
  STALE_PART_MS,
  sweepStaleParts,
  fetchManifestFile,
  frameBucketOrigins,
  fromCheckoutOrStore,
  isCi,
  sharedFrameCacheDir,
  STORE_MARKER,
  writeFileAtomic,
} from "@/scripts/lib/frame-cache.mjs";
import { PRODUCTION_SUPABASE_REF } from "@/scripts/lib/prod-guard.mjs";
import { syncFrameCache } from "@/scripts/lib/visual-frames.mjs";

// ---------------------------------------------------------------------------
// scripts/lib/frame-cache.mjs — ONE frame store per machine (2026-10-22: every
// fresh agent worktree re-downloaded the 1.3 GB of frame PNGs, and the org went
// over Supabase's cached-egress quota). Shared by every worktree, so nothing in
// it is trusted by name: a corrupt or partial file is fetched again, and every
// write is a temp file renamed into place. CI keeps its own folders. No
// network here: every fetch is a stub.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const ORIGIN = "https://dev.example/frames";
const FALLBACK = "https://prod.example/frames";

const BYTES = Buffer.from("not really a png, but the manifest's bytes");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const ENTRY = { hash: SHA.slice(0, 12), sha256: SHA, bytes: BYTES.byteLength };
const KEY = "m15/r.png";
const OBJECT = `m15/r.${ENTRY.hash}.png`;

let tmp: string;
let store: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frame-cache-"));
  store = path.join(tmp, "store");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A fetch that answers from a script of statuses per URL (200 = BYTES). */
function scripted(answers: Record<string, (number | Buffer)[]> = {}) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    const next = answers[url]?.shift() ?? 404;
    if (Buffer.isBuffer(next)) return new Response(new Uint8Array(next), { status: 200 });
    return new Response(next === 200 ? new Uint8Array(BYTES) : null, { status: next });
  };
  return { fetchImpl, calls };
}
const noSleep = async () => {};
const partFiles = (dir: string): string[] =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".part"))
    : [];

async function syncInto(dir: string, fetchImpl: (url: string) => Promise<Response>) {
  return syncFrameCache({ entries: [[KEY, ENTRY]], origins: [ORIGIN], dir, store, fetchImpl, sleep: noSleep });
}

describe("sharedFrameCacheDir", () => {
  const home = "/Users/someone";
  it("defaults to ~/.cache/pipglyph/frames on a local machine", () => {
    expect(sharedFrameCacheDir({ env: {}, home })).toBe("/Users/someone/.cache/pipglyph/frames");
  });

  it("is moved by PIPGLYPH_FRAMES_CACHE (absolute, ~/ and relative)", () => {
    expect(sharedFrameCacheDir({ env: { PIPGLYPH_FRAMES_CACHE: "/Volumes/fast/frames" }, home })).toBe("/Volumes/fast/frames");
    expect(sharedFrameCacheDir({ env: { PIPGLYPH_FRAMES_CACHE: "~/frames" }, home })).toBe("/Users/someone/frames");
    expect(sharedFrameCacheDir({ env: { PIPGLYPH_FRAMES_CACHE: "cache/frames" }, home, cwd: "/work" })).toBe("/work/cache/frames");
  });

  it("is turned off by PIPGLYPH_FRAMES_CACHE=off / 0", () => {
    for (const off of ["off", "OFF", "0", "false", "no"]) expect(sharedFrameCacheDir({ env: { PIPGLYPH_FRAMES_CACHE: off }, home }), off).toBeNull();
  });

  it("is never used on CI (its folders are actions/cache entries), whatever the env var says", () => {
    expect(sharedFrameCacheDir({ env: { CI: "true" }, home })).toBeNull();
    expect(sharedFrameCacheDir({ env: { CI: "1", PIPGLYPH_FRAMES_CACHE: "/x" }, home })).toBeNull();
    expect(sharedFrameCacheDir({ env: { CI: "false" }, home })).toBe("/Users/someone/.cache/pipglyph/frames");
  });

  it("reads CI as GitHub Actions sets it", () => {
    expect(isCi({ CI: "true" })).toBe(true);
    expect(isCi({})).toBe(false);
    expect(isCi({ CI: "" })).toBe(false);
    expect(isCi({ CI: "0" })).toBe(false);
  });
});

describe("frameBucketOrigins", () => {
  const production = `https://${PRODUCTION_SUPABASE_REF}.supabase.co/storage/v1/object/public/frames`;
  const dev = "https://znipzaxgpaiandwiqabn.supabase.co/storage/v1/object/public/frames";

  it("defaults a LOCAL run to the dev bucket alone (frames-fetch, visual, parity)", () => {
    const origins = frameBucketOrigins({ root: ROOT, env: {} });
    expect(origins).toEqual({ production, dev, defaults: [dev] });
  });

  it("keeps CI on production first, then dev for a frame not promoted yet", () => {
    expect(frameBucketOrigins({ root: ROOT, env: { CI: "true" } }).defaults).toEqual([production, dev]);
  });

  it("frames-fetch takes its default origin from it, and CI's calls still name no --origin (production there)", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/frames-fetch.mjs"), "utf8");
    expect(src).toContain('flags.get("--origin") ?? buckets.defaults[0]');
    expect(src).not.toMatch(/PRODUCTION_SUPABASE_REF/);
    const ci = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const calls = ci.split("\n").filter((line) => line.includes("scripts/frames-fetch.mjs") && !line.trim().startsWith("#"));
    expect(calls.length).toBeGreaterThan(0);
    for (const line of calls) expect(line).not.toContain("--origin");
  });
});

describe("atomic writes", () => {
  it("writes through a temp file renamed into place, leaving no temp behind", () => {
    const file = path.join(tmp, "a", "b.png");
    writeFileAtomic(file, BYTES);
    expect(fs.readFileSync(file)).toEqual(BYTES);
    expect(partFiles(tmp)).toEqual([]);
  });

  it("replaces a file by rename, never in place (a reader holding the old one keeps whole bytes)", () => {
    const file = path.join(tmp, "f.png");
    fs.writeFileSync(file, "the old bytes");
    const reader = fs.openSync(file, "r");
    try {
      writeFileAtomic(file, BYTES);
      const old = Buffer.alloc(64);
      const n = fs.readSync(reader, old, 0, 64, 0);
      expect(old.subarray(0, n).toString()).toBe("the old bytes");
      expect(fs.readFileSync(file)).toEqual(BYTES);
    } finally {
      fs.closeSync(reader);
    }
  });

  it("leaves the old file and no temp when the write fails", () => {
    const file = path.join(tmp, "dir-in-the-way");
    fs.mkdirSync(path.join(file, "child"), { recursive: true });
    expect(() => writeFileAtomic(file, BYTES)).toThrow();
    expect(fs.statSync(file).isDirectory()).toBe(true);
    expect(partFiles(tmp)).toEqual([]);
  });

  it("checks a linked file before renaming it into place", () => {
    const src = path.join(tmp, "src.png");
    const dest = path.join(tmp, "dest.png");
    fs.writeFileSync(src, "corrupt");
    fs.writeFileSync(dest, "untouched");
    expect(linkFileAtomic(src, dest, SHA)).toBe(false);
    expect(fs.readFileSync(dest, "utf8")).toBe("untouched");
    fs.writeFileSync(src, BYTES);
    expect(linkFileAtomic(src, dest, SHA)).toBe(true);
    expect(fs.readFileSync(dest)).toEqual(BYTES);
    expect(partFiles(tmp)).toEqual([]);
  });

  it("replacing a linked store file leaves the worktree's link whole (rename, never in place)", () => {
    const storeFile = path.join(store, OBJECT);
    const view = path.join(tmp, "wt", OBJECT);
    writeFileAtomic(storeFile, BYTES);
    expect(linkFileAtomic(storeFile, view, SHA)).toBe(true);
    expect(fs.statSync(view).ino).toBe(fs.statSync(storeFile).ino);
    writeFileAtomic(storeFile, "a newer write");
    expect(fs.readFileSync(view)).toEqual(BYTES);
  });

  it("copies when a link can't be made (the store on another volume: EXDEV)", () => {
    const src = path.join(tmp, "src.png");
    const dest = path.join(tmp, "dest.png");
    fs.writeFileSync(src, BYTES);
    const link = vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw Object.assign(new Error("cross-device link"), { code: "EXDEV" });
    });
    try {
      expect(linkFileAtomic(src, dest, SHA)).toBe(true);
    } finally {
      link.mockRestore();
    }
    expect(fs.readFileSync(dest)).toEqual(BYTES);
    expect(fs.statSync(dest).ino).not.toBe(fs.statSync(src).ino);
    expect(partFiles(tmp)).toEqual([]);
  });

  it("two syncs into ONE store at once both end with whole, checked files", async () => {
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200, 200] });
    const [a, b] = await Promise.all([syncInto(path.join(tmp, "wt-a"), fetchImpl), syncInto(path.join(tmp, "wt-b"), fetchImpl)]);
    expect(a.failed).toEqual([]);
    expect(b.failed).toEqual([]);
    for (const file of [path.join(store, OBJECT), path.join(tmp, "wt-a", OBJECT), path.join(tmp, "wt-b", OBJECT)]) {
      expect(fs.readFileSync(file)).toEqual(BYTES);
    }
    expect(partFiles(tmp)).toEqual([]);
  });
});

describe("read-only store files", () => {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it.skipIf(isRoot)("an in-place write to a worktree's linked file fails (EACCES) instead of changing every copy", async () => {
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    const dir = path.join(tmp, "wt");
    await syncInto(dir, fetchImpl);
    const view = path.join(dir, OBJECT);
    expect(fs.statSync(path.join(store, OBJECT)).mode & 0o777).toBe(0o444);
    expect(fs.statSync(view).mode & 0o777).toBe(0o444);
    expect(() => fs.writeFileSync(view, "an in-place write")).toThrow(expect.objectContaining({ code: "EACCES" }));
    expect(() => fs.appendFileSync(path.join(store, OBJECT), "!")).toThrow(expect.objectContaining({ code: "EACCES" }));
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
  });

  it("still lets the scripts replace (rename over) and remove (unlink) them", async () => {
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    const dir = path.join(tmp, "wt");
    await syncInto(dir, fetchImpl);
    writeFileAtomic(path.join(store, OBJECT), BYTES, { readOnly: true });
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
    // The visual prune unlinks a read-only file another manifest no longer names.
    const res = await syncFrameCache({ entries: [], origins: [ORIGIN], dir, store, fetchImpl: scripted().fetchImpl, sleep: noSleep });
    expect(res.failed).toEqual([]);
    expect(fs.existsSync(path.join(dir, OBJECT))).toBe(false);
    expect(fs.existsSync(path.join(store, OBJECT))).toBe(true);
  });

  it("makes a hand-seeded (writable) store file read-only on first use", async () => {
    fs.mkdirSync(path.join(store, "m15"), { recursive: true });
    fs.writeFileSync(path.join(store, OBJECT), BYTES, { mode: 0o644 });
    await syncInto(path.join(tmp, "wt"), scripted().fetchImpl);
    expect(fs.statSync(path.join(store, OBJECT)).mode & 0o777).toBe(0o444);
  });
});

describe("the store and a checkout folder never overlap", () => {
  it("refuses the same folder, a store inside the folder and the folder inside the store", () => {
    const dir = path.join(tmp, "wt");
    expect(() => assertStoreApart(dir, dir)).toThrow(/overlap/);
    expect(() => assertStoreApart(path.join(dir, "store"), dir)).toThrow(/overlap/);
    expect(() => assertStoreApart(store, path.join(store, "m15"))).toThrow(/overlap/);
    expect(() => assertStoreApart(store, dir)).not.toThrow();
    // A sibling whose name only STARTS like the store's is apart.
    expect(() => assertStoreApart(store, `${store}-other`)).not.toThrow();
  });

  it("sees through a symlink (realpath)", () => {
    fs.mkdirSync(store, { recursive: true });
    const alias = path.join(tmp, "alias");
    fs.symlinkSync(store, alias);
    expect(() => assertStoreApart(store, alias)).toThrow(/overlap/);
    expect(() => assertStoreApart(store, path.join(alias, "not-yet", "made"))).toThrow(/overlap/);
  });

  it("syncFrameCache refuses a store nested inside the checkout folder before touching anything", async () => {
    const dir = path.join(tmp, "wt");
    const nested = path.join(dir, "store");
    await expect(
      syncFrameCache({ entries: [[KEY, ENTRY]], origins: [ORIGIN], dir, store: nested, fetchImpl: scripted().fetchImpl, sleep: noSleep }),
    ).rejects.toThrow(/overlap/);
    expect(fs.existsSync(nested)).toBe(false);
  });
});

describe("stale temp files", () => {
  const age = (file: string, ms: number) => {
    const t = new Date(Date.now() - ms);
    fs.utimesSync(file, t, t);
  };

  it("sweeps an hour-old *.part and never a fresh one (another process's write)", () => {
    const dir = path.join(tmp, "d", "m15");
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, "r.abc.png.111.deadbeef.part");
    const fresh = path.join(dir, "r.abc.png.222.cafebabe.part");
    const png = path.join(dir, "r.abc.png");
    for (const f of [old, fresh, png]) fs.writeFileSync(f, "x");
    age(old, STALE_PART_MS + 60_000);
    age(png, STALE_PART_MS + 60_000);
    expect(sweepStaleParts(path.join(tmp, "d"))).toBe(1);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(png)).toBe(true);
  });

  it("a sync sweeps the store's stale temps and its prune leaves a fresh one in the folder", async () => {
    const dir = path.join(tmp, "wt");
    fs.mkdirSync(path.join(store, "m15"), { recursive: true });
    fs.mkdirSync(path.join(dir, "m15"), { recursive: true });
    const storeOld = path.join(store, "m15", "x.png.1.aaaa.part");
    const viewFresh = path.join(dir, "m15", "x.png.2.bbbb.part");
    const viewOld = path.join(dir, "m15", "x.png.3.cccc.part");
    for (const f of [storeOld, viewFresh, viewOld]) fs.writeFileSync(f, "half");
    age(storeOld, STALE_PART_MS + 1);
    age(viewOld, STALE_PART_MS + 1);
    await syncInto(dir, scripted({ [`${ORIGIN}/${OBJECT}`]: [200] }).fetchImpl);
    expect(fs.existsSync(storeOld)).toBe(false);
    expect(fs.existsSync(viewOld)).toBe(false);
    expect(fs.existsSync(viewFresh)).toBe(true);
  });
});

describe("devMissHint (frames-fetch's message when the dev bucket misses objects)", () => {
  const buckets = { production: "https://prod.example/frames", dev: "https://dev.example/frames" };

  it("names frames:restore-dev and the production --origin on a local run from dev", () => {
    const hint = devMissHint({ origin: buckets.dev, buckets, env: {} });
    expect(hint).toContain("npm run frames:restore-dev");
    expect(hint).toContain(`--origin ${buckets.production}`);
    expect(devMissHint({ origin: `${buckets.dev}/`, buckets, env: {} })).toBe(hint);
  });

  it("says nothing on CI or for another origin", () => {
    expect(devMissHint({ origin: buckets.dev, buckets, env: { CI: "true" } })).toBeNull();
    expect(devMissHint({ origin: buckets.production, buckets, env: {} })).toBeNull();
  });

  it("frames-fetch prints it after the summary", () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/frames-fetch.mjs"), "utf8");
    expect(src).toMatch(/console\.error\(summary\);\n {2}const hint = devMissHint\(\{ origin, buckets \}\);\n {2}if \(hint\) console\.error\(hint\);/);
  });
});

describe("syncFrameCache with the shared store (test:visual / test:parity)", () => {
  it("downloads once per machine: a second worktree is filled from the store with 0 fetches", async () => {
    const first = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    expect(await syncInto(path.join(tmp, "wt-1"), first.fetchImpl)).toMatchObject({ fetched: 1, cached: 0, shared: 0, failed: [] });
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
    expect(fs.existsSync(path.join(store, STORE_MARKER))).toBe(true);

    const second = scripted();
    expect(await syncInto(path.join(tmp, "wt-2"), second.fetchImpl)).toMatchObject({ fetched: 0, cached: 1, shared: 1, failed: [] });
    expect(second.calls).toEqual([]);
    expect(fs.readFileSync(path.join(tmp, "wt-2", OBJECT))).toEqual(BYTES);
    // ONE copy on disk: both worktrees' files are links to the store's.
    const ino = fs.statSync(path.join(store, OBJECT)).ino;
    expect(fs.statSync(path.join(tmp, "wt-1", OBJECT)).ino).toBe(ino);
    expect(fs.statSync(path.join(tmp, "wt-2", OBJECT)).ino).toBe(ino);

    // And the same worktree again: its own copy, nothing fetched.
    const third = scripted();
    expect(await syncInto(path.join(tmp, "wt-2"), third.fetchImpl)).toMatchObject({ fetched: 0, cached: 1, shared: 0 });
    expect(third.calls).toEqual([]);
  });

  it("re-fetches a CORRUPT store file and repairs the store", async () => {
    fs.mkdirSync(path.join(store, "m15"), { recursive: true });
    fs.writeFileSync(path.join(store, OBJECT), "bit rot");
    const { fetchImpl, calls } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    const dir = path.join(tmp, "wt");
    expect(await syncInto(dir, fetchImpl)).toMatchObject({ fetched: 1, shared: 0, failed: [] });
    expect(calls).toEqual([`${ORIGIN}/${OBJECT}`]);
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
    expect(fs.readFileSync(path.join(dir, OBJECT))).toEqual(BYTES);
  });

  it("re-fetches a PARTIAL (truncated) store file", async () => {
    fs.mkdirSync(path.join(store, "m15"), { recursive: true });
    fs.writeFileSync(path.join(store, OBJECT), BYTES.subarray(0, 10));
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    expect(await syncInto(path.join(tmp, "wt"), fetchImpl)).toMatchObject({ fetched: 1, failed: [] });
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
  });

  it("never keeps downloaded bytes that differ from the manifest, in the store or the worktree", async () => {
    const bad = Buffer.from("tampered");
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: Array(10).fill(bad) });
    const dir = path.join(tmp, "wt");
    const res = await syncInto(dir, fetchImpl);
    expect(res.failed).toHaveLength(1);
    expect(fs.existsSync(path.join(store, OBJECT))).toBe(false);
    expect(fs.existsSync(path.join(dir, OBJECT))).toBe(false);
  });

  it("an older worktree's checked copy seeds an empty store", async () => {
    const dir = path.join(tmp, "old-wt");
    fs.mkdirSync(path.join(dir, "m15"), { recursive: true });
    fs.writeFileSync(path.join(dir, OBJECT), BYTES);
    const { fetchImpl, calls } = scripted();
    expect(await syncInto(dir, fetchImpl)).toMatchObject({ fetched: 0, cached: 1, shared: 0 });
    expect(calls).toEqual([]);
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
  });

  it("prunes the worktree's folder to its manifest, never the store (other worktrees' manifests)", async () => {
    const other = path.join(store, "m15", "r.000000000000.png");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, "another manifest's object");
    const dir = path.join(tmp, "wt");
    fs.mkdirSync(path.join(dir, "m15"), { recursive: true });
    fs.writeFileSync(path.join(dir, "m15", "r.000000000000.png"), "an older manifest's object");
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    await syncInto(dir, fetchImpl);
    expect(fs.readdirSync(path.join(dir, "m15"))).toEqual([path.basename(OBJECT)]);
    expect(fs.existsSync(other)).toBe(true);
  });

  it("refuses the store as a worktree folder (that folder is pruned)", async () => {
    await expect(syncFrameCache({ entries: [[KEY, ENTRY]], origins: [ORIGIN], dir: store, store, fetchImpl: scripted().fetchImpl, sleep: noSleep })).rejects.toThrow(
      /shared frame store/,
    );
  });

  it("without a store (CI) behaves as before: straight into the folder", async () => {
    const dir = path.join(tmp, "ci");
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    const res = await syncFrameCache({ entries: [[KEY, ENTRY]], origins: [ORIGIN], dir, store: null, fetchImpl, sleep: noSleep });
    expect(res).toMatchObject({ fetched: 1, shared: 0 });
    expect(fs.readFileSync(path.join(dir, OBJECT))).toEqual(BYTES);
    expect(fs.existsSync(store)).toBe(false);
  });
});

describe("fetchManifestFile (frames-fetch → .frames-cache, the importer-build layout)", () => {
  const out = () => path.join(tmp, ".frames-cache");
  const get = (fetchImpl: (url: string) => Promise<Response>, opts: { store?: string | null; fallback?: string | null } = {}) =>
    fetchManifestFile({
      key: KEY,
      entry: ENTRY,
      out: out(),
      store: opts.store === undefined ? store : opts.store,
      origin: ORIGIN,
      fallback: opts.fallback ?? null,
      fetchOptions: { fetchImpl, baseDelayMs: 0, tries: 2 },
    });

  it("downloads into the store by object key and gives .frames-cache the manifest key", async () => {
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    expect(await get(fetchImpl)).toEqual({ from: "origin" });
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
    expect(fs.readFileSync(path.join(out(), KEY))).toEqual(BYTES);
  });

  it("shares the visual suite's store: an object it already holds costs no download", async () => {
    fs.mkdirSync(path.join(store, "m15"), { recursive: true });
    fs.writeFileSync(path.join(store, OBJECT), BYTES);
    const { fetchImpl, calls } = scripted();
    expect(await get(fetchImpl)).toEqual({ from: "shared" });
    expect(calls).toEqual([]);
    expect(fs.readFileSync(path.join(out(), KEY))).toEqual(BYTES);
  });

  it("keeps a checked copy, and re-fetches a corrupt one (the store's corrupt copy too)", async () => {
    fs.mkdirSync(path.join(out(), "m15"), { recursive: true });
    fs.writeFileSync(path.join(out(), KEY), BYTES);
    expect(await get(scripted().fetchImpl)).toEqual({ from: "kept" });

    // Both names are one read-only inode now: rot it past the mode.
    expect(fs.statSync(path.join(store, OBJECT)).mode & 0o777).toBe(0o444);
    fs.chmodSync(path.join(out(), KEY), 0o644);
    fs.writeFileSync(path.join(out(), KEY), "corrupt");
    fs.writeFileSync(path.join(store, OBJECT), "corrupt too");
    const { fetchImpl, calls } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    expect(await get(fetchImpl)).toEqual({ from: "origin" });
    expect(calls).toHaveLength(1);
    expect(fs.readFileSync(path.join(out(), KEY))).toEqual(BYTES);
    expect(fs.readFileSync(path.join(store, OBJECT))).toEqual(BYTES);
  });

  it("asks the fallback for what the origin lacks, and reports what neither has", async () => {
    const hit = scripted({ [`${FALLBACK}/${OBJECT}`]: [200] });
    expect(await get(hit.fetchImpl, { fallback: FALLBACK })).toEqual({ from: "fallback" });
    expect(hit.calls).toEqual([`${ORIGIN}/${OBJECT}`, `${FALLBACK}/${OBJECT}`]);

    fs.rmSync(tmp, { recursive: true, force: true });
    const miss = await get(scripted().fetchImpl, { fallback: FALLBACK });
    expect(miss).toEqual({ from: null, status: "404; fallback 404" });
  });

  it("with no store (CI) writes .frames-cache alone", async () => {
    const { fetchImpl } = scripted({ [`${ORIGIN}/${OBJECT}`]: [200] });
    expect(await get(fetchImpl, { store: null })).toEqual({ from: "origin" });
    expect(fs.readFileSync(path.join(out(), KEY))).toEqual(BYTES);
    expect(fs.existsSync(store)).toBe(false);
  });

  it("fromCheckoutOrStore never trusts a store copy by name", () => {
    fs.mkdirSync(path.join(store, "m15"), { recursive: true });
    fs.writeFileSync(path.join(store, OBJECT), "same name, other bytes");
    expect(fromCheckoutOrStore({ file: path.join(out(), KEY), storeFile: path.join(store, OBJECT), sha256: SHA })).toBeNull();
    expect(fs.existsSync(path.join(out(), KEY))).toBe(false);
  });
});
