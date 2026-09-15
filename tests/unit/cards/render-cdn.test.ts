import { describe, expect, it, vi } from "vitest";
import { toRenderCdnUrl } from "@/lib/cards/render-cdn";

describe("toRenderCdnUrl", () => {
  it("maps our storage hosts onto the immutable proxy path, keeping the ?v stamp", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    expect(
      toRenderCdnUrl("https://auth.pipglyph.com/storage/v1/object/public/card-renders/o/c.thumb.webp?v=12"),
    ).toBe("/render-cdn/o/c.thumb.webp?v=12");
    expect(
      toRenderCdnUrl("https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png"),
    ).toBe("/render-cdn/o/c.png");
  });

  it("leaves foreign hosts, other buckets and odd paths untouched", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    const foreign = "https://evil.example/storage/v1/object/public/card-renders/o/c.png";
    expect(toRenderCdnUrl(foreign)).toBe(foreign);
    const art = "https://auth.pipglyph.com/storage/v1/object/public/card-art/o/a.webp";
    expect(toRenderCdnUrl(art)).toBe(art);
    const dots = "https://auth.pipglyph.com/storage/v1/object/public/card-renders/../x.png";
    expect(toRenderCdnUrl(dots)).toBe(dots);
    expect(toRenderCdnUrl(null)).toBeNull();
    expect(toRenderCdnUrl("not a url")).toBe("not a url");
  });
});
