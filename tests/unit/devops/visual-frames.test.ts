import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncFrameCache } from "@/scripts/lib/visual-frames.mjs";

// ---------------------------------------------------------------------------
// scripts/lib/visual-frames.mjs — the visual-regression suite's frame cache
// (TODO 7.1). CI fills it from PRODUCTION's frames bucket (then dev's) on
// every manifest change, three jobs at once: a transient storage answer —
// a 429, a 5xx, a 400 for an object that is there — must not fail the run,
// and bytes that don't match the manifest must never be kept.
// ---------------------------------------------------------------------------

const PROD = "https://prod.example/frames";
const DEV = "https://dev.example/frames";

const BYTES = Buffer.from("not really a png");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const ENTRY = { hash: SHA.slice(0, 12), sha256: SHA, bytes: BYTES.byteLength };
const OBJECT = `m15/r.${ENTRY.hash}.png`;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "visual-frames-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A fetch that answers each URL from a script of statuses (200 = BYTES). */
function scripted(answers: Record<string, (number | Buffer)[]>) {
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

async function sync(fetchImpl: (url: string) => Promise<Response>) {
  return syncFrameCache({ entries: [["m15/r.png", ENTRY]], origins: [PROD, DEV], dir, fetchImpl, sleep: noSleep });
}

describe("syncFrameCache", () => {
  it("takes a frame not promoted yet from the dev bucket", async () => {
    const { fetchImpl, calls } = scripted({ [`${PROD}/${OBJECT}`]: [404], [`${DEV}/${OBJECT}`]: [200] });
    const res = await sync(fetchImpl);
    expect(res).toMatchObject({ fetched: 1, failed: [] });
    expect(calls).toEqual([`${PROD}/${OBJECT}`, `${DEV}/${OBJECT}`]);
    expect(fs.readFileSync(path.join(dir, OBJECT))).toEqual(BYTES);
  });

  it("gets past a burst of transient 400s on both buckets (the confirm pass)", async () => {
    // Storage answered 400 for objects that exist (the frames gate saw it):
    // the quick pass gives up on both origins, the confirm pass retries.
    const { fetchImpl } = scripted({ [`${PROD}/${OBJECT}`]: [400, 400, 200], [`${DEV}/${OBJECT}`]: [400] });
    const res = await sync(fetchImpl);
    expect(res.failed).toEqual([]);
    expect(res.fetched).toBe(1);
  });

  it("retries a 429 / 5xx instead of failing", async () => {
    const { fetchImpl } = scripted({ [`${PROD}/${OBJECT}`]: [429, 503, 200] });
    expect((await sync(fetchImpl)).failed).toEqual([]);
  });

  it("never keeps bytes that differ from the manifest's sha256", async () => {
    const bad = Buffer.from("tampered");
    const { fetchImpl } = scripted({ [`${PROD}/${OBJECT}`]: Array(10).fill(bad), [`${DEV}/${OBJECT}`]: Array(10).fill(bad) });
    const res = await sync(fetchImpl);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].error).toMatch(/sha256 differs/);
    expect(fs.existsSync(path.join(dir, OBJECT))).toBe(false);
  });

  it("fails an object neither bucket has, after a bounded confirm pass", async () => {
    const { fetchImpl, calls } = scripted({});
    const res = await sync(fetchImpl);
    expect(res.failed.map((f) => f.key)).toEqual(["m15/r.png"]);
    // quick: 1 per origin; confirm: 4 per origin.
    expect(calls).toHaveLength(10);
  });

  it("reuses a cached object whose bytes match, and drops files the manifest no longer names", async () => {
    fs.mkdirSync(path.join(dir, "m15"), { recursive: true });
    fs.writeFileSync(path.join(dir, OBJECT), BYTES);
    fs.writeFileSync(path.join(dir, "m15", "r.000000000000.png"), "an older manifest's object");
    const { fetchImpl, calls } = scripted({});
    const res = await sync(fetchImpl);
    expect(res).toMatchObject({ cached: 1, fetched: 0, failed: [] });
    expect(calls).toEqual([]);
    expect(fs.readdirSync(path.join(dir, "m15"))).toEqual([path.basename(OBJECT)]);
  });
});
