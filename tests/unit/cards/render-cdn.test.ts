import { describe, expect, it, vi } from "vitest";
import { isStoredRenderUrl, storedRenderObject, toRenderCdnUrl } from "@/lib/cards/render-cdn";

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

// The display-side twin of migration 0126's cards_guard_render_columns: a
// surface that draws rendered_image_url / rendered_thumb_url checks it is a
// bake in OUR card-renders bucket first (a row written before 0126 could
// point anywhere).
describe("isStoredRenderUrl", () => {
  const ours = "https://auth.pipglyph.com/storage/v1/object/public/card-renders";

  it("accepts a bake in card-renders on our current or legacy storage host", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    expect(isStoredRenderUrl(`${ours}/o/c.png?v=1`)).toBe(true);
    expect(isStoredRenderUrl(`${ours}/o/c.thumb.webp?v=1`)).toBe(true);
    expect(
      isStoredRenderUrl("https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png"),
    ).toBe(true);
    expect(storedRenderObject(`${ours}/o/c.png?v=1`)).toBe("o/c.png");
  });

  it("accepts the local stack's loopback host when that is the configured one", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    expect(isStoredRenderUrl("http://127.0.0.1:54321/storage/v1/object/public/card-renders/o/c.png")).toBe(true);
  });

  it.each([
    ["an outside host", "https://tracker.example/storage/v1/object/public/card-renders/o/c.png"],
    ["another Supabase project", "https://evil.supabase.co/storage/v1/object/public/card-renders/o/c.png"],
    ["card-art on our host", "https://auth.pipglyph.com/storage/v1/object/public/card-art/o/c.png"],
    ["profile-media on our host", "https://auth.pipglyph.com/storage/v1/object/public/profile-media/o/a.png"],
    ["a traversal", "https://auth.pipglyph.com/storage/v1/object/public/card-renders/../card-art/o/c.png"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "/renders/c.png"],
    ["nothing", null],
  ])("refuses %s", (_label, url) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    expect(isStoredRenderUrl(url)).toBe(false);
  });

  it("with a card, only that card's own PNG or thumb", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
    const card = { ownerId: "o", cardId: "c" };
    expect(isStoredRenderUrl(`${ours}/o/c.png?v=1`, card)).toBe(true);
    expect(isStoredRenderUrl(`${ours}/o/c.thumb.webp?v=1`, card)).toBe(true);
    expect(isStoredRenderUrl(`${ours}/o/other.png`, card)).toBe(false);
    expect(isStoredRenderUrl(`${ours}/x/c.png`, card)).toBe(false);
    expect(isStoredRenderUrl(`${ours}/o/c.jpg`, card)).toBe(false);
    expect(isStoredRenderUrl(`${ours}/o/nested/c.png`, card)).toBe(false);
  });
});
