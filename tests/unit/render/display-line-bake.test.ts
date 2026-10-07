import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { renderCardImage, RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Display-font word spacing (TODO 4.31), pinned on REAL bakes of the git
// "retro" frame (read from disk: deterministic, offline). Satori used to place
// every word after a space at the preceding characters' UNKERNED advances and
// draw it kerned, so each gap grew by the kerning inside the words before it —
// "Jester's Mask" by Beleren's J·e, s·t, t·e, e·r and '·s pairs (−558/2048 em,
// 18 px on this HD title). displayLine() joins the words with a no-break
// space so the line is one run, drawn kerned from its first glyph: the second
// word lands where the font's own GPOS metrics put it (fontkit here; Satori's
// opentype.js and the browser agree on these pairs).
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.hd.width;
const TITLE = getFrameProfile("retro").title;
const FONT_PX = Math.round(TITLE.sizePct * W);

const beleren = fontkit.create(readFileSync(join(process.cwd(), "public/fonts/Beleren-Bold.ttf")));
const px = (units: number) => (units * FONT_PX) / beleren.unitsPerEm;
/** Kerned advance of a string, the way Satori draws one run. */
const kerned = (text: string) => px(beleren.layout(text).advanceWidth);
/** The old run start: every character's own advance, no kerning. */
const unkerned = (text: string) =>
  px(beleren.glyphsForString(text).reduce((sum, g) => sum + g.advanceWidth, 0));

function card(
  title: string,
  template = "retro",
  type: Pick<CardPreviewData, "supertype" | "subtypes"> = { supertype: null, subtypes: ["Dragon"] },
): CardPreviewData {
  return {
    title,
    cost: "{3}{R}{R}",
    cardType: "creature",
    ...type,
    rarity: "rare",
    colorIdentity: ["red"],
    rulesText: "Flying",
    flavorText: null,
    power: "5",
    toughness: "5",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(title: string | CardPreviewData): Promise<Raw> {
  const data = typeof title === "string" ? card(title) : title;
  const res = await renderCardImage(data, "hd", { brandMark: false, watermarkText: null });
  const { data: px, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: px, width: info.width, height: info.height };
}

/** Pixel columns, inside `rect`'s rows, where two bakes differ by more than 24
 *  on any channel — the ink only one of them has. */
function diffColumns(a: Raw, b: Raw, rect: Rect = TITLE.rect): number[] {
  const y0 = Math.floor((rect.topPct / 100) * a.height);
  const y1 = Math.ceil(((rect.topPct + rect.heightPct) / 100) * a.height);
  const columns: number[] = [];
  for (let x = 0; x < a.width; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      const i = (y * a.width + x) * 3;
      if (
        Math.abs(a.data[i] - b.data[i]) > 24 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 24 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 24
      ) {
        columns.push(x);
        break;
      }
    }
  }
  return columns;
}

/** The left ink edge of the word only one of two bakes has. */
function firstDiffX(a: Raw, b: Raw): number {
  return diffColumns(a, b)[0] ?? -1;
}

describe("display-font word spacing (bake)", () => {
  it("starts the second word where the font's kerned metrics put it", async () => {
    const [both, first] = await Promise.all([bake("Jester's Mask"), bake("Jester's")]);
    const origin = (TITLE.rect.leftPct / 100) * W;
    const lsbM = px(beleren.glyphsForString("M")[0].bbox.minX);
    const expected = origin + kerned("Jester's ") + lsbM;
    const old = origin + unkerned("Jester's ") + lsbM;
    // The measurement can tell the two apart (~18 px here).
    expect(old - expected).toBeGreaterThan(12);
    expect(Math.abs(firstDiffX(both, first) - expected)).toBeLessThanOrEqual(1.5);
  }, 60_000);

  it("leaves the same gap after a word whatever it kerns inside", async () => {
    // "Jester's" kerns ' + s (−224/2048 em), "Jesters" has no apostrophe: the
    // gap after the apostrophe word used to grow by that kern and the rest.
    const [a, a0, b, b0] = await Promise.all([
      bake("Jester's Mask"),
      bake("Jester's"),
      bake("Jesters Mask"),
      bake("Jesters"),
    ]);
    const shift = firstDiffX(a, a0) - firstDiffX(b, b0);
    expect(Math.abs(shift - (kerned("Jester's") - kerned("Jesters")))).toBeLessThanOrEqual(1.5);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Centred lines (a token's and an emblem's name: Satori sizes the text node
// from each glyph's own advance but draws the run kerned, so the bake pads a
// centred line to its KERNED width — alignedText in lib/render/card-image.tsx)
// were pinned here on the git "alphatoken" frame until TODO 4.54 retired it.
// The centred templates left (m15token…, m20token…, emblem) have bucket
// masters, so the probes moved to a stubbed-bucket bake: "a centred display
// line (bake): the emblem's name" in tests/unit/render/emblem-bake.test.tsx
// (kerning-heavy names within 2 px of the font's own centre, and a name too
// long for the bar). The retired frame's centred TYPE line was the only one:
// that half of alignedText has no profile to bake until one centres its
// type line again.
// ---------------------------------------------------------------------------
