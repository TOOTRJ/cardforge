// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CardPreview, type CardPreviewData } from "@/components/cards/card-preview";
import { rowToPreviewData, type CardRowForBake } from "@/lib/cards/bake-core";
import { backBodyOf, bakedBackOf, flippableBackOf } from "@/lib/cards/faces";

// ---------------------------------------------------------------------------
// TODO 4.54 on REAL renders: a stored row that still says "alphatoken" — the
// retired Alpha token frame — draws, in BOTH renderers, exactly what the same
// row draws on the frame it reads as: `m15token`, or `m15tokentext` when the
// row has rules or flavour text. Byte for byte in the bake (display, a clean
// square download and the art-less print layer), and the same markup in the
// live preview. Row by row: without text, with rules, with flavour alone, an
// Artifact token, a P/T token, a Copy's bare "Token", a row whose BACK face
// names the retired value as its body, and a row baked with an override
// stored under the retired key. The masters live in the frames bucket (never
// in git): the bake is served a flat card, and the masters it ASKS for are
// recorded — never the retired folder, never the creature frame.
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", white: "", asked: [] as string[] }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async (template: string, colorKey: string) => {
      stand.asked.push(`preload:${template}/${colorKey}`);
    },
    preloadFrameAssets: async (paths: Iterable<string>) => {
      for (const path of paths) stand.asked.push(`asset:${path}`);
    },
    getFrameDataUrl: (template: string, colorKey: string) => {
      stand.asked.push(`frame:${template}/${colorKey}`);
      return stand.grey;
    },
    getPlateDataUrlForPath: (pathTemplate: string, colorKey: string) => {
      stand.asked.push(`plate:${pathTemplate}/${colorKey}`);
      return stand.white;
    },
    getFrameAssetDataUrl: () => null,
    getFrameOverlayDataUrl: () => stand.grey,
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
  stand.white = await solid(255, 64, 32);
});
beforeEach(() => {
  stand.asked = [];
});

function row(template: string, over: Partial<CardRowForBake> = {}): CardRowForBake {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    owner_id: "11111111-1111-4111-8111-111111111111",
    title: "Goblin Raider's Vengeful Spirit",
    cost: null,
    card_type: "token",
    supertype: "Creature",
    subtypes: ["Goblin"],
    rarity: "common",
    color_identity: ["red"],
    rules_text: null,
    flavor_text: null,
    power: "1",
    toughness: "1",
    loyalty: null,
    defense: null,
    artist_credit: "Probe",
    art_url: null,
    art_position: {},
    frame_style: { template, finish: "regular" },
    set_icon_url: null,
    set_icon_code: null,
    back_face: null,
    face_content: null,
    watermark: null,
    ...over,
  };
}

/** [name, the row's fields, the frame an "alphatoken" row must read as]. */
const ROWS: readonly [string, Partial<CardRowForBake>, "m15token" | "m15tokentext"][] = [
  ["no text, with P/T", {}, "m15token"],
  ["whitespace text only", { rules_text: " \n", flavor_text: "" }, "m15token"],
  ["rules text", { rules_text: "Haste\nWhen this creature dies, it deals 1 damage to any target." }, "m15tokentext"],
  ["flavour text alone", { flavor_text: "Enemies of the heir, beware." }, "m15tokentext"],
  ["an Artifact token, no text", { supertype: "Artifact", subtypes: ["Treasure"], power: null, toughness: null, color_identity: ["colorless"] }, "m15token"],
  [
    "an Artifact Creature token with text",
    { supertype: "Artifact Creature", subtypes: ["Thopter"], rules_text: "Flying", color_identity: ["colorless"] },
    "m15tokentext",
  ],
  ["a Copy's bare Token, a cost left in the row", { supertype: null, subtypes: [], power: null, toughness: null, cost: "{1}{R}" }, "m15token"],
  ["a multicolour token with text", { color_identity: ["red", "green"], rules_text: "Trample" }, "m15tokentext"],
  [
    "a legacy back face on the row",
    { back_face: { title: "The Other Side", card_type: "creature", rules_text: "Flying", power: "2", toughness: "2" } },
    "m15token",
  ],
];

async function bytes(card: CardPreviewData, options: Record<string, unknown>, preset: "default" | "hd" = "default") {
  const { renderCardImage } = await import("@/lib/render/card-image");
  return Buffer.from(await (await renderCardImage(card, preset, options as never)).arrayBuffer());
}

const DISPLAY = { brandMark: true, watermarkText: null, corners: "round" };
const CLEAN_SQUARE = { brandMark: false, watermarkText: "my mark", corners: "square" };

describe("a stored row on the retired alphatoken frame — the bake", () => {
  it.each(ROWS)("%s: the same bytes as the frame it reads as, from that frame's masters", async (_name, fields, reads) => {
    stand.asked = [];
    const retired = await bytes(rowToPreviewData(row("alphatoken", fields)), DISPLAY);
    const askedRetired = [...stand.asked];
    stand.asked = [];
    const current = await bytes(rowToPreviewData(row(reads, fields)), DISPLAY);
    const askedCurrent = [...stand.asked];

    expect(retired.equals(current)).toBe(true);
    expect(askedRetired).toEqual(askedCurrent);
    expect(askedRetired.some((a) => a.startsWith(`frame:${reads}/`))).toBe(true);
    for (const asked of askedRetired) {
      expect(asked).not.toContain("alphatoken");
      // Never the default creature frame's master.
      expect(asked).not.toMatch(/^(frame|preload):m15\//);
    }
    // And it is NOT what the other token frame draws: the text decides.
    const other = reads === "m15token" ? "m15tokentext" : "m15token";
    expect(retired.equals(await bytes(rowToPreviewData(row(other, fields)), DISPLAY))).toBe(false);
  }, 120_000);

  it("a clean square download and the HD bake are the replacement's too", async () => {
    for (const [, fields, reads] of [ROWS[0], ROWS[2]]) {
      const a = rowToPreviewData(row("alphatoken", fields));
      const b = rowToPreviewData(row(reads, fields));
      expect((await bytes(a, CLEAN_SQUARE)).equals(await bytes(b, CLEAN_SQUARE))).toBe(true);
      expect((await bytes(a, DISPLAY, "hd")).equals(await bytes(b, DISPLAY, "hd"))).toBe(true);
    }
  }, 120_000);

  it("the print paths read it the same: edges, square-corner fills, drawn stats", async () => {
    const { printEdgesOf } = await import("@/lib/render/card-print");
    const { squareCornerFillsOf, frameAssetPathsFor } = await import("@/lib/render/card-image");
    for (const [name, fields, reads] of ROWS) {
      const a = rowToPreviewData(row("alphatoken", fields));
      const b = rowToPreviewData(row(reads, fields));
      expect(printEdgesOf(a), name).toEqual(printEdgesOf(b));
      expect(squareCornerFillsOf(a), name).toEqual(squareCornerFillsOf(b));
      expect(frameAssetPathsFor(a), name).toEqual(frameAssetPathsFor(b));
    }
  });

  it("an override stored under the retired key is never read; the replacement's is", async () => {
    const fields = ROWS[2][1];
    const moved = { title: { rect: { topPct: 9 } } };
    const plain = await bytes(rowToPreviewData(row("alphatoken", fields)), DISPLAY);
    // A leftover row keyed by the retired name changes nothing…
    const stale = await bytes(rowToPreviewData(row("alphatoken", fields), null, { alphatoken: moved }), DISPLAY);
    expect(stale.equals(plain)).toBe(true);
    // …an override of the frame it draws on moves it, exactly as it moves
    // a row stored on that frame.
    const live = await bytes(rowToPreviewData(row("alphatoken", fields), null, { m15tokentext: moved }), DISPLAY);
    expect(live.equals(plain)).toBe(false);
    expect(live.equals(await bytes(rowToPreviewData(row("m15tokentext", fields), null, { m15tokentext: moved }), DISPLAY))).toBe(true);
  }, 120_000);
});

describe("the retired value as a BACK face's body", () => {
  it("is no body at all: the back stays a legacy back, and the card bakes one face", () => {
    for (const front of ["alphatoken", "m15dfcfront", "m15"]) {
      const card = rowToPreviewData(
        row(front, {
          card_type: front === "alphatoken" ? "token" : "creature",
          back_face: {
            title: "The Other Side",
            card_type: "creature",
            power: "2",
            toughness: "2",
            frame_style: { template: "alphatoken" },
            color_identity: ["red"],
          },
        }),
      );
      expect(backBodyOf(card), front).toBeNull();
      expect(bakedBackOf(card), front).toBeNull();
    }
    // The token row's legacy back still flips on the page (a plain second face).
    const token = rowToPreviewData(row("alphatoken", { back_face: { title: "The Other Side", card_type: "creature" } }));
    expect(Boolean(flippableBackOf(token))).toBe(Boolean(flippableBackOf(rowToPreviewData(row("m15token", { back_face: { title: "The Other Side", card_type: "creature" } })))));
  });

  it("bakes without a crash under a double-faced front", async () => {
    const card = rowToPreviewData(
      row("m15dfcfront", {
        card_type: "creature",
        cost: "{1}{R}",
        back_face: { title: "The Other Side", card_type: "creature", power: "2", toughness: "2", frame_style: { template: "alphatoken" } },
      }),
    );
    const png = await bytes(card, DISPLAY);
    expect((await sharp(png).metadata()).width).toBeGreaterThan(0);
  }, 120_000);
});

describe("a stored row on the retired alphatoken frame — the live preview", () => {
  const markup = (template: string, fields: Partial<CardRowForBake>) => {
    const data = rowToPreviewData(row(template, fields));
    return renderToStaticMarkup(<CardPreview {...data} />);
  };

  it.each(ROWS)("%s: the same markup as the frame it reads as", (_name, fields, reads) => {
    const html = markup("alphatoken", fields);
    expect(html).toBe(markup(reads, fields));
    expect(html).not.toContain("alphatoken");
    const other = reads === "m15token" ? "m15tokentext" : "m15token";
    expect(html).not.toBe(markup(other, fields));
  });
});
