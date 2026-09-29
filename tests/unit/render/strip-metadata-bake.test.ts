import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { stripImageMetadata } from "@/lib/media/strip-metadata";
import { toSatoriDataUrl } from "@/lib/render/art-source";
import { dataUrl } from "@/tests/stubs/exif-fixtures";
import { cameraPhoto, gpsTiff, pngChunk, withPngChunks, FAKE_OWNER } from "@/tests/stubs/metadata-fixtures";

// ---------------------------------------------------------------------------
// TODO 3.14a — stripping camera metadata never changes a bake. The strip is
// container-level (lib/media/strip-metadata.ts): the scan data, the ICC
// profile and a needed orientation are kept, so a card baked from the
// stripped file is PIXEL-IDENTICAL to the same card baked from the original
// — the bake's inline path (JPEG/PNG ≤ 3 MB passed through), its turn path
// (a tagged JPEG re-encoded upright) and its transcode path (WebP) alike.
// This is what lets the owner-run backfill rewrite stored art in place with
// no re-bake and no layout bump.
// ---------------------------------------------------------------------------

function card(artUrl: string): CardPreviewData {
  return {
    title: "Metadata Probe",
    cost: "{2}{G}",
    cardType: "creature",
    supertype: null,
    subtypes: [],
    rarity: "common",
    colorIdentity: ["green"],
    rulesText: "Reach",
    flavorText: null,
    power: "3",
    toughness: "3",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl,
    artPosition: { focalX: 0.4, focalY: 0.55, scale: 1.3 },
    frameStyle: { template: "modern", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as CardPreviewData;
}

async function bake(artUrl: string): Promise<Buffer> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(
    await (await renderCardImage(card(artUrl), "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
  );
  return sharp(png).ensureAlpha().raw().toBuffer();
}

async function expectSameBake(original: Buffer, mime: string) {
  const stripped = stripImageMetadata(original);
  expect(stripped?.report.found.length, "the fixture carries metadata").toBeGreaterThan(0);
  const strippedBytes = Buffer.from(stripped!.bytes);
  const [before, after] = [await bake(dataUrl(original, mime)), await bake(dataUrl(strippedBytes, mime))];
  expect(after.equals(before)).toBe(true);
  return { before, after, strippedBytes };
}

describe("a card baked from stripped art is pixel-identical to one baked from the original", () => {
  it("JPEG with GPS + a Display P3 profile (inlined as-is)", async () => {
    const photo = await cameraPhoto("jpeg");
    const { strippedBytes } = await expectSameBake(photo, "image/jpeg");
    // Same bake PATH too: both are small untagged JPEGs, passed through.
    expect((await toSatoriDataUrl(strippedBytes)).startsWith("data:image/jpeg;base64,")).toBe(true);
  }, 60_000);

  it("a rotated phone JPEG with GPS (orientation 6 kept → turned upright in both bakes)", async () => {
    await expectSameBake(await cameraPhoto("jpeg", { orientation: 6 }), "image/jpeg");
  }, 60_000);

  it("PNG with alpha, a GPS eXIf and text chunks", async () => {
    const png = withPngChunks(
      await cameraPhoto("png", { alpha: true }),
      pngChunk("tEXt", `Author\0${FAKE_OWNER}`),
    );
    await expectSameBake(png, "image/png");
  }, 60_000);

  it("PNG whose only eXIf says orientation 8, with GPS (kept → turned upright in both bakes)", async () => {
    const clean = Buffer.from(stripImageMetadata(await cameraPhoto("png"))!.bytes);
    const tagged = withPngChunks(clean, pngChunk("eXIf", await gpsTiff(8)));
    expect((await sharp(tagged).metadata()).orientation).toBe(8);
    await expectSameBake(tagged, "image/png");
  }, 60_000);

  it("WebP with EXIF + XMP (transcoded for Satori)", async () => {
    await expectSameBake(await cameraPhoto("webp"), "image/webp");
  }, 60_000);
});
