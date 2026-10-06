import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { frontPreviewData } from "@/lib/cards/faces";
import { drawnFloats, drawnStatInk, mainRulesLayout } from "@/lib/cards/rules-box";
import { inkEntersRect, linePositions, rectPx } from "@/lib/cards/rules-layout";
import { END_ALIGNED_STAT_AIR_EM, endAlignedStatKeepOut, statWidthEm } from "@/lib/cards/stat-fit";
import { DFC_REVERSE_PT, getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 5.1d (the skeptic's fix): the transform front's reverse P/T — the
// BACK's P/T drawn end-aligned in the grey tab at the text box's bottom
// right (5.1a) — is a rules FLOAT (lib/cards/rules-box.ts
// DrawnStats.reversePt → RulesLayoutInput.floats): the lines whose rows meet
// the digits break short of them, as the prints set the text round the tab.
// 5.1a drew the digits but never set the lines round them, so a dense text
// ran under "12/12"; a plain keep-out could not fix it — the digits sit
// 80–155 px above the box's bottom, where any block taller than ~277 px
// has lines, and the layout's one remedy for a keep-out, stepping the size
// down, reaches the 42 px floor still colliding. The float is the digits'
// ink footprint (lib/cards/stat-fit.ts endAlignedStatKeepOut: the value's
// laid-out width plus a quarter em of air, against the slot's right edge,
// over its rows), only while they are drawn — the tab prints empty when the
// back prints no P/T (owner decision Q7), and the lines may run to the box's
// edge there. On REAL bakes (the grey stand-in of dfc-bodies-bake.test.tsx):
// a full text box above a 12/12 back leaves the digits' footprint free of
// rules ink at a size well above the floor; the same text above an aura back
// (no digits) fills it. The preview builds the same DrawnStats from the same
// helper (tests/unit/render/render-parity.test.ts).
// ---------------------------------------------------------------------------

const stand = vi.hoisted(() => ({ grey: "", plate: "", rider: "" }));

vi.mock("@/lib/render/card-frames", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/render/card-frames")>();
  return {
    ...real,
    preloadFrame: async () => {},
    preloadFrameAssets: async () => {},
    getFrameDataUrl: () => stand.grey,
    getPlateDataUrlForPath: () => stand.plate,
    getFrameOverlayDataUrl: () => stand.rider,
    getFrameAssetDataUrl: () => null,
  };
});

async function solid(v: number, w = 16, h = 16): Promise<string> {
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: v, g: v, b: v, alpha: 1 } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeAll(async () => {
  stand.grey = await solid(128);
  stand.plate = await solid(40, 64, 32);
  stand.rider = await solid(255, 32, 32);
});

/** Nine lines at the standard size: the box is full, its lower lines reach
 *  the tab's rows and the box's right edge. */
const DENSE =
  "Flying, vigilance, lifelink, menace, trample, haste, reach\nWhenever this creature attacks, choose one —\n• Draw a card, then discard a card.\n• Create a 1/1 white Spirit creature token with flying.\n{2}{W/U}, {T}: Scry 2. (Look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)\nDaybound (If a player casts no spells during their own turn, it becomes night next turn.)";

type Back = NonNullable<CardPreviewData["backFace"]>;
const BACK = {
  title: "Ormendahl, Profane Prince",
  cost: "",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["Demon"],
  rules_text: "Flying, lifelink, indestructible, haste",
  power: "12",
  toughness: "12",
  frame_style: { template: "m15dfcback" },
  color_identity: ["black"],
} as Back;

function card(back: Partial<Back> | null = {}): CardPreviewData {
  return {
    title: "Westvale Abbey",
    cost: "{2}{W}",
    cardType: "creature",
    supertype: null,
    subtypes: ["Human", "Cleric"],
    rarity: "rare",
    colorIdentity: ["white"],
    rulesText: DENSE,
    flavorText: null,
    power: "2",
    toughness: "2",
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template: "m15dfcfront", finish: "regular" },
    backFace: back === null ? null : { ...BACK, ...back },
    faceContent: null,
    watermark: null,
    setCode: null,
    collectorNumber: null,
    lang: null,
  } as unknown as CardPreviewData;
}

type Baked = { lum: Float32Array; w: number; h: number };
async function bake(c: CardPreviewData): Promise<Baked> {
  const { renderCardImage } = await import("@/lib/render/card-image");
  const png = Buffer.from(await (await renderCardImage(c, "hd", { brandMark: false, watermarkText: null })).arrayBuffer());
  // FLOAT_SAVE_DIR: write each bake there for a look (a review aid, never CI).
  if (process.env.FLOAT_SAVE_DIR) {
    const fs = await import("node:fs");
    fs.mkdirSync(process.env.FLOAT_SAVE_DIR, { recursive: true });
    fs.writeFileSync(`${process.env.FLOAT_SAVE_DIR}/${c.backFace?.power ? "with-pt" : "aura"}.png`, png);
  }
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lum = new Float32Array(info.width * info.height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = 0.299 * data[i * 3] + 0.587 * data[i * 3 + 1] + 0.114 * data[i * 3 + 2];
  return { lum, w: info.width, h: info.height };
}
type Box = { x0: number; y0: number; x1: number; y1: number };
const rectBox = (b: Baked, r: { leftPct: number; topPct: number; widthPct: number; heightPct: number }): Box => ({
  x0: (r.leftPct / 100) * b.w,
  x1: ((r.leftPct + r.widthPct) / 100) * b.w,
  y0: (r.topPct / 100) * b.h,
  y1: ((r.topPct + r.heightPct) / 100) * b.h,
});
function count(b: Baked, area: Box, hit: (l: number) => boolean): number {
  let n = 0;
  for (let y = Math.max(0, Math.floor(area.y0)); y < Math.min(b.h, area.y1); y += 1) {
    for (let x = Math.max(0, Math.floor(area.x0)); x < Math.min(b.w, area.x1); x += 1) if (hit(b.lum[y * b.w + x])) n += 1;
  }
  return n;
}
const dark = (l: number) => l < 60;
/** The reverse P/T's grey (#777 = 119) against the mid-grey card (128). */
const reverseGrey = (l: number) => l < 123 && l > 100;

describe("the reverse P/T as a rules float (5.1d)", () => {
  const layout = getFrameProfile("m15dfcfront");
  const digits = endAlignedStatKeepOut(DFC_REVERSE_PT, "12/12");

  it("endAlignedStatKeepOut: the digits' width plus a quarter em of air against the slot's right edge, over its rows — wider for a wider value, never past the slot", () => {
    const em = DFC_REVERSE_PT.sizePct * 100;
    expect(digits.leftPct + digits.widthPct).toBeCloseTo(DFC_REVERSE_PT.rect.leftPct + DFC_REVERSE_PT.rect.widthPct, 9);
    expect(digits.widthPct).toBeCloseTo((statWidthEm("12/12") + END_ALIGNED_STAT_AIR_EM) * em, 9);
    expect(digits.topPct).toBe(DFC_REVERSE_PT.rect.topPct);
    expect(digits.heightPct).toBe(DFC_REVERSE_PT.rect.heightPct);
    // "12/12" at 61 px: 2.36 em of digits → ≈ 10.6 %W from 82.3 to 92.87.
    expect(digits.widthPct).toBeGreaterThan(10);
    expect(digits.widthPct).toBeLessThan(11);
    const narrow = endAlignedStatKeepOut(DFC_REVERSE_PT, "3/2");
    expect(narrow.widthPct).toBeLessThan(digits.widthPct);
    expect(narrow.leftPct).toBeGreaterThan(digits.leftPct);
    const absurd = endAlignedStatKeepOut(DFC_REVERSE_PT, "100000000000/100000000000000000000");
    expect(absurd.leftPct).toBe(DFC_REVERSE_PT.rect.leftPct);
    expect(absurd.widthPct).toBe(DFC_REVERSE_PT.rect.widthPct);
  });

  it("DrawnStats.reversePt is a float, not a keep-out: drawnFloats lists it while drawn, drawnStatInk never", () => {
    expect(drawnFloats({ pt: true, reversePt: digits })).toEqual([digits]);
    expect(drawnFloats({ pt: true, reversePt: null })).toEqual([]);
    expect(drawnFloats({ pt: true })).toEqual([]);
    expect(drawnStatInk(layout, { pt: false, reversePt: digits }, 7 / 5)).toEqual([]);
  });

  it("the layout: the lines whose rows meet the digits end before them at both targets, the others keep the column, the size stays off the floor, nothing is clipped; without the float the same text runs under the digits", () => {
    const withFloat = mainRulesLayout({ layout, rulesText: DENSE, flavorText: null, aspect: 7 / 5, show: { pt: true, reversePt: digits } });
    const without = mainRulesLayout({ layout, rulesText: DENSE, flavorText: null, aspect: 7 / 5, show: { pt: true } });
    expect(withFloat.clipped).toBe(false);
    expect(withFloat.sizePx).toBeGreaterThanOrEqual(46);
    // The float costs at most two ladder steps against the same text set free.
    expect(without.sizePx - withFloat.sizePx).toBeLessThanOrEqual(4);
    for (const target of ["hd", "default"] as const) {
      const f = rectPx(digits, "portrait", 7 / 5, target);
      const placed = linePositions(withFloat, target);
      const meets = placed.lines.filter((l) => l.top < f.bottom && l.top + l.height > f.top);
      expect(meets.length, target).toBeGreaterThan(0);
      for (const l of meets) expect(l.inkRight, `${target} line ${l.block}/${l.line}`).toBeLessThanOrEqual(f.left);
      // A line above the digits still runs past where they start.
      expect(placed.lines.some((l) => l.top + l.height <= f.top && l.inkRight > f.left), target).toBe(true);
      expect(inkEntersRect(withFloat, digits, target), target).toBe(false);
      // Set free, the text's ink does enter the digits' rect.
      expect(inkEntersRect(without, digits, target), target).toBe(true);
    }
  });

  it("on a real bake: a full text box above a 12/12 back keeps its ink out of the digits' footprint; the same text above an aura back runs through it (no digits, no float)", async () => {
    const withPt = await bake(frontPreviewData(card()));
    const keep = rectBox(withPt, digits);
    // The digits are drawn in the footprint…
    expect(count(withPt, keep, reverseGrey)).toBeGreaterThan(200);
    // …and no rules ink is.
    expect(count(withPt, keep, dark)).toBe(0);
    // The text still fills the box above the tab's rows: dark ink on the
    // rows just above the digits, across the box's right half.
    expect(count(withPt, { x0: 700, x1: 1370, y0: keep.y0 - 160, y1: keep.y0 }, dark)).toBeGreaterThan(300);
    // An aura back: no digits, so the lines may run to the box's edge —
    // the same text puts ink where the digits would be.
    // (The empty tab itself is dfc-bodies-bake.test.tsx's: the ink here is
    // the text's, whose anti-aliased edges read mid-grey too.)
    const aura = await bake(frontPreviewData(card({ card_type: "enchantment", supertype: undefined, subtypes: ["Aura"], power: undefined, toughness: undefined })));
    expect(count(aura, keep, dark)).toBeGreaterThan(50);
  }, 120_000);
});
