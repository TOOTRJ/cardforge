import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MODEL_INPUT_EDGE, MODEL_INPUT_MAX_BYTES, modelInputImage } from "@/lib/media/model-input";
import { noisePng } from "@/tests/stubs/noise-png";

// ---------------------------------------------------------------------------
// Card art may be 20 MiB since TODO 6.10. What a third-party model gets of a
// stored picture (lib/media/model-input.ts): the file itself up to 8 MiB —
// the old card-art cap, so nothing that uploaded before changes — and above
// that a copy fit inside 2048 px. OpenAI's moderation takes files up to
// 20 MB and the scan fails OPEN on a refusal, so without the copy a big
// upload would go unscanned; Gemini (the remix) takes the image inline in a
// request capped at 20 MB.
// ---------------------------------------------------------------------------

describe("modelInputImage", () => {
  it("passes a file within the cap through untouched — the same bytes", async () => {
    const small = await sharp({ create: { width: 40, height: 56, channels: 3, background: "#345" } }).png().toBuffer();
    const out = await modelInputImage(small, "image/png");
    expect(out.downscaled).toBe(false);
    expect(out.bytes).toBe(small);
    expect(out.contentType).toBe("image/png");
  });

  it("a print-size PNG over 8 MiB becomes a JPEG fit inside 2048 px, aspect kept", async () => {
    expect(MODEL_INPUT_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(MODEL_INPUT_EDGE).toBe(2048);
    const big = await noisePng(2000, 2800, 3); // ~16 MiB, the 800 ppi full-art slot
    expect(big.byteLength).toBeGreaterThan(MODEL_INPUT_MAX_BYTES);
    const out = await modelInputImage(big, "image/png");
    expect(out.downscaled).toBe(true);
    expect(out.contentType).toBe("image/jpeg");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe("jpeg");
    expect([meta.width, meta.height]).toEqual([1463, 2048]);
    // Far under both models' 20 MB, base64 included.
    expect((out.bytes.byteLength * 4) / 3).toBeLessThan(8 * 1024 * 1024);
  });

  it("never enlarges a small-pixel file that is over the byte cap", async () => {
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123" } }).png().toBuffer();
    const out = await modelInputImage(png, "image/png", { maxBytes: 10 });
    expect(out.downscaled).toBe(true);
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("keepAlpha keeps a transparent image's alpha as PNG; otherwise it is flattened onto mid grey", async () => {
    const clear = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const kept = await modelInputImage(clear, "image/png", { maxBytes: 10, keepAlpha: true });
    expect(kept.contentType).toBe("image/png");
    expect((await sharp(kept.bytes).metadata()).hasAlpha).toBe(true);

    const flat = await modelInputImage(clear, "image/png", { maxBytes: 10 });
    expect(flat.contentType).toBe("image/jpeg");
    const { data } = await sharp(flat.bytes).raw().toBuffer({ resolveWithObject: true });
    for (const v of data.subarray(0, 3)) expect(Math.abs(v - 128)).toBeLessThanOrEqual(2);
  });

  it("undecodable bytes over the cap come back unchanged (the caller's own fallback applies)", async () => {
    const junk = new Uint8Array(64).fill(7);
    const out = await modelInputImage(junk, "image/png", { maxBytes: 10 });
    expect(out).toEqual({ bytes: junk, contentType: "image/png", downscaled: false });
  });
});
