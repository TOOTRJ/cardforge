import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  DECK_COVER_HEIGHT,
  DECK_COVER_WIDTH,
  normalizeDeckCover,
} from "@/lib/decks/cover";

describe("normalizeDeckCover", () => {
  it("turns any image into an exact 16:9 WebP cover", async () => {
    const tall = await sharp({
      create: { width: 800, height: 1200, channels: 3, background: "#224488" },
    })
      .png()
      .toBuffer();
    const { bytes, contentType } = await normalizeDeckCover(tall);
    expect(contentType).toBe("image/webp");
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(DECK_COVER_WIDTH);
    expect(meta.height).toBe(DECK_COVER_HEIGHT);
  });

  it("upsamples a small wide image rather than leaving bars", async () => {
    const small = await sharp({
      create: { width: 320, height: 180, channels: 3, background: "#884422" },
    })
      .jpeg()
      .toBuffer();
    const meta = await sharp(Buffer.from((await normalizeDeckCover(small)).bytes)).metadata();
    expect([meta.width, meta.height]).toEqual([DECK_COVER_WIDTH, DECK_COVER_HEIGHT]);
  });
});
