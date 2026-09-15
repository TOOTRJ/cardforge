import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import {
  fetchStoredRender,
  fitStoredRender,
  hasCurrentStoredRender,
} from "@/lib/render/stored-render";

const STORAGE_URL =
  "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png?v=1";

describe("stored-render — when the baked PNG can stand in for a live render", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is current only with a URL at the renderer's layout version", () => {
    expect(
      hasCurrentStoredRender({ rendered_image_url: STORAGE_URL, layout_version: CARD_LAYOUT_VERSION }),
    ).toBe(true);
    expect(
      hasCurrentStoredRender({ rendered_image_url: STORAGE_URL, layout_version: CARD_LAYOUT_VERSION - 1 }),
    ).toBe(false);
    expect(hasCurrentStoredRender({ rendered_image_url: STORAGE_URL, layout_version: null })).toBe(false);
    expect(hasCurrentStoredRender({ rendered_image_url: null, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    expect(hasCurrentStoredRender({ rendered_image_url: "", layout_version: CARD_LAYOUT_VERSION })).toBe(false);
  });

  it("never fetches a stale row or a foreign host", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(
      await fetchStoredRender({ rendered_image_url: STORAGE_URL, layout_version: null }),
    ).toBeNull();
    expect(
      await fetchStoredRender({
        rendered_image_url: "https://evil.example/render.png",
        layout_version: CARD_LAYOUT_VERSION,
      }),
    ).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the PNG bytes of a current render on our storage host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://zkwkisxoqdhdchqyjwdc.supabase.co");
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } },
    })
      .png()
      .toBuffer();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
      ),
    );
    const bytes = await fetchStoredRender({
      rendered_image_url: STORAGE_URL,
      layout_version: CARD_LAYOUT_VERSION,
    });
    expect(bytes).not.toBeNull();
    expect(bytes!.equals(png)).toBe(true);
  });

  it("rejects a non-PNG or failed response", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://zkwkisxoqdhdchqyjwdc.supabase.co");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html" } })),
    );
    expect(
      await fetchStoredRender({ rendered_image_url: STORAGE_URL, layout_version: CARD_LAYOUT_VERSION }),
    ).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    expect(
      await fetchStoredRender({ rendered_image_url: STORAGE_URL, layout_version: CARD_LAYOUT_VERSION }),
    ).toBeNull();
  });

  it("serves hd bytes untouched and halves them for the default preset", async () => {
    const hd = await sharp({
      create: { width: 1500, height: 2100, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
    })
      .png()
      .toBuffer();
    expect((await fitStoredRender(hd, "hd", false)).equals(hd)).toBe(true);
    const portrait = await sharp(await fitStoredRender(hd, "default", false)).metadata();
    expect([portrait.width, portrait.height]).toEqual([750, 1050]);
    const landscapeHd = await sharp({
      create: { width: 2100, height: 1500, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const landscape = await sharp(await fitStoredRender(landscapeHd, "default", true)).metadata();
    expect([landscape.width, landscape.height]).toEqual([1050, 750]);
  });
});
