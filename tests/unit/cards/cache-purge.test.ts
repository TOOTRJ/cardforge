import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The OG route AND the /render-cdn proxy stamp `Vercel-Cache-Tag: card-<id>`
// and every privatising / deleting / hiding action purges that tag. Pin the
// tag format (both sides import it, but a rename would still silently break
// old cached entries), the off-Vercel no-op, and the chunking: Vercel takes
// at most 16 tags per purge call, and a bulk action or an account deletion
// can name hundreds of cards.

const vercel = vi.hoisted(() => ({
  deleteByTag: vi.fn(async (tags: string | string[]) => void tags),
  deleteBySrc: vi.fn(async (srcs: string | string[]) => void srcs),
}));
vi.mock("@vercel/functions", () => ({
  dangerouslyDeleteByTag: vercel.deleteByTag,
  dangerouslyDeleteBySrcImage: vercel.deleteBySrc,
}));

import { PURGE_TAGS_PER_CALL, cardCacheTag, purgeCardCdnCache, purgeImageSources } from "@/lib/cards/cache-purge";

beforeEach(() => {
  vercel.deleteByTag.mockReset().mockResolvedValue(undefined);
  vercel.deleteBySrc.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("cardCacheTag", () => {
  it("is card-<id>", () => {
    expect(cardCacheTag("94c70f23-0ca9-425e-a53a-6c09921c0075")).toBe(
      "card-94c70f23-0ca9-425e-a53a-6c09921c0075",
    );
  });
});

describe("purgeCardCdnCache", () => {
  it("is a no-op off Vercel (local dev, CI) and never throws", async () => {
    vi.stubEnv("VERCEL", "");
    await expect(purgeCardCdnCache(["a", "b"])).resolves.toBeUndefined();
    expect(vercel.deleteByTag).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list even on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    await expect(purgeCardCdnCache([])).resolves.toBeUndefined();
    expect(vercel.deleteByTag).not.toHaveBeenCalled();
  });

  it("deletes (not invalidates) the card tags, at most 16 per call, each card once", async () => {
    vi.stubEnv("VERCEL", "1");
    const ids = Array.from({ length: 35 }, (_, i) => `id-${i}`);
    await purgeCardCdnCache([...ids, "id-0"]);
    expect(PURGE_TAGS_PER_CALL).toBe(16);
    expect(vercel.deleteByTag.mock.calls.map(([tags]) => (tags as string[]).length)).toEqual([16, 16, 3]);
    expect(vercel.deleteByTag.mock.calls.flatMap(([tags]) => tags as string[])).toEqual(ids.map(cardCacheTag));
  });

  it("logs a purge failure instead of throwing (the write it follows already happened)", async () => {
    vi.stubEnv("VERCEL", "1");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vercel.deleteByTag.mockRejectedValueOnce(new Error("purge API down"));
    await expect(purgeCardCdnCache(["a"])).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("purgeImageSources", () => {
  it("deletes Image Optimization variants by source URL, chunked, on Vercel only", async () => {
    vi.stubEnv("VERCEL", "");
    await purgeImageSources(["https://a/x.png"]);
    expect(vercel.deleteBySrc).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL", "1");
    const srcs = Array.from({ length: 17 }, (_, i) => `https://auth.pipglyph.com/storage/v1/object/public/card-art/u/${i}.png`);
    await purgeImageSources([...srcs, srcs[0], ""]);
    expect(vercel.deleteBySrc.mock.calls.map(([s]) => s)).toEqual([srcs.slice(0, 16), srcs.slice(16)]);
  });
});
