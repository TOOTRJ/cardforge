import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// Layout v39 (TODO 4.21a follow-up, owner decision 2026-10-02) on REAL bakes
// at HD and at the 750 px default — the profile numbers that follow the
// flip masters' re-cut lower half and put aftermath's cost on the prints:
//   • flip's art slot ends where the re-cut window does: the masters' window
//     now ends at 1310 px (CC's at 1317), the slot's bottom at 1312.1
//     (62.48 %H) — the art the bake draws ends there at both sizes;
//   • flip's upside-down rules rect follows the text box's top edge (the
//     paper from 1467 px, was 1472): 69.86–82.1 %H, the text centred in it;
//   • aftermath's cost ends where AKH #210–214 / HOU #157 end their last
//     disc — 1383–1385 px (mean 1384.0), the discs centred on row 158–161
//     (mean 159.4; Scryfall PNGs at 1500 × 2100) — where v38 left it at 1357
//     and 168: the title rect runs to 92.3 %W, costDy lifts the discs 8.6 px.
// The masters are bucket objects, so each bake is served a flat stand-in
// (tests/stubs/stand-in-frames.ts): the art, the text and the pips are the
// only marks on the card. The re-cut masters themselves are held by
// tests/unit/frames/flip-lower-block.test.ts.
// ---------------------------------------------------------------------------

const flip = getFrameProfile("flip");
const aftermath = getFrameProfile("aftermath");
const ART = [230, 40, 180] as const; // the only magenta on the card
const TONE = 128;

let frames: StandInFrames;
beforeAll(async () => {
  frames = await serveStandInFrames([
    { template: "flip", keys: ["g"], tone: TONE },
    { template: "aftermath", keys: ["r"], tone: TONE },
  ]);
}, 60_000);
afterAll(() => frames.restore());

/** A flat magenta picture (wider than the window: a cover fit crops the sides). */
async function magentaArt(): Promise<string> {
  const [w, h] = [1400, 700];
  const buf = Buffer.alloc(w * h * 3);
  for (let p = 0; p < w * h; p += 1) buf.set(ART, p * 3);
  const png = await sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

function flipCard(over: Partial<CardPreviewData> = {}): CardPreviewData {
  return {
    title: "Budoka Gardener",
    cost: "{1}{G}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Monk"],
    rarity: "rare",
    colorIdentity: ["green"],
    rulesText: "{T}: You may put a land card from your hand onto the battlefield.",
    flavorText: null,
    power: "2",
    toughness: "1",
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "flip", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: {
      title: "Dokai, Weaver of Life",
      card_type: "creature",
      supertype: "Legendary",
      subtypes: ["Human", "Monk"],
      power: "3",
      toughness: "3",
      rules_text: "Create an X/X green Spirit creature token.",
    },
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

function aftermathCard(): CardPreviewData {
  return {
    title: "Insult",
    cost: "{2}{R}",
    cardType: "sorcery",
    supertype: null,
    subtypes: [],
    rarity: "rare",
    colorIdentity: ["red"],
    rulesText: "Damage can't be prevented this turn.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: "Probe",
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "aftermath", finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: { title: "Injury", card_type: "sorcery", mana_cost: "{2}{R}", rules_text: "Injury deals 3 damage to target creature." },
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

type Raw = { data: Buffer; w: number; h: number };
async function bake(data: CardPreviewData, preset: RenderPreset): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark: false, watermarkText: null });
  const { data: raw, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height };
}
const px = (r: Raw, x: number, y: number) => {
  const i = (y * r.w + x) * 3;
  return [r.data[i], r.data[i + 1], r.data[i + 2]];
};
const isMagenta = (c: number[]) => Math.abs(c[0] - ART[0]) < 40 && Math.abs(c[1] - ART[1]) < 40 && Math.abs(c[2] - ART[2]) < 40;
const isDark = (c: number[]) => c[0] + c[1] + c[2] < 150;
/** Not the stand-in's flat tone (a pip's disc, its outline or shadow). */
const isMark = (c: number[]) => Math.abs(c[0] - TONE) + Math.abs(c[1] - TONE) + Math.abs(c[2] - TONE) > 60;

type Box = { x0: number; x1: number; y0: number; y1: number };
const boxOf = (rect: Rect, r: Raw): Box => ({
  x0: (rect.leftPct / 100) * r.w,
  x1: ((rect.leftPct + rect.widthPct) / 100) * r.w,
  y0: (rect.topPct / 100) * r.h,
  y1: ((rect.topPct + rect.heightPct) / 100) * r.h,
});

/** The rows holding a pixel that satisfies `pred` inside a box: first and
 *  last, in HD px (whatever the bake's size). */
function rowSpan(r: Raw, box: Box, pred: (c: number[]) => boolean): { first: number; last: number } {
  const k = r.w / 1500;
  let first = Infinity;
  let last = -Infinity;
  for (let y = Math.ceil(box.y0); y < Math.floor(box.y1); y += 1) {
    for (let x = Math.ceil(box.x0); x < Math.floor(box.x1); x += 1) {
      if (!pred(px(r, x, y))) continue;
      first = Math.min(first, y);
      last = Math.max(last, y);
      break;
    }
  }
  expect(Number.isFinite(first), "rows found").toBe(true);
  return { first: first / k, last: (last + 1) / k };
}

describe("layout v39 — flip's lower half on real bakes (HD and 750)", () => {
  it("the art slot ends at the re-cut window's bottom: 62.48 %H, 1312 px", () => {
    // 29.57 + 32.91: the masters' window 623–1310 px with 2.0 / 2.1 px to
    // spare (7.6's 0.05 %); v38's 33.25 ended at 1319.25, over CC's 1317.
    expect(flip.artSlot).toEqual({ topPct: 29.57, leftPct: 7.57, widthPct: 84.87, heightPct: 32.91 });
    expect((flip.artSlot.topPct + flip.artSlot.heightPct) * 21).toBeCloseTo(1312.08, 2);
  });

  it.each(["hd", "default"] as const)("draws the art down to 1312 px and no further, at %s", async (preset) => {
    const r = await bake(flipCard({ artUrl: await magentaArt() }), preset);
    const k = r.w / 1500;
    // The card's middle columns, from the type bar down to the upside-down
    // type bar: the magenta's last row is the slot's bottom (the stand-in's
    // window is cut at the slot).
    const span = rowSpan(r, { x0: 600 * k, x1: 900 * k, y0: 600 * k, y1: 1340 * k }, isMagenta);
    expect(Math.abs(span.last - 1312), `art ends at ${span.last}`).toBeLessThanOrEqual(preset === "hd" ? 1 : 2);
    expect(Math.abs(span.first - 621), `art starts at ${span.first}`).toBeLessThanOrEqual(preset === "hd" ? 1 : 2);
  }, 120_000);

  it("the upside-down rules rect follows the text box's top edge: 69.86–82.1 %H", () => {
    // CC's rules2 box started on its paper's first row, 1472 px; the re-cut
    // put the paper's first row at 1467 (5 px up), the bottom edge where it
    // was (82.1 %H = 1724.1 px).
    const rect = flip.secondFace!.rules.rect;
    expect(rect).toEqual({ topPct: 69.86, leftPct: 8.6, widthPct: 82.8, heightPct: 12.24 });
    expect(rect.topPct * 21).toBeCloseTo(1467.06, 2);
    expect((rect.topPct + rect.heightPct) * 21).toBeCloseTo(1724.1, 2);
    expect(flip.secondFace!.rules.vAlign).toBe("center");
  });

  it.each(["hd", "default"] as const)("centres the upside-down creature's one rules line in the rect, at %s", async (preset) => {
    const r = await bake(flipCard(), preset);
    const rect = boxOf(flip.secondFace!.rules.rect, r);
    // The line's ink (the only dark marks between the bottom plate's rows
    // and the upside-down name bar, inside the rect's columns).
    const k = r.w / 1500;
    const ink = rowSpan(r, { x0: rect.x0 + 20 * k, x1: rect.x1 - 20 * k, y0: rect.y0, y1: rect.y1 }, isDark);
    const centre = (ink.first + ink.last) / 2;
    const rectCentre = (flip.secondFace!.rules.rect.topPct + flip.secondFace!.rules.rect.heightPct / 2) * 21;
    expect(rectCentre).toBeCloseTo(1595.58, 2);
    // Centred on the rect's middle (1595.6 px); on v38's rect it sat on 1598.
    expect(Math.abs(centre - rectCentre), `the line's centre ${centre}`).toBeLessThanOrEqual(preset === "hd" ? 2 : 3);
  }, 120_000);

  it("leaves the upside-down type line, the plates and the cost where v38 put them", () => {
    // The bar moved up under the type line; the line keeps its print-matched
    // place (its body 30–34 px below the bar's face top on both prints).
    expect(flip.secondFace!.type.rect).toEqual({ topPct: 63.63, leftPct: 20.6, widthPct: 70.87, heightPct: 5.43 });
    expect(flip.secondFace!.pt!.plateRect).toEqual({ topPct: 1321 / 21, leftPct: 53 / 15, widthPct: 243 / 15, heightPct: 160 / 21 });
    expect(flip.pt!.plateRect).toEqual({ topPct: 475 / 21, leftPct: 1176 / 15, widthPct: 243 / 15, heightPct: 160 / 21 });
    expect(flip.title.rect.leftPct + flip.title.rect.widthPct).toBeCloseTo(92.5, 6);
    expect(flip.costDy).toBe(-0.0064);
  });
});

describe("layout v39 — aftermath's cost on the prints (HD and 750)", () => {
  it("runs the title rect to 92.3 %W and lifts the discs 8.6 px; the name's edge and baseline stay", () => {
    expect(aftermath.title.rect).toEqual({ topPct: 5.7, leftPct: 8.5, widthPct: 83.8, heightPct: 4.4 });
    expect(aftermath.title.rect.leftPct + aftermath.title.rect.widthPct).toBeCloseTo(92.3, 6);
    expect(aftermath.costDy).toBeCloseTo(-8.6 / 1500, 9);
    expect(aftermath.type.rect).toEqual({ topPct: 35.4, leftPct: 8, widthPct: 82.7, heightPct: 3.8 });
  });

  it.each(["hd", "default"] as const)("keeps the name's baseline (190 px) and left edge, at %s", async (preset) => {
    const r = await bake(aftermathCard(), preset);
    const k = r.w / 1500;
    // The name's body: the rows holding ≥ 35 % of the most-inked row's dark
    // pixels, left of the pips (the measure the prints were read with —
    // v38's bake set the body's last row on 190 px, AKH #213's print 189).
    const counts: number[] = [];
    for (let y = Math.ceil(100 * k); y < Math.floor(230 * k); y += 1) {
      let n = 0;
      for (let x = Math.ceil(120 * k); x < Math.floor(800 * k); x += 1) if (isDark(px(r, x, y))) n += 1;
      counts.push(n);
    }
    const max = Math.max(...counts);
    const body = counts.map((n, i) => (n >= max * 0.35 ? i : -1)).filter((i) => i >= 0);
    const baseline = (Math.ceil(100 * k) + body[body.length - 1]) / k;
    expect(Math.abs(baseline - 190), `the name's baseline ${baseline}`).toBeLessThanOrEqual(preset === "hd" ? 2 : 3);
    let first = Infinity;
    for (let y = Math.ceil(100 * k); y < Math.floor(230 * k); y += 1) {
      for (let x = Math.ceil(100 * k); x < Math.floor(400 * k); x += 1) {
        if (isDark(px(r, x, y))) {
          first = Math.min(first, x);
          break;
        }
      }
    }
    // The rect's left edge is 8.5 %W (127.5 px); Beleren's "I" starts a few px in.
    expect(first / k, `the name's first ink column ${first / k}`).toBeGreaterThanOrEqual(126);
    expect(first / k).toBeLessThanOrEqual(145);
  }, 120_000);

  it.each(["hd", "default"] as const)("ends the last disc at 1384 px and centres the discs on row 159.5, at %s", async (preset) => {
    const r = await bake(aftermathCard(), preset);
    const k = r.w / 1500;
    const title = boxOf(aftermath.title.rect, r);
    // The pips are the only marks right of the name: the rightmost one.
    let last = -1;
    for (let y = Math.ceil(title.y0); y < Math.floor(title.y1 + 12 * k); y += 1) {
      for (let x = r.w - 1; x > last; x -= 1) {
        if (isMark(px(r, x, y))) {
          last = x;
          break;
        }
      }
    }
    const edge = (last + 1) / k;
    expect(Math.abs(edge - 1384.5), `the cost's right edge ${edge}`).toBeLessThanOrEqual(preset === "hd" ? 2 : 3);
    // The discs' rows (their colour, outline and shadow, as measured on the
    // prints: 120–197 on AKH #212, centre 158–161 across the six prints).
    const span = rowSpan(r, { x0: 1200 * k, x1: 1440 * k, y0: 90 * k, y1: 230 * k }, isMark);
    const centre = (span.first + span.last) / 2;
    expect(Math.abs(centre - 159.5), `the discs' centre ${centre}`).toBeLessThanOrEqual(preset === "hd" ? 2 : 3);
    // …where v38 left them: the edge at 1357, the centre at 168.
    expect(edge).toBeGreaterThan(1375);
    expect(centre).toBeLessThan(164);
  }, 120_000);
});
