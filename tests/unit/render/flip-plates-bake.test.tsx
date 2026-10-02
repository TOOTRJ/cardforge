import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { frameAssetPathsFor, renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// TODO 4.21a, layout v38 — flip's P/T plates on REAL bakes, at HD and at the
// 750 px default: the top creature's plate in its box upright, the bottom
// creature's plate in ITS box UNTURNED (the source draws it upside-down, as
// the printed card shows it: C18 #134, CM2 #71), each only when its half has
// a P/T, and both preloaded by frameAssetPathsFor. The masters live in the
// frames bucket, so the bake is served a flat grey stand-in master and a
// stand-in plate: a cyan field (the only cyan on the card) with a dark
// square in its top-left fifth — a turned plate would put the square at the
// bottom-right. The preview's twin: tests/unit/components/flip-plates-preview.test.tsx.
// ---------------------------------------------------------------------------

const PLATE = [40, 200, 230] as const;
const flip = getFrameProfile("flip");
const TOP = flip.pt!;
const BOTTOM = flip.secondFace!.pt!;

let frames: StandInFrames;
beforeAll(async () => {
  frames = await serveStandInFrames([
    {
      template: "flip",
      keys: ["g"],
      plates: {
        [TOP.plateAssetPathTemplate!]: { rgb: PLATE, mark: true },
        [BOTTOM.plateAssetPathTemplate!]: { rgb: PLATE, mark: true },
      },
    },
  ]);
}, 60_000);
afterAll(() => frames.restore());

function card(over: Partial<CardPreviewData> = {}): CardPreviewData {
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
      rules_text: "{4}{G}, {T}: Create an X/X green Elemental creature token.",
    },
    faceContent: null,
    watermark: null,
    ...over,
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
const isCyan = (c: number[]) => Math.abs(c[0] - PLATE[0]) < 40 && Math.abs(c[1] - PLATE[1]) < 40 && Math.abs(c[2] - PLATE[2]) < 40;
const isDark = (c: number[]) => c[0] + c[1] + c[2] < 150;

type Box = { x0: number; x1: number; y0: number; y1: number };
const boxOf = (rect: Rect, r: Raw): Box => ({
  x0: (rect.leftPct / 100) * r.w,
  x1: ((rect.leftPct + rect.widthPct) / 100) * r.w,
  y0: (rect.topPct / 100) * r.h,
  y1: ((rect.topPct + rect.heightPct) / 100) * r.h,
});
/** The share of a box's pixels (inset by `inset` px) that satisfy `pred`. */
function share(r: Raw, box: Box, pred: (c: number[]) => boolean, inset = 0): number {
  let hit = 0;
  let n = 0;
  for (let y = Math.ceil(box.y0 + inset); y < Math.floor(box.y1 - inset); y += 1) {
    for (let x = Math.ceil(box.x0 + inset); x < Math.floor(box.x1 - inset); x += 1) {
      if (pred(px(r, x, y))) hit += 1;
      n += 1;
    }
  }
  return n ? hit / n : 0;
}
/** A box's corner fifth: the top-left ("tl") or the bottom-right ("br"). */
function fifth(box: Box, corner: "tl" | "br"): Box {
  const w = (box.x1 - box.x0) / 5;
  const h = (box.y1 - box.y0) / 5;
  return corner === "tl" ? { x0: box.x0, x1: box.x0 + w, y0: box.y0, y1: box.y0 + h } : { x0: box.x1 - w, x1: box.x1, y0: box.y1 - h, y1: box.y1 };
}
/** Cyan pixels outside both plate boxes (grown by `pad` px). */
function cyanOutside(r: Raw, boxes: Box[], pad: number): number {
  let n = 0;
  for (let y = 0; y < r.h; y += 1) {
    for (let x = 0; x < r.w; x += 1) {
      if (!isCyan(px(r, x, y))) continue;
      if (boxes.some((b) => x >= b.x0 - pad && x < b.x1 + pad && y >= b.y0 - pad && y < b.y1 + pad)) continue;
      n += 1;
    }
  }
  return n;
}

describe("flip's P/T plates — real bakes", () => {
  const shares: Record<string, number[]> = {};

  it.each(["hd", "default"] as const)("draws both plates in their own boxes, the bottom one unturned, at %s", async (preset) => {
    const r = await bake(card(), preset);
    const top = boxOf(TOP.plateRect!, r);
    const bottom = boxOf(BOTTOM.plateRect!, r);
    for (const [name, box] of [
      ["top", top],
      ["bottom", bottom],
    ] as const) {
      // The plate fills its box (the mark, the digits and the resampled
      // rim take the rest).
      const filled = share(r, box, isCyan, 2);
      expect(filled, `${name} plate at ${preset}`).toBeGreaterThan(0.6);
      (shares[name] ??= []).push(filled);
      // The dark square sits in the box's TOP-LEFT fifth in card space on
      // BOTH plates: the bottom plate is not turned with its value.
      expect(share(r, fifth(box, "tl"), isDark, 2), `${name} mark at ${preset}`).toBeGreaterThan(0.6);
      expect(share(r, fifth(box, "br"), isDark, 2), `${name} no mark bottom-right at ${preset}`).toBeLessThan(0.05);
      // The value's ink lies on the plate (the digits, dark on the cyan).
      const value = boxOf(name === "top" ? TOP.rect : BOTTOM.rect, r);
      expect(share(r, value, isDark), `${name} value at ${preset}`).toBeGreaterThan(0.03);
    }
    // No plate anywhere else on the card.
    expect(cyanOutside(r, [top, bottom], 3)).toBe(0);
  }, 120_000);

  it("fills each box by the same share at HD and at 750 (preview ⇄ bake parity of the box, both sizes)", () => {
    for (const name of ["top", "bottom"]) {
      expect(shares[name], name).toHaveLength(2);
      expect(Math.abs(shares[name][0] - shares[name][1]), name).toBeLessThan(0.04);
    }
  });

  it("draws a plate only for a half that has a P/T", async () => {
    const noBottom = card({ backFace: { title: "Dokai's Essence", card_type: "enchantment", subtypes: [], rules_text: "Creatures you control get +1/+1." } } as never);
    const r1 = await bake(noBottom, "default");
    expect(share(r1, boxOf(BOTTOM.plateRect!, r1), isCyan, 2)).toBe(0);
    expect(share(r1, boxOf(TOP.plateRect!, r1), isCyan, 2)).toBeGreaterThan(0.6);
    const noTop = card({ power: null, toughness: null });
    const r2 = await bake(noTop, "default");
    expect(share(r2, boxOf(TOP.plateRect!, r2), isCyan, 2)).toBe(0);
    expect(share(r2, boxOf(BOTTOM.plateRect!, r2), isCyan, 2)).toBeGreaterThan(0.6);
  }, 120_000);

  // Where the prints put their digits (C18 #134 and CM2 #71, Scryfall PNGs at
  // 1500 × 2100 — the test card carries C18's values, 2/1 and 3/3): the top
  // digits' ink centres on (1311, 549.5) px, the upside-down ones on
  // (188.5 / 194, 1386.5). The plate tests above only ask that SOME ink lies
  // in the value's rect — a value 15 px off its print passed them — so the
  // centre is pinned here: the top value carries the front's lift
  // (valueDyEm), the bottom one none (a nudge moves a turned value the other
  // way in card space).
  it.each(["hd", "default"] as const)("prints each half's digits on the prints' digits, at %s", async (preset) => {
    const r = await bake(card(), preset);
    const k = r.w / 1500;
    const inkCentre = (slot: typeof TOP) => {
      const rect = boxOf(slot.rect, r);
      // The value's rect, clear of the stand-in plate's corner mark.
      const mark = fifth(boxOf(slot.plateRect!, r), "tl");
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let y = Math.ceil(rect.y0); y < Math.floor(rect.y1); y += 1) {
        for (let x = Math.ceil(Math.max(rect.x0, mark.x1 + 2)); x < Math.floor(rect.x1); x += 1) {
          if (!isDark(px(r, x, y))) continue;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
          y0 = Math.min(y0, y);
          y1 = Math.max(y1, y);
        }
      }
      expect(Number.isFinite(x0), "digits found").toBe(true);
      // In HD px, whatever the bake's size.
      return { x: (x0 + x1 + 1) / 2 / k, y: (y0 + y1 + 1) / 2 / k };
    };
    const top = inkCentre(TOP);
    expect(Math.abs(top.x - 1311), `top digits' centre x ${top.x}`).toBeLessThanOrEqual(2);
    expect(Math.abs(top.y - 549.5), `top digits' centre y ${top.y}`).toBeLessThanOrEqual(2);
    const bottom = inkCentre(BOTTOM);
    expect(Math.abs(bottom.x - 191), `bottom digits' centre x ${bottom.x}`).toBeLessThanOrEqual(3.5);
    expect(Math.abs(bottom.y - 1386.5), `bottom digits' centre y ${bottom.y}`).toBeLessThanOrEqual(2.5);
    // The profile says so: the front's lift on the top plate only.
    expect(TOP.valueDyEm).toBe(-0.04);
    expect(BOTTOM.valueDyEm).toBe(0);
  }, 120_000);

  // The prints' cost: the last disc's right edge is 1387 px on C18 #134 and
  // 1388.5 on CM2 #71 (Scryfall PNGs at 1500 × 2100, the disc's colour
  // against the bar's at half level). packFlip.js right-aligns its MANA box
  // at 92.92 %W — its title box ends at 91.46 — so the title rect, which
  // carries the cost at its right end, runs to 92.5 %W. On the flat grey
  // master the name and the pips are the only marks in the title's rows.
  it.each(["hd", "default"] as const)("ends the cost where the prints' pips end, at %s", async (preset) => {
    const r = await bake(card(), preset);
    const k = r.w / 1500;
    const title = boxOf(flip.title.rect, r);
    let last = -1;
    for (let y = Math.ceil(title.y0 + 8 * k); y < Math.floor(title.y1 - 8 * k); y += 1) {
      for (let x = r.w - 1; x > last; x -= 1) {
        const c = px(r, x, y);
        if (Math.abs(c[0] - 128) + Math.abs(c[1] - 128) + Math.abs(c[2] - 128) > 60) {
          last = x;
          break;
        }
      }
    }
    const edge = (last + 1) / k;
    expect(flip.title.rect.leftPct).toBe(8.54);
    expect(flip.title.rect.leftPct + flip.title.rect.widthPct).toBeCloseTo(92.5, 6);
    expect(Math.abs(edge - 1387.5), `the cost's right edge ${edge}`).toBeLessThanOrEqual(preset === "hd" ? 2 : 3);
    // …where the title box alone (91.46 %W, 1372 px) left it 16 px short.
    expect(edge).toBeGreaterThan(1380);
  }, 120_000);

  it("preloads exactly the plates it draws (frameAssetPathsFor), and the bake fetched them", () => {
    expect(frameAssetPathsFor(card())).toEqual(["/frames/flip/pt/g-top.png", "/frames/flip/pt/g-bottom.png"]);
    expect(frameAssetPathsFor(card({ power: null, toughness: null }))).toEqual(["/frames/flip/pt/g-bottom.png"]);
    expect(frames.fetched).toEqual(expect.arrayContaining(["flip/pt/g-top.png", "flip/pt/g-bottom.png", "flip/g.png"]));
  });
});
