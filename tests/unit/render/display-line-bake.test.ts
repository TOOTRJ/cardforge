import { readFileSync } from "node:fs";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
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

function card(title: string): CardPreviewData {
  return {
    title,
    cost: "{3}{R}{R}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Dragon"],
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
    frameStyle: { template: "retro", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as CardPreviewData;
}

type Raw = { data: Buffer; width: number; height: number };
async function bake(title: string): Promise<Raw> {
  const res = await renderCardImage(card(title), "hd", { brandMark: false, watermarkText: null });
  const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** First pixel column, inside the title band, where two bakes differ by more
 *  than 24 on any channel — the left ink edge of the word only one has. */
function firstDiffX(a: Raw, b: Raw): number {
  const y0 = Math.floor((TITLE.rect.topPct / 100) * a.height);
  const y1 = Math.ceil(((TITLE.rect.topPct + TITLE.rect.heightPct) / 100) * a.height);
  for (let x = 0; x < a.width; x += 1) {
    for (let y = y0; y < y1; y += 1) {
      const i = (y * a.width + x) * 3;
      if (
        Math.abs(a.data[i] - b.data[i]) > 24 ||
        Math.abs(a.data[i + 1] - b.data[i + 1]) > 24 ||
        Math.abs(a.data[i + 2] - b.data[i + 2]) > 24
      ) {
        return x;
      }
    }
  }
  return -1;
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
