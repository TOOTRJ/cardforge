import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import {
  fetchStoredRender,
  fitStoredRender,
  hasServableStoredRender,
} from "@/lib/render/stored-render";

const STORAGE_URL =
  "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/card-renders/o/c.png?v=1";

describe("stored-render — when the baked PNG can stand in for a live render", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is servable with a URL and no pending platform correction", () => {
    // "saga" (regular finish) is outside the v24/v25 template scopes and the
    // v26 etched scope, so only the v22 opt-in and the v23 commons sweep
    // apply — the scenarios these cases pin.
    const untouched = { frame_style: { template: "saga" }, rarity: "uncommon" };
    expect(
      hasServableStoredRender({ ...untouched, rendered_image_url: STORAGE_URL, layout_version: CARD_LAYOUT_VERSION }),
    ).toBe(true);
    // TODO 0.21: an owner who hasn't accepted the v22 (opt-in) look keeps it —
    // the download serves the bake and matches the gallery tile.
    expect(hasServableStoredRender({ ...untouched, rendered_image_url: STORAGE_URL, layout_version: 21 })).toBe(true);
    // A pending SWEEP correction (v23 set mark on a common) renders live.
    expect(
      hasServableStoredRender({ ...untouched, rarity: "common", rendered_image_url: STORAGE_URL, layout_version: 22 }),
    ).toBe(false);
    // v20 bakes may be CLEAN (the 2026-09-16 sweep ran with billing off; v21
    // re-swept them): the pending v21 sweep keeps them from free downloads.
    expect(hasServableStoredRender({ ...untouched, rendered_image_url: STORAGE_URL, layout_version: 20 })).toBe(false);
    // A frame-geometry change (null stamp) renders live until the re-bake.
    expect(hasServableStoredRender({ ...untouched, rendered_image_url: STORAGE_URL, layout_version: null })).toBe(false);
    expect(hasServableStoredRender({ ...untouched, rendered_image_url: null, layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    expect(hasServableStoredRender({ ...untouched, rendered_image_url: "", layout_version: CARD_LAYOUT_VERSION })).toBe(false);
    // A row that doesn't carry frame_style can't be judged by the template or
    // finish scopes: every bump counts, so a pre-v26 bake renders live.
    expect(
      hasServableStoredRender({ rarity: "uncommon", rendered_image_url: STORAGE_URL, layout_version: CARD_LAYOUT_VERSION - 1 }),
    ).toBe(false);
    // An etched card at v25 still owes the v26 re-bake; a regular one doesn't.
    const etched = { frame_style: { template: "saga", finish: "etched" }, rarity: "uncommon" };
    expect(hasServableStoredRender({ ...etched, rendered_image_url: STORAGE_URL, layout_version: 25 })).toBe(false);
    expect(hasServableStoredRender({ ...untouched, rendered_image_url: STORAGE_URL, layout_version: 25 })).toBe(true);
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

  it("serves any bake for display surfaces with accept: any", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://zkwkisxoqdhdchqyjwdc.supabase.co");
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const fetchSpy = vi.fn(async () =>
      new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    // Marked by a geometry change: not servable for a download…
    const stale = { rendered_image_url: STORAGE_URL, layout_version: null };
    expect(await fetchStoredRender(stale)).toBeNull();
    // …but the share image shows it, like the gallery tile does.
    const bytes = await fetchStoredRender(stale, { accept: "any" });
    expect(bytes?.equals(png)).toBe(true);
    // Still nothing without a bake at all, stale or not.
    expect(
      await fetchStoredRender({ rendered_image_url: null, layout_version: null }, { accept: "any" }),
    ).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
