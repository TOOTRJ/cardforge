import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { pipScale } from "@/lib/cards/mana-gem";
import { symbolStyle, symbolStyleOf } from "@/lib/cards/symbol-style";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { DETACHED_COST_GAP_PCT, fitTitleBand, manaCostWidthPct, titleBandRoomPct } from "@/lib/cards/title-band";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// A name before a DETACHED cost of Phyrexian symbols, on REAL bakes (layout
// v52, TODO 6.16d). Since v49 a Phyrexian symbol — one colour or two — sits
// on a disc ×1.2 (lib/cards/mana-gem.ts pipScale), but the name's room on
// the frames that place the cost in a box of its own (FrameProfile.costRect)
// was measured with every pip a plain disc (lib/cards/title-band.ts
// manaCostWidthPct): at HD the longest name the fit kept whole ended 13 px
// from the first of three such discs on `modern` and 2 px on `m15pw`, and
// 42 / 67 px UNDER the first of seven. Each pip now counts its own disc.
//
// Measured by difference, on flat stand-in masters (tests/stubs/stand-in-
// frames.ts — the real ones are frames-bucket objects): the cost row is what
// differs between a card with the cost and the same card without, the name
// what differs between the long name and a one-letter one before the same
// cost. Both presets: the 750 px bake rounds every disc and gap apart. On
// main (1985ba23) all eight bake tests below fail.
// ---------------------------------------------------------------------------

/** Every template that draws its cost in a box of its own. */
const TEMPLATES = ["modern", "m15pw", "m15borderlesspw", "m15borderlesspwtall"] as const;
const HD_W = 1500;
/** Long enough to be cut at the floor before any cost. */
const LONG = "Elesh Norn, Grand Cenobite of the Machine Orthodoxy and Its Praetors";
/** The least air, in HD px, between the name's ink and the first disc's
 *  (its shadow's) left edge. The name's box ends DETACHED_COST_GAP_PCT
 *  (30 px) before the row as measured; the row as DRAWN is a little
 *  longer — the style's shadow (5 px on the walkers) and the bake's whole-px
 *  discs, up to 1 px a pip. Measured: 36–56 px (`modern`) and 23–52 px
 *  (the walkers) at 1–10 larger discs; plain pips keep 27–60 px. */
const MIN_AIR_HD_PX = 20;

/** `n` larger discs: one-colour Phyrexian symbols, every third a two-colour
 *  one; none = a plain cost. */
const scaledCost = (n: number) =>
  n === 0 ? "{2}{R}{R}" : Array.from({ length: n }, (_, i) => (i % 3 === 2 ? "{G/U/P}" : "{R/P}")).join("");
/** The plain cost with as many pips. */
const plainTwin = (n: number) => (n === 0 ? "{2}{R}{R}" : "{R}".repeat(n));

function card(template: string, title: string, cost: string | null): CardPreviewData {
  const walker = template !== "modern";
  return {
    title,
    cost,
    cardType: walker ? "planeswalker" : "creature",
    supertype: null,
    subtypes: [],
    rarity: "rare",
    colorIdentity: ["red"],
    rulesText: walker ? "+1: Scry 1." : "Flying",
    flavorText: null,
    power: walker ? null : "5",
    toughness: walker ? null : "5",
    loyalty: walker ? "4" : null,
    defense: null,
    artistCredit: "Edna",
    artUrl: null,
    artPosition: {},
    frameStyle: { template, finish: "regular" },
    setIconUrl: null,
    setIconCode: null,
    backFace: null,
    faceContent: null,
    watermark: null,
  } as unknown as CardPreviewData;
}

type Raw = { data: Buffer; w: number; h: number };
async function bake(data: CardPreviewData, preset: RenderPreset): Promise<Raw> {
  const res = await renderCardImage(data, preset, { brandMark: false, watermarkText: null, corners: "square" });
  const { data: raw, info } = await sharp(Buffer.from(await res.arrayBuffer())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: raw, w: info.width, h: info.height };
}
/** The columns (bake px) in which two bakes differ, within the top fifth. */
function diffColumns(a: Raw, b: Raw, minDelta = 24): { x0: number; x1: number } | null {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (let y = 0; y < Math.round(a.h * 0.2); y += 1) {
    for (let x = 0; x < a.w; x += 1) {
      const i = (y * a.w + x) * 3;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) < minDelta) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
    }
  }
  return Number.isFinite(x0) ? { x0, x1 } : null;
}

/** The longest prefix of LONG the fit keeps whole before `cost` (shrunk to
 *  its room, the name's box as wide as it gets) — and LONG itself, cut. */
function namesFor(template: string, cost: string): string[] {
  const profile = getFrameProfile(template);
  for (let length = LONG.length; length > 2; length -= 1) {
    const name = LONG.slice(0, length).trimEnd();
    if (/[,\s]$/.test(name)) continue;
    if (fitTitleBand(profile, name, cost)?.text === name) return [name, LONG];
  }
  return [LONG];
}

describe("the detached-cost templates", () => {
  it("are these four — every profile that places a cost it draws in its own box", () => {
    const detached = FRAME_TEMPLATE_VALUES.filter((t) => {
      const p = getFrameProfile(t);
      return Boolean(p.costRect) && !p.hideCost;
    });
    expect([...detached].sort()).toEqual([...TEMPLATES].sort());
  });
});

describe("the measured cost row — each pip at its own disc", () => {
  it("a cost with no larger disc measures to the SAME float as one plain disc per pip", () => {
    const GAP = 0.12;
    for (const disc of [0.044, 0.0485, 0.05333333333333334, 0.0367]) {
      // (No hybrid or twobrid here: layout v53 made their discs large too.)
      for (const cost of ["{R}", "{2}{R}{R}", "{X}{W}{2}{S}{C}", "{10}{G}{G}{G}{G}{G}", "{W}{U}{B}{R}{G}{W}{U}{B}{R}{G}", "{Q}{E}{T}"]) {
        const pips = cost.match(/\{[^}]*\}/g)!.length;
        let plain = 0;
        for (let i = 0; i < pips; i += 1) plain += disc;
        for (const style of [symbolStyle(undefined), symbolStyle("2003")]) expect(manaCostWidthPct(cost, disc, style), `${cost} @ ${disc}`).toBe(plain + (pips - 1) * GAP * disc);
      }
    }
  });

  it("a Phyrexian symbol — one colour or two — counts pipScale discs, from the one source", () => {
    const M15 = symbolStyle(undefined);
    expect(pipScale("rp", M15)).toBe(1.2);
    expect(pipScale("gup", M15)).toBe(1.2);
    const disc = 0.044;
    expect(manaCostWidthPct("{R/P}", disc, M15)).toBe(disc * pipScale("rp", M15));
    expect(manaCostWidthPct("{G/U/P}", disc, M15)).toBe(disc * pipScale("gup", M15));
    expect(manaCostWidthPct("{1}{R/P}{R/P}", disc, M15)).toBeCloseTo(disc * (1 + 2 * 1.2 + 2 * 0.12), 12);
    // A hybrid and a twobrid count the same larger disc since layout v53.
    expect(manaCostWidthPct("{1}{W/U}{2/W}", disc, M15)).toBe(manaCostWidthPct("{1}{R/P}{R/P}", disc, M15));
    // …and so the name's room shrinks by the style's extra share of a disc
    // per symbol: a fifth, or 19/66 on the 2003 frame (85 px beside 66).
    for (const template of TEMPLATES) {
      const p = getFrameProfile(template);
      const d = p.costSizePct ?? p.title.sizePct;
      const extra = symbolStyleOf(p).largePipScale - 1;
      expect(extra, template).toBeCloseTo(template === "modern" ? 19 / 66 : 0.2, 12);
      for (let n = 1; n <= 10; n += 1) {
        expect(titleBandRoomPct(p, plainTwin(n)) - titleBandRoomPct(p, scaledCost(n)), `${template} ${n}`).toBeCloseTo(n * extra * d, 10);
      }
    }
  });
});

describe("a name before a detached cost of Phyrexian symbols — real bakes", () => {
  let frames: StandInFrames;
  beforeAll(async () => {
    frames = await serveStandInFrames(TEMPLATES.map((template) => ({ template, keys: ["r"], tone: 128 })));
  });
  afterAll(() => frames.restore());

  for (const template of TEMPLATES) {
    for (const preset of ["hd", "default"] as const) {
      it(`${template} @ ${preset}: 0–10 larger discs — the name's ink ends ${MIN_AIR_HD_PX} HD px or more before the first disc, and the row is as long as measured`, async () => {
        const k = HD_W / (preset === "hd" ? 1500 : 750);
        const profile = getFrameProfile(template);
        const disc = profile.costSizePct ?? profile.title.sizePct;
        const rowRight = ((profile.costRect!.leftPct + profile.costRect!.widthPct) / 100) * HD_W;
        const bare = await bake(card(template, "I", null), preset);
        for (let n = 0; n <= 10; n += 1) {
          const cost = scaledCost(n);
          const row = await bake(card(template, "I", cost), preset);
          const discs = diffColumns(row, bare);
          expect(discs, `${n}: the cost is drawn`).not.toBeNull();
          const firstDisc = discs!.x0 * k;
          // The row as drawn is the row as measured, but for the style's
          // shadow (≤ 6 px) and whole-px discs and gaps (a 750 px one is
          // two of HD) — which no plain cost counted either.
          const measuredLeft = rowRight - manaCostWidthPct(cost, disc, symbolStyleOf(profile)) * HD_W;
          expect(Math.abs(firstDisc - measuredLeft), `${n}: first disc at ${firstDisc}, measured ${measuredLeft.toFixed(1)}`).toBeLessThanOrEqual(8 + n * k);
          for (const name of namesFor(template, cost)) {
            const drawn = diffColumns(await bake(card(template, name, cost), preset), row);
            expect(drawn, `${n} "${name}": the name is drawn`).not.toBeNull();
            const inkEnd = (drawn!.x1 + 1) * k;
            expect(firstDisc - inkEnd, `${n} pips, "${name}": ink ends ${inkEnd}, first disc ${firstDisc}`).toBeGreaterThanOrEqual(MIN_AIR_HD_PX);
          }
        }
        // The name's box itself stops the detached gap short of the row.
        expect(DETACHED_COST_GAP_PCT * HD_W).toBe(30);
      }, 300_000);
    }
  }
});
