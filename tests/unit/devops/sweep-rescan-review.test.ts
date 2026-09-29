import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { imageModerationRequest } from "@/lib/moderation/image-scan-core";
import {
  MAX_CONSECUTIVE_FAILURES,
  ModerationKeyRefused,
  applyFlagged,
  createPacer,
  describeModerationError,
  moderateOnce,
  moderationUrl,
  referencesOf,
  rescanObjects,
  runReviewRescan,
} from "@/scripts/lib/review-rescan.mjs";
import { loadState, readManifest, reconcilePending, reviewList } from "@/scripts/lib/storage-orphans.mjs";
import { emptyDb, fakeDb, fakeStorage, fakeSupabase, type Obj, type StoredObject } from "./helpers/fake-supabase";

// ---------------------------------------------------------------------------
// TODO 3.14b, owner decision 2026-09-29 (b): `sweep-storage-orphans.mjs
// --rescan-review` runs the upload path's moderation scan over the sweep's
// review list (user-folder files whose names the server doesn't make — direct
// pre-0126 uploads that skipped the scan) and, with --apply, does to a flagged
// one exactly what the upload path does to a flagged upload: removes the
// object, and nothing else. Paced, retried, resumable. First the helpers
// against in-memory fakes, then the real CLI against a fake Supabase and a
// fake moderation API.
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/sweep-storage-orphans.mjs");
const DAY = 24 * 60 * 60 * 1000;
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MINTED = "0f1e2d3c-4b5a-4968-8776-655443322110";
const API_KEY = "sk-test-fake-moderation-key";
const PUB = (bucket: string, key: string) => `https://auth.pipglyph.com/storage/v1/object/public/${bucket}/${key}`;

type Listed = Obj & { contentType?: string };
const md5 = (text: string) => createHash("md5").update(text).digest("hex");
const listed = (bucket: string, p: string, contentType = "image/png", etag = `"${md5(`bytes of ${bucket}/${p}`)}"`): Listed => {
  const t = new Date(Date.now() - 400 * DAY).toISOString();
  return { bucket, path: p, size: 1000, etag, createdAt: t, updatedAt: t, lastModified: t, contentType };
};

/** A moderation API stand-in: answers by the file name in the URL. */
function fakeModeration(answerFor: (url: string) => unknown = verdictByName) {
  const requests: { model: string; input: { type: string; image_url: { url: string } }[] }[] = [];
  return {
    requests,
    moderate: async (request: (typeof requests)[number]) => {
      requests.push(request);
      const answer = answerFor(request.input[0].image_url.url);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}
function verdictByName(url: string) {
  if (url.includes("nsfw")) return { results: [{ flagged: true, categories: { sexual: true, violence: true } }] };
  if (url.includes("violent")) return { results: [{ flagged: true, categories: { violence: true } }] };
  return { results: [{ flagged: false, categories: {} }] };
}
const apiError = (status: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`Incorrect API key provided: ${API_KEY.slice(0, 6)}****`), { status, ...extra });
const noWait = { wait: async () => {} };

describe("pacing, URL and one scan", () => {
  it("spaces calls 60/perMinute seconds apart", async () => {
    let t = 0;
    const slept: number[] = [];
    const pacer = createPacer(60, {
      now: () => t,
      sleep: async (ms: number) => {
        slept.push(ms);
        t += ms;
      },
    });
    await pacer.wait();
    await pacer.wait();
    await pacer.wait();
    t += 5000; // a slow call: no wait needed after it
    await pacer.wait();
    expect(slept).toEqual([1000, 1000]);
    expect(() => createPacer(0)).toThrow(/per-minute/);
    expect(() => createPacer(601)).toThrow(/per-minute/);
  });

  it("the URL is the object's public URL, versioned by its eTag", () => {
    expect(moderationUrl(PUB("card-art", `${U1}/a.png`), { etag: `"${"a".repeat(32)}"` })).toBe(`${PUB("card-art", `${U1}/a.png`)}?v=${"a".repeat(32)}`);
    expect(moderationUrl(PUB("card-art", `${U1}/a.png`), { etag: '"abc-3"' })).toBe(`${PUB("card-art", `${U1}/a.png`)}?v=abc-3`);
  });

  it("retries 429 (Retry-After) and 5xx / no answer (2 s, 4 s, 8 s); a 4xx about the file is not retried", async () => {
    const slept: number[] = [];
    const sleep = async (ms: number) => void slept.push(ms);
    let calls = 0;
    const limited = await moderateOnce({
      moderate: async () => {
        calls += 1;
        if (calls === 1) throw apiError(429, { headers: new Headers({ "retry-after": "3" }) });
        return verdictByName("nsfw");
      },
      url: "u",
      sleep,
    });
    expect(limited).toEqual({ verdict: "flagged", categories: ["sexual"] });
    expect(slept).toEqual([3000]);

    slept.length = 0;
    const down = await moderateOnce({ moderate: async () => Promise.reject(apiError(503)), url: "u", sleep });
    expect(down).toEqual({ verdict: "error", error: "HTTP 503", transient: true });
    expect(slept).toEqual([2000, 4000, 8000]);

    slept.length = 0;
    const offline = await moderateOnce({ moderate: async () => Promise.reject(new TypeError("fetch failed")), url: "u", sleep });
    expect(offline).toEqual({ verdict: "error", error: "no answer (network error)", transient: true });

    slept.length = 0;
    const bad = await moderateOnce({ moderate: async () => Promise.reject(apiError(400, { code: "invalid_image_url" })), url: "u", sleep });
    expect(bad).toEqual({ verdict: "error", error: "HTTP 400 invalid_image_url" });
    expect(slept).toEqual([]);

    expect(await moderateOnce({ moderate: async () => ({ results: [] }), url: "u", sleep })).toEqual({ verdict: "error", error: "empty answer" });
  });

  it("a refused key stops the run — and no error text (a 401 quotes part of the key) is ever repeated", async () => {
    await expect(moderateOnce({ moderate: async () => Promise.reject(apiError(401)), url: "u" })).rejects.toBeInstanceOf(ModerationKeyRefused);
    await expect(moderateOnce({ moderate: async () => Promise.reject(apiError(401)), url: "u" })).rejects.not.toThrow(/sk-/);
    expect(describeModerationError(apiError(429, { code: "rate_limit_exceeded" }))).toBe("HTTP 429 rate_limit_exceeded");
    expect(describeModerationError(apiError(400, { code: "not a code: sk-abc" }))).toBe("HTTP 400");
  });
});

describe("rescanObjects — paced, resumable, never calls an error clean", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "rescan-"));
  });
  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });
  const publicUrl = (bucket: string, p: string) => PUB(bucket, p);

  it("scans each object once for its bytes; a re-run reuses verdicts, scans changed bytes and failed scans again", async () => {
    const statePath = path.join(tmp, "state.json");
    const objects = [listed("card-art", `${U1}/nsfw.jpg`), listed("card-art", `${U1}/fine.jpg`), listed("profile-media", `${U2}/flaky.png`)];
    let flaky = true;
    const mod = fakeModeration((url) => (url.includes("flaky") && flaky ? apiError(400) : verdictByName(url)));
    const state = loadState(statePath);
    const first = await rescanObjects({ objects, state, statePath, moderate: mod.moderate, publicUrl, pacer: noWait, sleep: async () => {} });
    expect(first.results.map((r: { obj: Obj; verdict: string }) => [r.obj.path, r.verdict])).toEqual([
      [`${U1}/nsfw.jpg`, "flagged"],
      [`${U1}/fine.jpg`, "clean"],
      [`${U2}/flaky.png`, "error"],
    ]);
    // Each request is the upload path's, for the versioned public URL.
    expect(mod.requests[0]).toEqual(imageModerationRequest(moderationUrl(PUB("card-art", `${U1}/nsfw.jpg`), objects[0])));
    // Saved per object, as it came.
    expect(loadState(statePath).objects).toMatchObject({
      [`card-art/${U1}/nsfw.jpg`]: { verdict: "flagged", categories: ["sexual"], etag: objects[0].etag },
      [`card-art/${U1}/fine.jpg`]: { verdict: "clean" },
      [`profile-media/${U2}/flaky.png`]: { verdict: "error", error: "HTTP 400" },
    });

    flaky = false;
    mod.requests.length = 0;
    const changed = [objects[0], { ...objects[1], etag: `"${md5("new bytes")}"` }, objects[2]];
    const second = await rescanObjects({ objects: changed, state: loadState(statePath), statePath, moderate: mod.moderate, publicUrl, pacer: noWait });
    expect(mod.requests.map((r) => r.input[0].image_url.url.split("?")[0].split("/").pop())).toEqual(["fine.jpg", "flaky.png"]);
    expect(second).toMatchObject({ scanned: 2, reused: 1 });
    expect(second.results.find((r: { obj: Obj }) => r.obj.path.endsWith("nsfw.jpg"))).toMatchObject({ verdict: "flagged", reused: true });
  });

  it("an image type the model can't read is recorded, never sent", async () => {
    const statePath = path.join(tmp, "state.json");
    const mod = fakeModeration();
    const out = await rescanObjects({
      objects: [listed("card-art", `${U1}/notes.txt`, "text/plain"), listed("card-art", `${U1}/logo.svg`, "image/svg+xml"), listed("card-art", `${U1}/x.jpg`, "image/jpeg; charset=binary")],
      state: loadState(statePath),
      statePath,
      moderate: mod.moderate,
      publicUrl,
      pacer: noWait,
    });
    expect(out.results.map((r: { verdict: string; contentType?: string }) => [r.verdict, r.contentType ?? null])).toEqual([
      ["unscannable", "text/plain"],
      ["unscannable", "image/svg+xml"],
      ["clean", null],
    ]);
    expect(mod.requests).toHaveLength(1);
  });

  it("stops at --limit, after 5 failures in a row that retries couldn't fix, and when the key is refused", async () => {
    const many = Array.from({ length: 8 }, (_, i) => listed("card-art", `${U1}/f${i}.png`));
    const limited = await rescanObjects({ objects: many, state: loadState(path.join(tmp, "a.json")), statePath: path.join(tmp, "a.json"), moderate: fakeModeration().moderate, publicUrl, pacer: noWait, limit: 3 });
    expect(limited).toMatchObject({ scanned: 3, notScanned: 5, stopped: null });

    const down = fakeModeration(() => apiError(503));
    const outage = await rescanObjects({ objects: many, state: loadState(path.join(tmp, "b.json")), statePath: path.join(tmp, "b.json"), moderate: down.moderate, publicUrl, pacer: noWait, sleep: async () => {} });
    expect(outage.scanned).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(outage.notScanned).toBe(8 - MAX_CONSECUTIVE_FAILURES);
    expect(outage.stopped).toMatch(/in a row failed/);

    const refused = fakeModeration(() => apiError(401));
    const key = await rescanObjects({ objects: many, state: loadState(path.join(tmp, "c.json")), statePath: path.join(tmp, "c.json"), moderate: refused.moderate, publicUrl, pacer: noWait });
    expect(refused.requests).toHaveLength(1);
    expect(key).toMatchObject({ scanned: 0, notScanned: 8 });
    expect(key.stopped).toMatch(/refused the key \(HTTP 401\)/);
    expect(key.stopped).not.toContain("sk-");
  });

  it("the review list is the sweep's: server-made names and odd shapes are never scanned", () => {
    const objects = [
      listed("card-art", `${U1}/${MINTED}.jpg`),
      listed("card-art", `${U1}/ai-${MINTED}.png`),
      listed("custom-pips", `${U1}/W.png`),
      listed("card-renders", `${U1}/${CARD}.png`),
      listed("card-art", "loose.jpg"),
      listed("card-art", `${U1}/nested/a.jpg`),
      listed("card-exports", `${U1}/export.png`),
      listed("card-art", `${U1}/my-photo.jpg`),
      listed("custom-pips", `${U1}/X.png`),
      listed("card-renders", `${U1}/poster.png`),
    ];
    expect(reviewList(objects).map((o: Obj) => `${o.bucket}/${o.path}`)).toEqual([
      `card-art/${U1}/my-photo.jpg`,
      `custom-pips/${U1}/X.png`,
      `card-renders/${U1}/poster.png`,
    ]);
  });
});

describe("applyFlagged — the upload path's consequence, nothing more", () => {
  let tmp = "";
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "rescan-apply-"));
  });
  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function setup(objects: Listed[], storageOpts: Parameters<typeof fakeStorage>[1] = {}) {
    const statePath = path.join(tmp, "state.json");
    const manifestPath = path.join(tmp, "manifest.jsonl");
    const state = loadState(statePath);
    state.objects = Object.fromEntries(
      objects.map((o) => [`${o.bucket}/${o.path}`, { etag: o.etag, verdict: o.path.includes("nsfw") ? "flagged" : "clean", categories: o.path.includes("nsfw") ? ["sexual"] : [] }]),
    );
    const storage = fakeStorage(objects, storageOpts);
    const run = (flagged: Listed[], references = new Map()) =>
      applyFlagged({ storage, flagged, references, state, statePath, manifestPath, target: "dev.example", run: "r1" });
    return { storage, state, statePath, manifestPath, run };
  }

  it("removes exactly the flagged object from its bucket — no other object, no row, no copy — and logs where it was used", async () => {
    const flagged = listed("card-art", `${U1}/nsfw.jpg`);
    const s = setup([flagged, listed("card-art", `${U1}/fine.jpg`), listed("profile-media", `${U1}/nsfw.jpg`)]);
    const usedBy = [{ table: "cards", column: "art_url", row: { id: CARD } }];
    const result = await s.run([flagged], new Map([[`card-art/${U1}/nsfw.jpg`, usedBy]]));
    expect(result).toMatchObject({ deleted: 1, failed: [] });
    // The upload path: `folder.remove([name])` — one object, its own bucket.
    expect(s.storage.removes).toEqual([[`card-art/${U1}/nsfw.jpg`]]);
    expect([...s.storage.store.keys()].sort()).toEqual([`card-art/${U1}/fine.jpg`, `profile-media/${U1}/nsfw.jpg`]);
    expect(readManifest(s.manifestPath)).toEqual([
      expect.objectContaining({
        bucket: "card-art",
        path: `${U1}/nsfw.jpg`,
        reason: "flagged by the moderation scan (sexual)",
        categories: ["sexual"],
        usedBy,
      }),
    ]);
    expect(loadState(s.statePath)).toMatchObject({ pending: null, deleted: 1, objects: { [`card-art/${U1}/nsfw.jpg`]: { verdict: "deleted" } } });
  });

  it("re-checks the object first: new bytes (the next run scans them) and a vanished file are kept; a clean one is refused", async () => {
    const changed = listed("card-art", `${U1}/nsfw-a.jpg`);
    const gone = listed("card-art", `${U1}/nsfw-b.jpg`);
    const s = setup([changed, gone]);
    s.storage.store.set(`card-art/${changed.path}`, { ...changed, etag: `"${md5("replaced")}"` });
    s.storage.store.delete(`card-art/${gone.path}`);
    const result = await s.run([changed, gone]);
    expect(result.deleted).toBe(0);
    expect(result.skipped.map((k: { why: string }) => k.why)).toEqual([
      "changed since it was scanned — the next run scans the new bytes",
      "already gone",
    ]);
    expect(s.storage.removes).toEqual([]);
    await expect(s.run([listed("card-art", `${U1}/fine.jpg`)])).rejects.toThrow(/not flagged/);
  });

  it("a failed delete stays pending; the next run settles it", async () => {
    const flagged = listed("card-art", `${U1}/nsfw.jpg`);
    const s = setup([flagged], { removeFails: true });
    const result = await s.run([flagged]);
    expect(result.failed).toHaveLength(1);
    const state = loadState(s.statePath);
    expect(state.pending.items).toMatchObject([{ path: `${U1}/nsfw.jpg`, reason: "flagged by the moderation scan (sexual)" }]);
    s.storage.store.delete(`card-art/${U1}/nsfw.jpg`);
    expect(await reconcilePending({ storage: s.storage, state, statePath: s.statePath, manifestPath: s.manifestPath, target: "dev.example" })).toEqual({
      gone: 1,
      present: 0,
    });
  });

  it("referencesOf names every row that points at a flagged file", async () => {
    const db = emptyDb();
    db.cards.rows.push({ id: CARD, art_url: `${PUB("card-art", `${U1}/nsfw.jpg`)}?v=2` });
    db.profiles.rows.push({ id: U1, avatar_url: PUB("card-art", `${U1}/elsewhere.png`) });
    db.messages.rows.push({ id: "m1", body: `look ${PUB("card-art", `${U1}/nsfw.jpg`)}` });
    const where = await referencesOf(fakeDb(db), [listed("card-art", `${U1}/nsfw.jpg`)]);
    expect(where.get(`card-art/${U1}/nsfw.jpg`)).toEqual([
      { table: "cards", column: "art_url", row: { id: CARD } },
      { table: "messages", column: "body", row: { id: "m1" } },
    ]);
  });
});

describe("runReviewRescan — the whole mode, in process", () => {
  it("asks for the moderation key only when something needs a scan, and never touches the database's rows", async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "rescan-run-"));
    try {
      const objects = [listed("card-art", `${U1}/${MINTED}.jpg`), listed("card-renders", `${U1}/${CARD}.png`)];
      const storage = { ...fakeStorage(objects), async *list(bucket: string) { yield* objects.filter((o) => o.bucket === bucket); } };
      let asked = 0;
      const lines: string[] = [];
      const code = await runReviewRescan({
        storage,
        db: fakeDb(emptyDb()),
        buckets: ["card-art", "card-renders"],
        apply: true,
        confirm: async () => "yes",
        moderateFor: async () => {
          asked += 1;
          return fakeModeration().moderate;
        },
        publicUrl: PUB,
        state: loadState(path.join(tmp, "s.json")),
        statePath: path.join(tmp, "s.json"),
        manifestPath: path.join(tmp, "m.jsonl"),
        target: "dev.example",
        targetLabel: "dev",
        run: "r1",
        log: (...args: unknown[]) => void lines.push(String(args[0])),
      });
      expect(code).toBe(0);
      expect(asked).toBe(0);
      expect(lines.join("\n")).toMatch(/Review list: 0 user-folder object\(s\)/);
      expect(lines.join("\n")).toMatch(/Nothing flagged — nothing to delete/);
      expect(existsSync(path.join(tmp, "m.jsonl"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- the CLI against a fake Supabase and a fake moderation API ------------------------------

describe("sweep-storage-orphans.mjs --rescan-review against a fake Supabase", () => {
  let tmp = "";
  let supabase: Server;
  let moderation: Server;
  let base = "";
  const store = new Map<string, StoredObject>();
  const db = emptyDb();
  const rest: string[] = [];
  const asked: { auth: string | undefined; body: { model: string; input: { type: string; image_url: { url: string } }[] } }[] = [];
  const put = (key: string, contentType = "image/png") => {
    const t = new Date(Date.now() - 400 * DAY).toISOString();
    const bytes = Buffer.from(`bytes:${key}`);
    store.set(key, { bytes, etag: `"${md5(`bytes:${key}`)}"`, created: t, updated: t, contentType });
  };

  function run(args: string[], input = "", env = "env"): Promise<{ code: number | null; out: string }> {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", SCRIPT, "--rescan-review", "--env-file", path.join(tmp, env), ...args], {
        cwd: ROOT,
        env: { ...process.env, HOME: tmp, OPENAI_API_KEY: "sk-from-the-shell-never-used", OPENAI_BASE_URL: "http://127.0.0.1:9/never" },
      });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
      child.stdin.end(input);
    });
  }
  const files = (name = "state") => ["--state", path.join(tmp, `${name}.json`), "--manifest", path.join(tmp, `${name}.manifest.jsonl`), "--per-minute", "600"];

  beforeAll(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "rescan-cli-"));
    put(`card-art/${U1}/nsfw-photo.jpg`, "image/jpeg"); // a direct upload: flagged, and a card uses it
    put(`card-art/${U1}/violent-art.jpg`, "image/jpeg"); // violence only: clean (owner's categories)
    put(`profile-media/${U2}/avatar.png`); // a direct upload: clean, a profile uses it
    put(`card-art/${U1}/notes.txt`, "text/plain"); // not an image the model reads
    put(`card-art/${U1}/${MINTED}.jpg`, "image/jpeg"); // server-made: scanned at upload, never again
    put(`card-art/loose-nsfw.jpg`, "image/jpeg"); // outside the {uuid}/{file} shape: not on the list
    db.cards.rows.push({ id: CARD, art_url: `${PUB("card-art", `${U1}/nsfw-photo.jpg`)}?v=1` });
    db.profiles.rows.push({ id: U2, avatar_url: PUB("profile-media", `${U2}/avatar.png`) });

    supabase = fakeSupabase(store, db, { onRest: (method, table) => rest.push(`${method} ${table}`) });
    moderation = createServer((req, res) => {
      const parts: Buffer[] = [];
      req.on("data", (d) => parts.push(d));
      req.on("end", () => {
        const body = JSON.parse(Buffer.concat(parts).toString() || "{}");
        asked.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "modr-1", model: "omni-moderation-latest", ...verdictByName(body.input?.[0]?.image_url?.url ?? "") }));
      });
    });
    await new Promise<void>((resolve) => supabase.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => moderation.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(supabase.address() as AddressInfo).port}`;
    const modBase = `http://127.0.0.1:${(moderation.address() as AddressInfo).port}/v1`;
    writeFileSync(path.join(tmp, "env"), `NEXT_PUBLIC_SUPABASE_URL=${base}\nSUPABASE_SECRET_KEY=sb_secret_fake\nOPENAI_API_KEY=${API_KEY}\nOPENAI_BASE_URL=${modBase}\n`);
    writeFileSync(path.join(tmp, "env-no-key"), `NEXT_PUBLIC_SUPABASE_URL=${base}\nSUPABASE_SECRET_KEY=sb_secret_fake\n`);
    writeFileSync(path.join(tmp, "prod-env"), `NEXT_PUBLIC_SUPABASE_URL=https://zkwkisxoqdhdchqyjwdc.supabase.co\nSUPABASE_SECRET_KEY=x\nOPENAI_API_KEY=${API_KEY}\n`);
  });

  afterAll(async () => {
    await new Promise((resolve) => supabase?.close(resolve));
    await new Promise((resolve) => moderation?.close(resolve));
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("refuses production through the dev path, a production run without a terminal, and flags that don't apply", async () => {
    expect((await run([], "", "prod-env")).out).toMatch(/points at PRODUCTION/);
    const prod = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const child = spawn(process.execPath, ["--no-warnings", SCRIPT, "--rescan-review", "--target", "prod"], { cwd: ROOT, env: { ...process.env, HOME: tmp } });
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => resolve({ code, out }));
      child.stdin.end(`sb_secret_typed_into_a_pipe\n${API_KEY}\n`);
    });
    expect(prod.code).toBe(1);
    expect(prod.out).toMatch(/hidden prompt/);
    expect(prod.out).not.toContain("sb_secret_typed_into_a_pipe");
    expect(prod.out).not.toContain(API_KEY);
    for (const [flags, message] of [
      [["--backup-dir", path.join(os.tmpdir(), "x")], /--backup-dir doesn't apply to --rescan-review: a flagged file is never copied/],
      [["--batch-size", "10"], /--batch-size doesn't apply to --rescan-review/],
      [["--min-age-days", "30"], /--min-age-days doesn't apply to --rescan-review/],
      [["--per-minute", "0"], /--per-minute must be a whole number from 1 to 600/],
      [["--bucket", "frames"], /never swept/],
    ] as const) {
      const r = await run([...files("refused"), ...flags]);
      expect(r.code, flags.join(" ")).toBe(1);
      expect(r.out).toMatch(message);
    }
    expect(asked).toEqual([]);
    expect(rest).toEqual([]);
  });

  it("production's moderation key comes only from the hidden prompt and only goes to api.openai.com (no terminal here to run it)", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const body = source.slice(source.indexOf("async function moderateFor()"), source.indexOf("// --- run ---"));
    expect(body).toMatch(/if \(target === "prod"\) \{\n\s+apiKey = await promptHidden\(/);
    expect(body).toMatch(/baseURL: target === "prod" \? "https:\/\/api\.openai\.com\/v1" :/);
    expect(body).not.toMatch(/process\.env/);
    // …and the dev env file is never read for production (--env-file is refused there).
    expect(source).toMatch(/if \(values\.has\("--env-file"\)\) fail\("--env-file is for the dev target/);
  });

  it("without a moderation key nothing is scanned (the upload path's fail-open would call every file clean)", async () => {
    const { code, out } = await run(files("no-key"), "", "env-no-key");
    expect(code).toBe(1);
    expect(out).toMatch(/has no OPENAI_API_KEY and there is no terminal to ask for one — nothing is scanned without it/);
    expect(asked).toEqual([]);
  });

  it("dry run: scans the review list only, with the upload path's request, and reports flagged files by path and category", async () => {
    const before = [...store.keys()].sort();
    const { code, out } = await run(files());
    expect(code).toBe(0);
    expect(out).toMatch(/--rescan-review dry run/);
    expect(out).toMatch(/Review list: 4 user-folder object\(s\) with a name the server doesn't make \(card-art 3, profile-media 1\) of 6 listed\./);
    expect(out).toMatch(/1 object\(s\) outside the \{uuid\}\/\{file\} shape are not on the review list/);
    expect(out).toMatch(/Clean 2 · flagged 1 · can't be scanned 1 · scan failed 0\./);
    expect(out).toContain(`can't be scanned: card-art/${U1}/notes.txt  (text/plain)`);
    expect(out).toMatch(new RegExp(`card-art/${U1}/nsfw-photo\\.jpg\\s+\\S+ B\\s+sexual\\n\\s+named by cards\\.art_url \\(id ${CARD}\\)`));
    expect(out).toMatch(/Dry run: nothing deleted/);
    expect(out).not.toContain(API_KEY);
    expect(out).not.toContain("bytes:"); // no file content, ever
    // Three scans — the three images on the list, never the server-made name
    // or the loose file — each the upload path's request for the public URL.
    const scanned = asked.map((a) => a.body.input[0].image_url.url);
    expect(scanned.map((u) => u.split("?")[0].slice(`${base}/storage/v1/object/public/`.length)).sort()).toEqual(
      [`card-art/${U1}/nsfw-photo.jpg`, `card-art/${U1}/violent-art.jpg`, `profile-media/${U2}/avatar.png`].sort(),
    );
    for (const a of asked) {
      expect(a.body).toEqual(imageModerationRequest(a.body.input[0].image_url.url));
      expect(a.auth).toBe(`Bearer ${API_KEY}`); // the env file's key, never the shell's
    }
    expect(scanned.find((u) => u.includes("nsfw-photo"))).toBe(`${base}/storage/v1/object/public/card-art/${U1}/nsfw-photo.jpg?v=${md5(`bytes:card-art/${U1}/nsfw-photo.jpg`)}`);
    expect([...store.keys()].sort()).toEqual(before);
    expect(rest.filter((r) => !r.startsWith("GET"))).toEqual([]);
  });

  it("a re-run reuses every verdict (no second scan); --apply without yes deletes nothing", async () => {
    const calls = asked.length;
    const again = await run(files());
    expect(again.out).toMatch(/All 4 already have a verdict for their current bytes/);
    const no = await run([...files(), "--apply"], "no\n");
    expect(no.code).toBe(1);
    expect(no.out).toMatch(/Aborted — nothing deleted/);
    expect(asked.length).toBe(calls);
    expect(store.has(`card-art/${U1}/nsfw-photo.jpg`)).toBe(true);
  });

  it("--apply removes the flagged file and nothing else: no other object, no row", async () => {
    const calls = asked.length;
    const { code, out } = await run([...files(), "--apply"], "yes\n");
    expect(code).toBe(0);
    expect(out).toMatch(/Delete 1 flagged object\(s\) from dev .* The rows that name them are not changed/);
    expect(out).toMatch(/Deleted 1 flagged object\(s\)/);
    expect(store.has(`card-art/${U1}/nsfw-photo.jpg`)).toBe(false);
    for (const kept of [
      `card-art/${U1}/violent-art.jpg`,
      `profile-media/${U2}/avatar.png`,
      `card-art/${U1}/notes.txt`,
      `card-art/${U1}/${MINTED}.jpg`,
      `card-art/loose-nsfw.jpg`,
    ]) {
      expect(store.has(kept), kept).toBe(true);
    }
    // The card still names it — the upload path never changes a row either.
    expect(db.cards.rows[0].art_url).toBe(`${PUB("card-art", `${U1}/nsfw-photo.jpg`)}?v=1`);
    expect(rest.filter((r) => !r.startsWith("GET"))).toEqual([]);
    expect(asked.length).toBe(calls);
    expect(readManifest(path.join(tmp, "state.manifest.jsonl"))).toEqual([
      expect.objectContaining({
        bucket: "card-art",
        path: `${U1}/nsfw-photo.jpg`,
        reason: "flagged by the moderation scan (sexual)",
        categories: ["sexual"],
        usedBy: [{ table: "cards", column: "art_url", row: { id: CARD } }],
      }),
    ]);
    const state = JSON.parse(readFileSync(path.join(tmp, "state.json"), "utf8"));
    expect(state.objects[`card-art/${U1}/nsfw-photo.jpg`].verdict).toBe("deleted");
    expect(state.pending).toBeNull();
  });
});
