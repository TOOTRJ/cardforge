import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applyCardCornerMask } from "@/lib/cards/card-corner";
import {
  RENDER_THUMB_WIDTH,
  makeRenderThumb,
  renderThumbPath,
} from "@/lib/cards/render-thumb";

describe("render-thumb — the tile-sized WebP beside the HD bake", () => {
  it("sits next to the PNG under the same object name", () => {
    expect(renderThumbPath("owner/card.png")).toBe("owner/card.thumb.webp");
  });

  it("downscales an HD bake to a 600 px WebP and never enlarges a small one", async () => {
    const hd = await sharp({
      create: { width: 1500, height: 2100, channels: 4, background: "#446644" },
    })
      .png()
      .toBuffer();
    const thumb = await makeRenderThumb(hd);
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(RENDER_THUMB_WIDTH);
    expect(meta.height).toBe(840);
    expect(thumb.byteLength).toBeLessThan(hd.byteLength / 10);

    const small = await sharp({
      create: { width: 300, height: 420, channels: 4, background: "#222" },
    })
      .png()
      .toBuffer();
    const smallThumb = await sharp(await makeRenderThumb(small)).metadata();
    expect(smallThumb.width).toBe(300);
  });

  it("keeps a round bake's transparent corner: a WebP with alpha (TODO 3.26)", async () => {
    const w = 1500;
    const h = 2100;
    const data = Buffer.alloc(w * h * 4);
    for (let i = 0; i < data.length; i += 4) data.set([68, 102, 68, 255], i);
    applyCardCornerMask(data, w, h);
    const hd = await sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    const thumb = await makeRenderThumb(hd);
    const meta = await sharp(thumb).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.hasAlpha).toBe(true);
    expect(meta.channels).toBe(4);
    const { data: px, info } = await sharp(thumb).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => px[(y * info.width + x) * 4 + 3];
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(599, 839)).toBe(0);
    expect(alpha(300, 420)).toBe(255);
  });
});
