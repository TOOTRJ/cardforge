import { afterEach, describe, expect, it, vi } from "vitest";
import { cardCacheTag, purgeCardCdnCache } from "@/lib/cards/cache-purge";

// The OG route stamps `Vercel-Cache-Tag: card-<id>` and every privatising /
// deleting / hiding action purges that tag. Pin the tag format (both sides
// import it, but a rename would still silently break old cached entries) and
// the off-Vercel no-op.

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
  });

  it("does nothing for an empty list even on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    await expect(purgeCardCdnCache([])).resolves.toBeUndefined();
  });
});
