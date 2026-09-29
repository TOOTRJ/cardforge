import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { featuredImageOf } from "@/lib/featured/queries";

// ---------------------------------------------------------------------------
// Featured tiles (homepage hero, featured creators) are raw <img>s of a card's
// render columns. Migration 0126 lets only the service role set those, but a
// row written before it — when an owner could PATCH rendered_image_url /
// rendered_thumb_url through PostgREST — could point at an outside host (a
// viewer-IP tracking pixel on the homepage) or a raw card-art upload. Only a
// bake in our card-renders bucket is drawn; a card without one drops out.
// ---------------------------------------------------------------------------

const RENDERS = "https://auth.pipglyph.com/storage/v1/object/public/card-renders/o";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://auth.pipglyph.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("featuredImageOf", () => {
  it("prefers the thumb, then the PNG, when they are our bakes", () => {
    expect(
      featuredImageOf({ rendered_image_url: `${RENDERS}/c.png?v=1`, rendered_thumb_url: `${RENDERS}/c.thumb.webp?v=1` }),
    ).toBe(`${RENDERS}/c.thumb.webp?v=1`);
    expect(featuredImageOf({ rendered_image_url: `${RENDERS}/c.png?v=1`, rendered_thumb_url: null })).toBe(
      `${RENDERS}/c.png?v=1`,
    );
  });

  it("skips an outside thumb for our PNG", () => {
    expect(
      featuredImageOf({ rendered_image_url: `${RENDERS}/c.png?v=1`, rendered_thumb_url: "https://tracker.example/p.webp" }),
    ).toBe(`${RENDERS}/c.png?v=1`);
  });

  it("drops a card whose render isn't ours at all", () => {
    expect(featuredImageOf({ rendered_image_url: "https://tracker.example/p.png", rendered_thumb_url: null })).toBeNull();
    expect(
      featuredImageOf({
        rendered_image_url: "https://auth.pipglyph.com/storage/v1/object/public/card-art/o/raw.png",
        rendered_thumb_url: "https://auth.pipglyph.com/storage/v1/object/public/card-art/o/raw.png",
      }),
    ).toBeNull();
    expect(featuredImageOf({ rendered_image_url: null })).toBeNull();
  });
});
