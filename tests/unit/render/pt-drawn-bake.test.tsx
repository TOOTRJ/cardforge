import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { dfcBodyOf } from "@/lib/cards/dfc";
import { backPreviewData, flippableBackOf, frontPreviewData } from "@/lib/cards/faces";
import { frontDrawsPowerToughness, secondFaceDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/pt-drawn.ts held to REAL bakes (the skeptic pass on #509). The
// helper reads the profiles' slots; tests/unit/cards/pt-drawn.test.ts holds
// it to that data, which says nothing if a renderer ever draws a P/T another
// way (the saga body's, TODO 4.5c) or stops reading the slot. Here every
// face is baked twice — with a 7/7 and without — on a flat grey stand-in
// frame, with no rules text (so no keep-out moves a line): the two bakes
// differ exactly when the face DRAWS its P/T, and that must be the helper's
// answer for
//
//   * the front of every template;
//   * a half painted on the front's master (flip, split, aftermath, the
//     adventure's page);
//   * a double-faced back on every back body;
//   * a legacy back (no body) on every template that flips to one.
//
// At the 750 px default. The masters live in the frames bucket: none is read.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.plate,
    getFrameOverlayDataUrl: () => stand.grey,
    getFrameAssetDataUrl: () => null,
  };
});

async function solid(v: number, w = 16, h = 16): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: v, g: v, b: v, alpha: 1 } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  stand.grey = await solid(128);
  stand.plate = await solid(40, 64, 32);
});

type BackFace = NonNullable<CardPreviewData["backFace"]>;

function backFace(pt: boolean, body: string | null): BackFace {
  return {
    title: "BB",
    cost: "",
    card_type: "creature",
    supertype: null,
    subtypes: ["Beast"],
    rules_text: "",
    power: pt ? "7" : null,
    toughness: pt ? "7" : null,
    ...(body ? { frame_style: { template: body } } : {}),
    color_identity: ["blue"],
  } as unknown as BackFace;
}

function card(template: string, pt: boolean, back: BackFace | null = null): CardPreviewData {
  return {
    title: "HH",
    cost: "{U}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Beast"],
    rarity: "common",
    colorIdentity: ["blue"],
    rulesText: null,
    flavorText: null,
    power: pt ? "7" : null,
    toughness: pt ? "7" : null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: back,
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

async function bake(face: CardPreviewData): Promise<Buffer> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(face, "default", { brandMark: false, watermarkText: null })).arrayBuffer());
  return sharp(png).raw().toBuffer();
}

/** The two faces bake to different pixels: the 7/7 is drawn. */
async function drawn(withPt: CardPreviewData, without: CardPreviewData): Promise<boolean> {
  const [a, b] = await Promise.all([bake(withPt), bake(without)]);
  return !a.equals(b);
}

describe("pt-drawn on real bakes: the helper's answer is what the picture shows", () => {
  it("the front of every template", async () => {
    const wrong: string[] = [];
    let some = 0;
    for (const t of FRAME_TEMPLATE_VALUES) {
      const real = await drawn(frontPreviewData(card(t, true)), frontPreviewData(card(t, false)));
      if (real) some += 1;
      if (real !== frontDrawsPowerToughness(t)) wrong.push(`${t}: drawn ${real}`);
    }
    expect(wrong).toEqual([]);
    // Not vacuous: both answers occur.
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(FRAME_TEMPLATE_VALUES.length);
  }, 300_000);

  it("a half painted on the front's master", async () => {
    const inline = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).secondFace || getFrameProfile(t).adventure);
    expect(inline.length).toBeGreaterThan(0);
    const wrong: string[] = [];
    for (const t of inline) {
      const real = await drawn(card(t, false, backFace(true, null)), card(t, false, backFace(false, null)));
      if (real !== secondFaceDrawsPowerToughness(t)) wrong.push(`${t}: drawn ${real}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("a double-faced back on every back body", async () => {
    const front = FRAME_TEMPLATE_VALUES.find((t) => dfcBodyOf(t)?.role === "front")!;
    const backs = FRAME_TEMPLATE_VALUES.filter((t) => dfcBodyOf(t)?.role === "back");
    expect(backs.length).toBeGreaterThan(0);
    const wrong: string[] = [];
    for (const body of backs) {
      const real = await drawn(
        backPreviewData(card(front, false, backFace(true, body)))!,
        backPreviewData(card(front, false, backFace(false, body)))!,
      );
      if (real !== secondFaceDrawsPowerToughness(front, body)) wrong.push(`${front} → ${body}: drawn ${real}`);
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("a legacy back (no body), on every template that flips to one", async () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const t of FRAME_TEMPLATE_VALUES) {
      const withPt = flippableBackOf(card(t, false, backFace(true, null)));
      const without = flippableBackOf(card(t, false, backFace(false, null)));
      if (!withPt || !without) continue;
      checked += 1;
      const real = await drawn(withPt, without);
      if (real !== secondFaceDrawsPowerToughness(t)) wrong.push(`${t}: drawn ${real}`);
    }
    expect(checked).toBeGreaterThan(0);
    expect(wrong).toEqual([]);
  }, 300_000);
});
