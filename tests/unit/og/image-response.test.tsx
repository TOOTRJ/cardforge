import { ImageResponse } from "next/og";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OG_SIZE } from "@/lib/brand/constants";
import { OgBody, OgEyebrow, OgShell, OgTitle } from "@/lib/og/chrome";
import { HomeOgCard } from "@/lib/og/home-card";
import { ogImageResponse } from "@/lib/og/image-response";
import { renderCardSocialImage } from "@/lib/og/card-social";

// ---------------------------------------------------------------------------
// TODO 6.16a for the Node OG images: ogImageResponse renders what next/og's
// ImageResponse rendered (same satori, same default Geist, same rasterizer)
// but never fetches a font or an emoji for user text. And the EDGE images,
// which keep next/og, only draw copy the default font covers — so they never
// reach next/og's network loader either.
// ---------------------------------------------------------------------------

const requests: Array<[string, string]> = [];
vi.mock("@/lib/render/fallback-assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/fallback-assets")>();
  return {
    ...real,
    loadLocalAdditionalAsset: (code: string, text: string) => {
      requests.push([code, text]);
      return real.loadLocalAdditionalAsset(code, text);
    },
  };
});

// Any network request throws. (next/og instantiates its layout engine from a
// `data:` URL through fetch — that one is not the network and passes.)
const realFetch = globalThis.fetch;
const fetchSpy = vi.fn((input: RequestInfo | URL): Promise<Response> => {
  throw new Error(`render-time fetch: ${String(input).slice(0, 80)}`);
});

beforeEach(() => {
  requests.length = 0;
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith("data:") ? realFetch(input, init) : fetchSpy(input),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

function deckCard(title: string) {
  return (
    <OgShell>
      <OgEyebrow>Commander deck</OgEyebrow>
      <OgTitle text={title} />
      <OgBody>Real decks rebuilt with custom cards — every one of them.</OgBody>
      <OgBody tone="dim">by @probe_user</OgBody>
    </OgShell>
  );
}

describe("ogImageResponse", () => {
  it("renders the same PNG bytes as next/og's ImageResponse for text its font covers", async () => {
    const ours = await bytes(ogImageResponse(deckCard("Custom card decks"), OG_SIZE));
    const nextOg = await bytes(new ImageResponse(deckCard("Custom card decks"), OG_SIZE));
    expect(ours.equals(nextOg)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);

  it("keeps ImageResponse's headers", () => {
    const res = ogImageResponse(deckCard("x"), OG_SIZE);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/max-age|no-store/);
  });

  it("renders emoji, CJK and extra Latin in user titles without any network", async () => {
    const png = await bytes(ogImageResponse(deckCard("🔥 Burn — 竜の炎 — Ǵoran"), OG_SIZE));
    const meta = await sharp(png).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["png", OG_SIZE.width, OG_SIZE.height]);
    expect(requests.map(([code]) => code)).toContain("emoji");
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);

  it("renders the card social composite with an emoji title without any network", async () => {
    const png = await sharp({
      create: { width: 50, height: 70, channels: 3, background: "#335577" },
    })
      .png()
      .toBuffer();
    const res = renderCardSocialImage({
      title: "Ember 🔥 Drake",
      typeLine: "Creature — Dragon",
      creatorHandle: "probe_user",
      cardImageDataUri: `data:image/png;base64,${png.toString("base64")}`,
      accent: "#b33",
    });
    expect((await sharp(await bytes(res)).metadata()).format).toBe("png");
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);
});

describe("edge OG images (still next/og)", () => {
  it("the site card only draws characters the default Geist covers — next/og's loader is never reached", async () => {
    await bytes(ogImageResponse(<HomeOgCard />, OG_SIZE));
    expect(requests).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 60_000);
});
