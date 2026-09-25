import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
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
// from disk or the deployment CDN — checked against the manifest hash, and
// cached under that URL, so a republished frame (new hash) is picked up by a
// long-lived instance without a restart. The cache is size-bounded (LRU).
// ---------------------------------------------------------------------------

const ORIGIN = "https://bucket.example/frames";
const hash12 = (b: Buffer) => createHash("sha256").update(b).digest("hex").slice(0, 12);
const png = (r: number) =>
  sharp({ create: { width: 4, height: 4, channels: 4, background: { r, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();

let restore: () => void = () => {};
beforeEach(() => resetFrameAssetCacheForTests());
afterEach(() => {
  restore();
  vi.unstubAllGlobals();
});

function serve(objects: Record<string, Buffer>) {
  const spy = vi.fn(async (url: string) => {
    const bytes = objects[url];
    return bytes
      ? new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/png" } })
      : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function manifestFor(files: Record<string, Buffer>): FrameManifest {
  return {
    version: 1,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, bytes]) => [key, { hash: hash12(bytes), bytes: bytes.length, width: 4, height: 4 }]),
    ),
  };
}

describe("card-frames — bucket frames", () => {
  it("fetches a manifest frame from its content-addressed URL, not from disk or the CDN", async () => {
    // m15/w.png IS on disk; the manifest must win so the bake draws the
    // published bytes, exactly what the preview shows.
    const bytes = await png(200);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/w.png": bytes }), origin: ORIGIN });
    const url = `${ORIGIN}/m15/w.${hash12(bytes)}.png`;
    const spy = serve({ [url]: bytes });
    await preloadFrame("m15", "w");
    expect(spy).toHaveBeenCalledWith(url, expect.anything());
    expect(getFrameDataUrl("m15", "w")).toBe(`data:image/png;base64,${bytes.toString("base64")}`);
  });

  it("refuses bytes that don't match the manifest hash (transparent pixel, logged)", async () => {
    const published = await png(10);
    const tampered = await png(250);
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/w.png": published }), origin: ORIGIN });
    serve({ [`${ORIGIN}/m15/w.${hash12(published)}.png`]: tampered });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await preloadFrame("m15", "w");
    // Falls back to the default template's own entry → also missing → pixel.
    expect(getFrameDataUrl("m15", "w")).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(getFrameDataUrl("m15", "w")).not.toBe(`data:image/png;base64,${tampered.toString("base64")}`);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("picks up a republished frame (new hash) without a restart", async () => {
    const v1 = await png(1);
    const v2 = await png(2);
    const spy = serve({
      [`${ORIGIN}/m15/pt/w.${hash12(v1)}.png`]: v1,
      [`${ORIGIN}/m15/pt/w.${hash12(v2)}.png`]: v2,
    });
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/pt/w.png": v1 }), origin: ORIGIN });
    await preloadFrameAssets(["/frames/m15/pt/w.png"]);
    expect(getPlateDataUrlForPath("/frames/m15/pt/{color}.png", "w")).toContain(v1.toString("base64"));
    restore();
    restore = setFrameStorageForTests({ manifest: manifestFor({ "m15/pt/w.png": v2 }), origin: ORIGIN });
    await preloadFrameAssets(["/frames/m15/pt/w.png"]);
    expect(getPlateDataUrlForPath("/frames/m15/pt/{color}.png", "w")).toContain(v2.toString("base64"));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("never reads a manifest frame synchronously from disk when it wasn't preloaded", () => {
    restore = setFrameStorageForTests({
      manifest: { version: 1, bucket: "frames", files: { "m15/pt/w.png": { hash: "0123456789ab", bytes: 1, width: 1, height: 1 } } },
      origin: ORIGIN,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getPlateDataUrlForPath("/frames/m15/pt/{color}.png", "w")).toBeNull();
    expect(warn.mock.calls[0][0]).toContain("bucket object");
    warn.mockRestore();
  });
});

describe("card-frames — cache", () => {
  it("stays within its size budget (LRU) while keeping recent entries", async () => {
    // 200 frames × ~1.4 MB data URLs ≈ 280 MB, over the 192 MB budget: the
    // cache must evict the least recent entries and stay under it.
    const big = Buffer.alloc(1024 * 1024, 7);
    const files: Record<string, Buffer> = {};
    for (let i = 0; i < 200; i += 1) files[`t${i}/w.png`] = Buffer.concat([big, Buffer.from([i])]);
    restore = setFrameStorageForTests({ manifest: manifestFor(files), origin: ORIGIN });
    serve(Object.fromEntries(Object.entries(files).map(([k, b]) => [`${ORIGIN}/${k.replace(".png", `.${hash12(b)}.png`)}`, b])));
    for (const key of Object.keys(files)) await preloadFrameAssets([`/frames/${key}`]);
    const stats = frameAssetCacheStatsForTests();
    expect(stats.chars).toBeLessThanOrEqual(192 * 1024 * 1024);
    expect(stats.entries).toBeLessThan(200);
    // The most recent one is still cached (no refetch needed).
    expect(getPlateDataUrlForPath("/frames/t199/w.png", "w")).toBe(
      `data:image/png;base64,${files["t199/w.png"].toString("base64")}`,
    );
  });
});
