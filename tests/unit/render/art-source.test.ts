import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  MAX_INLINE_BYTES,
  MAX_INLINE_EDGE,
  TRANSPARENT_PIXEL_DATA_URL,
  needsSatoriTranscode,
  resolveRenderableImage,
  toSatoriDataUrl,
} from "@/lib/render/art-source";

async function tinyImage(format: "png" | "jpeg" | "webp" | "gif"): Promise<Buffer> {
  const base = sharp({
    create: { width: 4, height: 4, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } },
  });
  if (format === "png") return base.png().toBuffer();
  if (format === "jpeg") return base.jpeg().toBuffer();
  if (format === "webp") return base.webp().toBuffer();
  return base.gif().toBuffer();
}

function mimeOf(dataUrl: string): string {
  return dataUrl.slice(5, dataUrl.indexOf(";"));
}

describe("art-source — images Satori can decode", () => {
  it("knows which formats need a transcode", () => {
    expect(needsSatoriTranscode("png")).toBe(false);
    expect(needsSatoriTranscode("jpeg")).toBe(false);
    expect(needsSatoriTranscode("webp")).toBe(true);
    expect(needsSatoriTranscode("gif")).toBe(true);
    expect(needsSatoriTranscode(null)).toBe(false);
  });

  it("REGRESSION: WebP (and GIF) art becomes a PNG data URL; PNG/JPEG pass through", async () => {
    const webp = await toSatoriDataUrl(await tinyImage("webp"));
    expect(mimeOf(webp)).toBe("image/png");
    const decoded = await sharp(Buffer.from(webp.split(",")[1], "base64")).metadata();
    expect(decoded.format).toBe("png");
    expect(decoded.width).toBe(4);

    expect(mimeOf(await toSatoriDataUrl(await tinyImage("gif")))).toBe("image/png");
    expect(mimeOf(await toSatoriDataUrl(await tinyImage("png")))).toBe("image/png");
    expect(mimeOf(await toSatoriDataUrl(await tinyImage("jpeg")))).toBe("image/jpeg");
  });

  it("REGRESSION: a large photo is re-encoded to fit the bake instead of being inlined whole", async () => {
    // A 1600×1920 WebP photo transcoded losslessly to PNG came out ~7 MB
    // (base64 ~10 MB) and blew resvg's XML buffer limit; one card's re-bake
    // failed on 2026-09-16. Opaque → fitted JPEG; alpha → fitted PNG.
    const noise = Buffer.alloc(2400 * 2400 * 3);
    for (let i = 0; i < noise.length; i += 1) noise[i] = (i * 2654435761) >>> 24;
    const bigOpaque = await sharp(noise, { raw: { width: 2400, height: 2400, channels: 3 } }).webp({ quality: 95 }).toBuffer();
    const inlined = await toSatoriDataUrl(bigOpaque);
    expect(mimeOf(inlined)).toBe("image/jpeg");
    const out = await sharp(Buffer.from(inlined.split(",")[1], "base64")).metadata();
    expect(Math.max(out.width ?? 0, out.height ?? 0)).toBeLessThanOrEqual(MAX_INLINE_EDGE);
    expect(inlined.length).toBeLessThan(MAX_INLINE_BYTES * 1.4);

    const bigPng = await sharp(noise, { raw: { width: 2400, height: 2400, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer();
    expect(bigPng.byteLength).toBeGreaterThan(MAX_INLINE_BYTES);
    const inlinedPng = await toSatoriDataUrl(bigPng);
    expect(mimeOf(inlinedPng)).toBe("image/jpeg");

    const alphaWebp = await sharp({ create: { width: 2000, height: 2000, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).webp().toBuffer();
    const inlinedAlpha = await toSatoriDataUrl(alphaWebp);
    expect(mimeOf(inlinedAlpha)).toBe("image/png");
    const alphaOut = await sharp(Buffer.from(inlinedAlpha.split(",")[1], "base64")).metadata();
    expect(alphaOut.hasAlpha).toBe(true);
    expect(alphaOut.width).toBe(MAX_INLINE_EDGE);
  });

  it("rejects bytes that aren't an image", async () => {
    await expect(toSatoriDataUrl(Buffer.from("not an image"))).rejects.toThrow();
  });

  it("resolveRenderableImage: transcodes non-native data URLs, passes native ones, keeps unknown schemes", async () => {
    const webpBytes = await tinyImage("webp");
    const webpData = `data:image/webp;base64,${webpBytes.toString("base64")}`;
    const resolved = await resolveRenderableImage(webpData);
    expect(resolved && mimeOf(resolved)).toBe("image/png");

    const pngData = `data:image/png;base64,${(await tinyImage("png")).toString("base64")}`;
    expect(await resolveRenderableImage(pngData)).toBe(pngData);

    expect(await resolveRenderableImage(null)).toBeNull();
    expect(await resolveRenderableImage("")).toBeNull();
    expect(await resolveRenderableImage("blob:whatever")).toBe("blob:whatever");
  });

  it("resolveRenderableImage: a failed fetch falls back to the original URL", async () => {
    // An unroutable host — the fetch rejects quickly and the URL comes back.
    const url = "http://127.0.0.1:1/nope.webp";
    expect(await resolveRenderableImage(url)).toBe(url);
  });
});

describe("resolveRenderableImage: SSRF gate", () => {
  it("never fetches a host outside the allowlist — renders a transparent pixel instead", async () => {
    expect(await resolveRenderableImage("https://evil.example/steal.png")).toBe(TRANSPARENT_PIXEL_DATA_URL);
    expect(await resolveRenderableImage("https://169.254.169.254/latest/meta-data")).toBe(TRANSPARENT_PIXEL_DATA_URL);
    // Scryfall art is allowed (a failed fetch of an allowed host falls back to the URL).
    const scryfall = "https://cards.scryfall.io/art_crop/front/0/0/nope.jpg";
    const resolved = await resolveRenderableImage(scryfall);
    expect(resolved === scryfall || (resolved ?? "").startsWith("data:")).toBe(true);
  });
});
