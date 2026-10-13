// @vitest-environment happy-dom
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { secondFaceDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { secondPartHasOwnArt } from "@/lib/creator/part-outline";
import {
  SECOND_PART_HIDEABLE,
  SECOND_PART_UNIT_KEYS,
  neverDrawnSecondPartUnits,
  type SecondPartHideable,
} from "@/lib/creator/second-part-fields";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// "The card never draws it" (TODO 5.14, owner round 52) held to BOTH
// renderers, for EVERY frame that paints a second part on its own picture.
//
// The creator hides a second part's field while it is empty when
// lib/creator/second-part-fields.ts says the frame never draws it. That is a
// claim about the renderers, so it is checked against them and not against
// the profile data it is read from: each second part is drawn twice — with a
// value in the unit and without — by the server bake (pixels) and by the
// live preview (markup). The two differ exactly when the unit is DRAWN, and
// that must be the opposite of what the module says, unit by unit.
//
// A flat, half see-through grey stand-in frame and a plate: no master is
// read. The picture is a data URL, so nothing is fetched.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "", art: "" }));

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

// The preview draws only pictures on our own storage (migration 0127): the
// stand-in picture is let through — what is asked here is WHERE a picture
// is drawn, not which hosts may hold one.
vi.mock("@/lib/cards/drawable-media", () => ({ drawableCardMedia: <T,>(card: T) => card }));

async function solid(rgb: [number, number, number], w = 16, h = 16, alpha = 1): Promise<string> {
  const [r, g, b] = rgb;
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha } } })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  // Half see-through: a picture under the frame shows in the bake.
  stand.grey = await solid([128, 128, 128], 16, 16, 0.5);
  stand.plate = await solid([40, 40, 40], 64, 32);
  stand.art = await solid([200, 30, 30], 64, 64);
});

/** Every template whose profile paints a second part on its own picture. */
const SECOND_PART_TEMPLATES = FRAME_TEMPLATE_VALUES.filter((template) => {
  const profile = getFrameProfile(template);
  return Boolean(profile.secondFace || profile.adventure);
});

type BackFace = NonNullable<CardPreviewData["backFace"]>;

const VALUES: Record<string, () => string> = {
  power: () => "7",
  toughness: () => "7",
  loyalty: () => "5",
  defense: () => "6",
  flavor_text: () => "A line nobody prints.",
  artist_credit: () => "Bo Marsh",
  art_url: () => stand.art,
};

function backFace(unit: SecondPartHideable | null): BackFace {
  const held = Object.fromEntries((unit ? SECOND_PART_UNIT_KEYS[unit] : []).map((key) => [key, VALUES[key]()]));
  return {
    title: "BB",
    cost: "",
    card_type: "creature",
    supertype: null,
    subtypes: ["Beast"],
    rules_text: "",
    ...held,
  } as unknown as BackFace;
}

function card(template: string, unit: SecondPartHideable | null): CardPreviewData {
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
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    // The card's own artist is printed: the footer is not empty, so a
    // second part's credit would have somewhere to show.
    artistCredit: "Anya Vale",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: backFace(unit),
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

async function bake(face: CardPreviewData): Promise<Buffer> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(face, "default", { brandMark: false, watermarkText: null })).arrayBuffer());
  return sharp(png).raw().toBuffer();
}

const previewMarkup = (face: CardPreviewData) => renderToStaticMarkup(<CardPreview {...face} />);

describe("what a second part's frame never draws — both renderers, every frame", () => {
  it("the frames that paint a second part on their own picture are the four kinds' own", () => {
    expect([...SECOND_PART_TEMPLATES].sort()).toEqual(["adventure", "aftermath", "flip", "split"]);
  });

  it("the table, per frame", () => {
    const table = Object.fromEntries(
      SECOND_PART_TEMPLATES.map((template) => [
        template,
        SECOND_PART_HIDEABLE.filter((unit) => neverDrawnSecondPartUnits(getFrameProfile(template)).has(unit)),
      ]),
    );
    expect(table).toEqual({
      adventure: ["pt", "loyalty", "defense", "flavor", "artist", "art"],
      aftermath: ["pt", "loyalty", "defense", "flavor", "artist"],
      flip: ["loyalty", "defense", "flavor", "artist", "art"],
      split: ["pt", "loyalty", "defense", "flavor", "artist"],
    });
    // …and it agrees with the two helpers that already answer a part of it.
    for (const template of SECOND_PART_TEMPLATES) {
      const never = neverDrawnSecondPartUnits(getFrameProfile(template));
      expect(never.has("pt"), template).toBe(!secondFaceDrawsPowerToughness(template));
      expect(never.has("art"), template).toBe(!secondPartHasOwnArt(getFrameProfile(template)));
    }
  });

  it("nothing is never-drawn on a profile that paints no second part", () => {
    for (const template of FRAME_TEMPLATE_VALUES) {
      if (SECOND_PART_TEMPLATES.includes(template)) continue;
      expect(neverDrawnSecondPartUnits(getFrameProfile(template)).size, template).toBe(0);
    }
    expect(neverDrawnSecondPartUnits(null).size).toBe(0);
  });

  describe.each(SECOND_PART_TEMPLATES)("%s", (template) => {
    const never = neverDrawnSecondPartUnits(getFrameProfile(template));

    it.each(SECOND_PART_HIDEABLE)("the bake draws %s exactly when the module says it is drawn", async (unit) => {
      const [held, empty] = await Promise.all([bake(card(template, unit)), bake(card(template, null))]);
      expect(!held.equals(empty), `${template} / ${unit} drawn by the bake`).toBe(!never.has(unit));
    }, 60_000);

    it.each(SECOND_PART_HIDEABLE)("the preview draws %s exactly when the module says it is drawn", (unit) => {
      const drawn = previewMarkup(card(template, unit)) !== previewMarkup(card(template, null));
      expect(drawn, `${template} / ${unit} drawn by the preview`).toBe(!never.has(unit));
    });
  });
});
