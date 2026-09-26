import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RENDER_PRESETS } from "@/lib/render/card-image";
import {
  foilMaskSource,
  resolveRenderableImage,
  toSatoriDataUrl,
} from "@/lib/render/art-source";
import {
  QUADRANTS,
  UPRIGHT_H,
  UPRIGHT_W,
  dataUrl,
  looksUpright,
  storedAs,
  upright,
} from "@/tests/stubs/exif-fixtures";

// ---------------------------------------------------------------------------
// TODO 3.14 — EXIF orientation in the bake.
//
// A phone photo is stored sideways with an EXIF Orientation tag; the browser
// obeys the tag, so the creator, the art positioner and the live preview show
// it upright (and the saved focal point / zoom are measured on the upright
// image). Satori/resvg ignore the tag: before the fix, the stored render, the
// WebP thumb, the OG image and every download drew the photo sideways.
//
// Contract pinned here: every raster the bake inlines is auto-oriented, so an
// orientation-3/6/8 photo bakes EXACTLY like the same picture saved upright
// (the "pre-rotated" control), focal point and zoom included — and the foil
// mask measures the art at its upright size, like the browser does.
// ---------------------------------------------------------------------------

const decode = (url: string) => Buffer.from(url.slice(url.indexOf(",") + 1), "base64");

describe("art-source — auto-orients every inlined raster", () => {
  it("fixture sanity: sharp's autoOrient turns every stored layout back into the upright picture", async () => {
    for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const stored = await storedAs(o);
      const meta = await sharp(stored).metadata();
      expect(meta.orientation).toBe(o);
      // Stored landscape for the quarter-turn orientations, like a phone.
      expect([meta.width, meta.height]).toEqual(o >= 5 ? [UPRIGHT_H, UPRIGHT_W] : [UPRIGHT_W, UPRIGHT_H]);
      expect(await looksUpright(await sharp(stored).autoOrient().png().toBuffer())).toBe(true);
      // …and a tag-blind decoder (the old bake) does NOT see it upright.
      if (o !== 1) expect(await looksUpright(await sharp(stored).png().toBuffer())).toBe(false);
    }
  });

  it.each([2, 3, 4, 5, 6, 7, 8])(
    "toSatoriDataUrl: orientation %i comes out upright, untagged, at the displayed size",
    async (o) => {
      for (const format of ["jpeg", "png", "webp"] as const) {
        const out = decode(await toSatoriDataUrl(await storedAs(o, format)));
        const meta = await sharp(out).metadata();
        expect(meta.orientation ?? 1).toBe(1);
        expect([meta.width, meta.height]).toEqual([UPRIGHT_W, UPRIGHT_H]);
        expect(await looksUpright(out)).toBe(true);
      }
    },
  );

  it("toSatoriDataUrl: an untagged small JPEG/PNG still passes through byte-for-byte", async () => {
    for (const [format, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"]] as const) {
      const bytes = await upright(format);
      expect(await toSatoriDataUrl(bytes)).toBe(dataUrl(bytes, mime));
    }
    // Orientation 1 is "as stored" too.
    const one = await storedAs(1);
    expect(await toSatoriDataUrl(one)).toBe(dataUrl(one, "image/jpeg"));
  });

  it("resolveRenderableImage: a data: JPEG/PNG with an orientation tag is no longer passed through", async () => {
    for (const [format, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"]] as const) {
      const tagged = dataUrl(await storedAs(6, format), mime);
      const resolved = await resolveRenderableImage(tagged);
      expect(resolved).not.toBe(tagged);
      expect(await looksUpright(decode(resolved as string))).toBe(true);
    }
    const plain = dataUrl(await upright("png"), "image/png");
    expect(await resolveRenderableImage(plain)).toBe(plain);
  });

  it("resolveRenderableImage: a stored file fetched over HTTP (the real bake path) comes back upright", async () => {
    // A loopback server stands in for the storage host (the allowlist lets
    // 127.0.0.1 through outside production): the bytes are exactly what an
    // old upload holds — sideways pixels plus the tag.
    const bytes = await storedAs(6);
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "image/jpeg", "content-length": bytes.byteLength });
      res.end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const resolved = await resolveRenderableImage(`http://127.0.0.1:${port}/card-art/phone.jpg`);
      expect(resolved?.startsWith("data:image/jpeg;base64,")).toBe(true);
      const out = decode(resolved as string);
      expect([(await sharp(out).metadata()).width, (await sharp(out).metadata()).height]).toEqual([UPRIGHT_W, UPRIGHT_H]);
      expect(await looksUpright(out)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it.each([3, 6, 8])("foilMaskSource: orientation %i reports the UPRIGHT natural size and an upright mask", async (o) => {
    const mask = await foilMaskSource(dataUrl(await storedAs(o), "image/jpeg"));
    expect(mask).not.toBeNull();
    // The browser's naturalWidth/naturalHeight: 300 × 400, never 400 × 300.
    expect([mask!.naturalWidth, mask!.naturalHeight]).toEqual([UPRIGHT_W, UPRIGHT_H]);
    expect(await looksUpright(decode(mask!.href))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Real bakes (git frame `modern`, offline). The art window of an orientation
// 3/6/8 bake must match the pre-rotated control to within JPEG noise, with an
// off-centre focal point and a zoom — and must NOT match the sideways draw.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;

function card(artUrl: string, finish = "regular"): CardPreviewData {
  return {
    title: "Orientation Probe",
    cost: "{1}{R}",
    cardType: "creature",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["red"],
    rulesText: "Haste",
    flavorText: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    // Set in the creator against the UPRIGHT image.
    artPosition: { focalX: 0.35, focalY: 0.6, scale: 1.2 },
    frameStyle: { template: "modern", finish },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as CardPreviewData;
}

async function bakeRaw(data: CardPreviewData): Promise<Buffer> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(
    await (await renderCardImage(data, "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
  );
  return sharp(png).removeAlpha().raw().toBuffer();
}

/** Mean per-channel difference over the art window (1 % inset). */
function artWindowDelta(a: Buffer, b: Buffer): number {
  const r = getFrameProfile("modern").artSlot;
  const x0 = Math.ceil(((r.leftPct + 1) / 100) * W);
  const x1 = Math.floor(((r.leftPct + r.widthPct - 1) / 100) * W);
  const y0 = Math.ceil(((r.topPct + 1) / 100) * H);
  const y1 = Math.floor(((r.topPct + r.heightPct - 1) / 100) * H);
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 3;
      sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
      n += 1;
    }
  }
  return sum / n;
}

describe("the bake draws an EXIF-rotated photo the way the browser shows it", () => {
  it("orientations 3, 6 and 8 bake identically to the pre-rotated picture (focal point + zoom included)", async () => {
    const control = await bakeRaw(card(dataUrl(await upright(), "image/jpeg")));
    // The upright art itself: light-years from the sideways draw below.
    for (const o of [3, 6, 8]) {
      const baked = await bakeRaw(card(dataUrl(await storedAs(o), "image/jpeg")));
      expect(artWindowDelta(baked, control), `orientation ${o}`).toBeLessThan(1.5);
    }
    // Mutation guard: the SAME stored pixels with the tag stripped (what the
    // old bake effectively drew) are nowhere near the control.
    const sideways = await sharp(await storedAs(6)).jpeg({ quality: 100 }).toBuffer();
    expect((await sharp(sideways).metadata()).orientation).toBeUndefined();
    expect(artWindowDelta(await bakeRaw(card(dataUrl(sideways, "image/jpeg"))), control)).toBeGreaterThan(20);
  }, 60_000);

  it("a foil bake follows the upright art too (the mask geometry uses the upright size)", async () => {
    const control = await bakeRaw(card(dataUrl(await upright(), "image/jpeg"), "foil"));
    const baked = await bakeRaw(card(dataUrl(await storedAs(6), "image/jpeg"), "foil"));
    expect(artWindowDelta(baked, control)).toBeLessThan(1.5);
  }, 60_000);

  it("keeps the quadrant colours the creator showed (sanity on what 'upright' means)", () => {
    // Guards the fixture palette against an accidental edit that would make
    // two quadrants alike (the orientation checks above would lose power).
    const colours = Object.values(QUADRANTS).map((c) => c.join(","));
    expect(new Set(colours).size).toBe(4);
  });
});
