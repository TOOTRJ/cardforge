import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assetOrigins,
  frameAssetPath,
  getFrameDataUrl,
  getPlateDataUrlForPath,
  plateAssetPath,
  preloadFrame,
  preloadFrameAssets,
  resetFrameAssetCacheForTests,
} from "@/lib/render/card-frames";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import type { CardPreviewData } from "@/components/cards/card-preview";

describe("card-frames — frame assets resolve from disk or the deployment CDN", () => {
  beforeEach(() => resetFrameAssetCacheForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("builds public paths the way the renderer references them", () => {
    expect(frameAssetPath("m15", "w")).toBe("/frames/m15/w.png");
    expect(frameAssetPath("m15", "nonsense")).toBe("/frames/m15/c.png");
    expect(plateAssetPath("/frames/m15/pt/{color}.png", "u")).toBe("/frames/m15/pt/u.png");
    expect(plateAssetPath("/frames/m15pw/loyaltyup.png", "g")).toBe("/frames/m15pw/loyaltyup.png");
  });

  it("orders fetch origins explicit → site URL → production, de-duplicated", () => {
    vi.stubEnv("RENDER_ASSET_ORIGIN", "assets.example.com/");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.pipglyph.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "www.pipglyph.com");
    expect(assetOrigins()).toEqual(["https://assets.example.com", "https://www.pipglyph.com"]);
  });

  it("reads real masters from disk without any fetch (local dev / tests)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await preloadFrame("m15", "w");
    await preloadFrameAssets(["/frames/m15/pt/w.png"]);
    expect(getFrameDataUrl("m15", "w").startsWith("data:image/png;base64,")).toBe(true);
    expect(getPlateDataUrlForPath("/frames/m15/pt/{color}.png", "w")).toMatch(/^data:image\/png;base64,/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the CDN for a path that is not on disk, and memoizes it", async () => {
    vi.stubEnv("RENDER_ASSET_ORIGIN", "https://cdn.example");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    const fetchSpy = vi.fn(async (input: string) =>
      input.endsWith("/frames/not-a-real-template/w.png")
        ? new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })
        : new Response(null, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await preloadFrame("not-a-real-template", "w");
    expect(getFrameDataUrl("not-a-real-template", "w")).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://cdn.example/frames/not-a-real-template/w.png");
    await preloadFrame("not-a-real-template", "w");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a protected preview's HTML answer as a miss and tries the next origin", async () => {
    vi.stubEnv("RENDER_ASSET_ORIGIN", "https://preview.example");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.pipglyph.com");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64",
    );
    const fetchSpy = vi.fn(async (input: string) =>
      input.startsWith("https://preview.example")
        ? new Response("<html>Vercel Authentication</html>", { status: 200, headers: { "content-type": "text/html" } })
        : new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await preloadFrameAssets(["/frames/not-a-real-template/pt/w.png"]);
    expect(getPlateDataUrlForPath("/frames/not-a-real-template/pt/{color}.png", "w")).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("lists the plates and loyalty badges a card's frame will ask for", () => {
    const base = {
      title: "T",
      cost: "{1}{W}",
      cardType: "creature",
      supertype: null,
      subtypes: ["Human"],
      rarity: "common",
      colorIdentity: ["white"],
      rulesText: "",
      flavorText: "",
      power: "1",
      toughness: "1",
      loyalty: null,
      defense: null,
      artistCredit: null,
      artUrl: null,
      frameStyle: { template: "m15" },
    } as unknown as CardPreviewData;
    expect(frameAssetPathsFor(base)).toEqual(["/frames/m15/pt/w.png"]);

    const walker = {
      ...base,
      cardType: "planeswalker",
      subtypes: ["Jace"],
      colorIdentity: ["blue"],
      loyalty: "3",
      rulesText: "+1: Draw a card.\n−2: Return target creature.\n0: Scry 1.",
      frameStyle: { template: "m15pw" },
    } as unknown as CardPreviewData;
    const paths = frameAssetPathsFor(walker);
    expect(paths).toContain("/frames/m15pw/loyaltyup.png");
    expect(paths).toContain("/frames/m15pw/loyaltydown.png");
    expect(paths).toContain("/frames/m15pw/loyaltynaught.png");
    expect(paths).toContain("/frames/m15pw/loyalty.png");
  });
});
