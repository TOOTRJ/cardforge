import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  FrameAssetUnavailableError,
  frameAssetCacheStatsForTests,
  getFrameDataUrl,
  getPlateDataUrlForPath,
  preloadFrame,
  preloadFrameAssets,
  resetFrameAssetCacheForTests,
} from "@/lib/render/card-frames";
import { setFrameStorageForTests, type FrameManifest } from "@/lib/frames/frame-url";

// ---------------------------------------------------------------------------
// The bake's third frame source (frames plan 4.2): a path listed in the
// frame manifest is fetched from its content-addressed bucket URL — never
// from disk or the deployment CDN — checked against the manifest's FULL
// sha256, and cached under that URL, so a republished frame (new hash) is
// picked up without a restart. A bucket failure is a fault: logged, never
// cached (the next render retries), and it fails the render instead of
// substituting another template's frame. The cache is a size-bounded LRU.
// ---------------------------------------------------------------------------

const ORIGIN = "https://bucket.example/frames";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const png = (r: number) =>
  sharp({ create: { width: 4, height: 4, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

let restore: () => void = () => {};
beforeEach(() => resetFrameAssetCacheForTests());
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function serve(objects: Record<string, Buffer | "error">) {
  const spy = vi.fn(async (url: string) => {
    const bytes = objects[url];
    if (bytes === "error") throw new Error("socket hang up");
    return bytes
      ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } })
      : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const objectUrl = (key: string, bytes: Buffer) => `${ORIGIN}/${key.replace(/\.(png|webp)$/, `.${sha(bytes).slice(0, 12)}.$1`)}`;

function manifestFor(files: Record<string, Buffer>): FrameManifest {
  return {
    version: 1,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, bytes]) => [
        key,
        { hash: sha(bytes).slice(0, 12), sha256: sha(bytes), bytes: bytes.length, width: 4, height: 4 },
      ]),
    ),
  };
}

describe("card-frames — bucket frames", () => {
  it("fetches a manifest frame from its content-addressed URL, not from disk or the CDN", async () => {
    // m15/w.png IS on disk; the manifest must win so the bake draws the
    // published bytes, exactly what the preview shows.
    const bytes = await png(200);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/w.png": bytes }), origin: ORIGIN });
    const spy = serve({ [objectUrl("m15/w.png", bytes)]: bytes });
    await preloadFrame("m15", "w");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(objectUrl("m15/w.png", bytes));
    expect(getFrameDataUrl("m15", "w")).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
  });

  it("refuses bytes that don't match the manifest sha256 and fails the render", async () => {
    const published = await png(10);
    const tampered = await png(250);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "saga/w.png": published }), origin: ORIGIN });
    const spy = serve({ [objectUrl("saga/w.png", published)]: tampered });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(preloadFrame("saga", "w")).rejects.toBeInstanceOf(FrameAssetUnavailableError);
    // Never the default template's (m15) master from disk instead.
    expect(() => getFrameDataUrl("saga", "w")).toThrow(FrameAssetUnavailableError);
    expect(spy.mock.calls.every(([url]) => String(url).startsWith(ORIGIN))).toBe(true);
  });

  it("does not cache a transient failure: the next render refetches and draws the published bytes", async () => {
    const bytes = await png(40);
    const url = objectUrl("saga/w.png", bytes);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "saga/w.png": bytes }), origin: ORIGIN });
    vi.spyOn(console, "error").mockImplementation(() => {});
    serve({ [url]: "error" });
    await expect(preloadFrame("saga", "w")).rejects.toBeInstanceOf(FrameAssetUnavailableError);
    const spy = serve({ [url]: bytes });
    await preloadFrame("saga", "w");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getFrameDataUrl("saga", "w")).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
  });

  it("fails preloadFrameAssets when a bucket plate is unavailable", async () => {
    const bytes = await png(5);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/pt/w.png": bytes }), origin: ORIGIN });
    serve({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(preloadFrameAssets(["/frames/m15/pt/w.png"])).rejects.toThrow(/m15\/pt\/w\.png/);
  });

  it("picks up a republished frame (new hash) without a restart", async () => {
    const v1 = await png(1);
    const v2 = await png(2);
    const spy = serve({ [objectUrl("m15/pt/w.png", v1)]: v1, [objectUrl("m15/pt/w.png", v2)]: v2 });
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/pt/w.png": v1 }), origin: ORIGIN });
    await preloadFrameAssets(["/frames/m15/pt/w.png"]);
    expect(getPlateDataUrlForPath("/frames/m15/pt/{color}.png", "w")).toContain(v1.toString("base64"));
    restore();
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/pt/w.png": v2 }), origin: ORIGIN });
    await preloadFrameAssets(["/frames/m15/pt/w.png"]);
    expect(getPlateDataUrlForPath("/frames/m15/pt/{color}.png", "w")).toContain(v2.toString("base64"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("logs and fails when a bucket frame has no origin configured", async () => {
    const bytes = await png(9);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "saga/w.png": bytes }), origin: null });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(preloadFrame("saga", "w")).rejects.toBeInstanceOf(FrameAssetUnavailableError);
    expect(err.mock.calls[0][0]).toMatch(/no frame origin/);
  });
});

describe("card-frames — cache", () => {
  it("stays within its size budget and keeps recently READ entries (LRU, not FIFO)", async () => {
    // 200 frames × ~1.4 MB data URLs ≈ 280 MB, over the 192 MB budget.
    const big = Buffer.alloc(1024 * 1024, 7);
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 200; i += 1) files[`t${i}/w.png`] = Buffer.concat([big, Buffer.from([i])]);
    restore = setFrameStorageForTests({ manifest: manifestFor(files), origin: ORIGIN });
    const spy = serve(Object.fromEntries(Object.entries(files).map(([k, b]) => [objectUrl(k, b), b])));
    for (let i = 0; i < 120; i += 1) await preloadFrameAssets([`/frames/t${i}/w.png`]);
    // Read the OLDEST entry, then keep inserting until eviction runs.
    expect(getPlateDataUrlForPath("/frames/t0/w.png", "w")).not.toBeNull();
    for (let i = 120; i < 200; i += 1) await preloadFrameAssets([`/frames/t${i}/w.png`]);
    const stats = frameAssetCacheStatsForTests();
    expect(stats.chars).toBeLessThanOrEqual(192 * 1024 * 1024);
    expect(stats.entries).toBeLessThan(200);
    const fetchesBefore = spy.mock.calls.length;
    // t0 was read recently → still cached (no refetch); t1 was not → evicted.
    await preloadFrameAssets(["/frames/t0/w.png"]);
    expect(spy.mock.calls.length).toBe(fetchesBefore);
    await preloadFrameAssets(["/frames/t1/w.png"]);
    expect(spy.mock.calls.length).toBe(fetchesBefore + 1);
  });
});
