import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { mainRulesLayout, secondFaceRulesLayout } from "@/lib/cards/rules-box";
import { linePositions, type RulesLayout, type RulesTarget } from "@/lib/cards/rules-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// TODO 4.21e on REAL bakes (flat stand-in masters: the text is the only ink),
// at HD and at the default bake: a card whose switch says "center" has every
// rules line's ink centred on its text box — both halves of a split card, an
// M15 creature's rules, reminder and flavor — where the ONE layout put it;
// with the switch left, or absent, the bake is the same picture, pixel for
// pixel. The prints: MH2 #123, TSR #156 / #161 / #186, C16 #239 / #240 set
// every line's centre on the paper's centre.
// ---------------------------------------------------------------------------

const TONE = 128;
type Raw = { data: Buffer; w: number; h: number };
async function bake(data: CardPreviewData, preset: RenderPreset): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark: false, watermarkText: null });
  const { data: raw, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height };
}
const dark = (r: Raw, x: number, y: number) => {
  const i = (y * r.w + x) * 3;
  return r.data[i] + r.data[i + 1] + r.data[i + 2] < 150;
};
/** The ink's left and right ends inside a line's box (bake px), or null. */
function inkEnds(r: Raw, box: { left: number; top: number; width: number; height: number }, x0: number, x1: number) {
  let left = Infinity;
  let right = -Infinity;
  for (let y = Math.round(box.top) + 2; y < Math.round(box.top + box.height) - 2; y += 1) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
      if (!dark(r, x, y)) continue;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  return Number.isFinite(left) ? { left, right: right + 1 } : null;
}

function card(template: "split" | "m15", rulesAlign: "center" | "left" | undefined, over: Record<string, unknown> = {}): CardPreviewData {
  return {
    title: "Probe",
    cost: "{2}{R}",
    cardType: template === "split" ? "sorcery" : "creature",
    supertype: null,
    subtypes: [],
    rarity: "uncommon",
    colorIdentity: ["red"],
    rulesText: "Discard a card, then draw two cards.",
    flavorText: null,
    power: null,
    toughness: null,
    loyalty: null,
    defense: null,
    artistCredit: null,
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular", ...(rulesAlign ? { rulesAlign } : {}) },
    setIconUrl: null,
    setIconCode: null,
    backFace: template === "split" ? { title: "Probe", cost: "{2}{R}", card_type: "sorcery", rules_text: "Tumble deals 6 damage to each creature with flying." } : null,
    faceContent: null,
    watermark: null,
    ...over,
  } as unknown as CardPreviewData;
}

const PRESETS: [RenderPreset, RulesTarget][] = [["hd", "hd"], ["default", "default"]];

/** Every line of the centred `layout` drawn where the layout put it — the
 *  SAME ink as the left-aligned bake's line (`leftBake`, `leftLayout`),
 *  moved right by exactly the layout's indent — and its ink centred on the
 *  box's centre. */
function expectCentred(r: Raw, layout: RulesLayout, target: RulesTarget, label: string, leftBake: Raw, leftLayout: RulesLayout) {
  const placed = linePositions(layout, target);
  const before = linePositions(leftLayout, target);
  const centre = placed.box.left + placed.box.width / 2;
  const k = target === "hd" ? 1 : 0.5;
  expect(placed.lines.length, label).toBeGreaterThan(0);
  expect(placed.lines.length).toBe(before.lines.length);
  placed.lines.forEach((l, i) => {
    const span: [number, number] = [placed.box.left - 8 * k, placed.box.left + placed.box.width + 8 * k];
    const ink = inkEnds(r, l, ...span);
    const was = inkEnds(leftBake, before.lines[i], ...span);
    expect(ink, `${label}: line ${l.block}/${l.line} has ink`).not.toBeNull();
    expect(was, `${label}: line ${l.block}/${l.line} had ink`).not.toBeNull();
    // The line box didn't move down or up, and the ink moved by the indent.
    expect(l.top).toBe(before.lines[i].top);
    const shift = l.indent - before.lines[i].indent;
    expect(ink!.left - was!.left, `${label}: line ${l.block}/${l.line} moved by its indent (${shift})`).toBe(shift);
    expect(ink!.right - was!.right, `${label}: line ${l.block}/${l.line} end moved by its indent`).toBe(shift);
    // …and its ink is centred on the box (a glyph's bearings — an italic
    // "U" starts 10 px in at HD — and a final full stop's shift the ink a
    // few px off the advance's centre).
    expect(Math.abs((ink!.left + ink!.right) / 2 - centre), `${label}: line ${l.block}/${l.line} centre`).toBeLessThanOrEqual(6 * k + 0.5);
  });
}

describe("a centred split card — both halves, on real bakes", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames([{ template: "split", keys: ["r"], tone: TONE }]);
  }, 60_000);
  afterAll(() => frames.restore());
  const split = getFrameProfile("split");
  const layouts = (c: CardPreviewData, rulesAlign?: string) => ({
    left: mainRulesLayout({ layout: split, rulesText: c.rulesText, aspect: 5 / 7, show: {}, rulesAlign }),
    right: secondFaceRulesLayout({ layout: split, rulesText: (c.backFace as { rules_text: string }).rules_text, aspect: 5 / 7, show: {}, rulesAlign })!,
  });

  it.each(PRESETS)("%s: every line of both halves on its box's centre, where the layout put it", async (preset, target) => {
    const c = card("split", "center");
    const [r, was] = await Promise.all([bake(c, preset), bake(card("split", undefined), preset)]);
    const { left, right } = layouts(c, "center");
    const before = layouts(c);
    expectCentred(r, left, target, "left half", was, before.left);
    expectCentred(r, right, target, "right half", was, before.right);
    // The halves' lines moved: the left-aligned layout starts them at the box's edge.
    expect(linePositions(left, target).lines.every((l) => l.indent > 0)).toBe(true);
    expect(linePositions(right, target).lines.every((l) => l.indent > 0)).toBe(true);
  }, 60_000);

  it.each(PRESETS)("%s: \"left\" and an absent key bake the same picture; centred differs only inside the two text boxes", async (preset, target) => {
    const [absent, left, centred] = await Promise.all([bake(card("split", undefined), preset), bake(card("split", "left"), preset), bake(card("split", "center"), preset)]);
    expect(left.data.equals(absent.data)).toBe(true);
    expect(centred.data.equals(absent.data)).toBe(false);
    const c = card("split", "center");
    const boxes = Object.values(layouts(c, "center")).map((l) => linePositions(l, target).box);
    for (let y = 0; y < absent.h; y += 1) {
      for (let x = 0; x < absent.w; x += 1) {
        const i = (y * absent.w + x) * 3;
        if (absent.data[i] === centred.data[i] && absent.data[i + 1] === centred.data[i + 1] && absent.data[i + 2] === centred.data[i + 2]) continue;
        const inside = boxes.some((b) => x >= b.left && x < b.left + b.width && y >= b.top && y < b.top + b.height);
        if (!inside) throw new Error(`a pixel outside the text boxes changed at ${x},${y}`);
      }
    }
    // Left-aligned: each half's first line starts at its box's left edge.
    for (const l of Object.values(layouts(c))) {
      const placed = linePositions(l, target);
      const ink = inkEnds(absent, placed.lines[0], placed.box.left - 4, placed.box.left + placed.box.width);
      expect(Math.abs(ink!.left - placed.box.left)).toBeLessThanOrEqual(4);
    }
  }, 60_000);

  it("one line and a long text at the ladder's floor are centred too (HD)", async () => {
    const long = "Whenever this creature attacks, draw a card and gain 1 life. ".repeat(6).trim();
    const c = card("split", "center", { rulesText: "Destroy all lands.", backFace: { title: "Probe", cost: "{2}{R}", card_type: "sorcery", rules_text: long } });
    const [r, was] = await Promise.all([bake(c, "hd"), bake({ ...c, frameStyle: { template: "split", finish: "regular" } } as CardPreviewData, "hd")]);
    const { left, right } = layouts(c, "center");
    const before = layouts(c);
    expect(linePositions(left, "hd").lines).toHaveLength(1);
    expect(right.sizePx).toBeLessThan(left.sizePx);
    expect(right.clipped).toBe(false);
    expectCentred(r, left, "hd", "one line", was, before.left);
    expectCentred(r, right, "hd", "long text", was, before.right);
  }, 60_000);
});

describe("a centred M15 card — rules, reminder and flavor, on real bakes", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames([{ template: "m15", keys: ["r"], tone: TONE }]);
  }, 60_000);
  afterAll(() => frames.restore());
  const m15 = getFrameProfile("m15");
  const TEXT = { rulesText: "Flying (This creature can’t be blocked except by creatures with flying or reach.)\nWhen this creature enters, draw a card.", flavorText: "Up, and away." };

  it.each(PRESETS)("%s: every line of the block on the box's centre; left and absent are the same picture", async (preset, target) => {
    const [centred, left, absent] = await Promise.all([
      bake(card("m15", "center", TEXT), preset),
      bake(card("m15", "left", TEXT), preset),
      bake(card("m15", undefined, TEXT), preset),
    ]);
    expect(left.data.equals(absent.data)).toBe(true);
    const layout = mainRulesLayout({ layout: m15, ...TEXT, aspect: 7 / 5, show: {}, rulesAlign: "center" });
    expect(new Set(linePositions(layout, target).lines.map((l) => l.block)).size).toBe(3);
    expectCentred(centred, layout, target, "m15", absent, mainRulesLayout({ layout: m15, ...TEXT, aspect: 7 / 5, show: {} }));
  }, 60_000);
});
