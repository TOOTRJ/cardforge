import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
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
