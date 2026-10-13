import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { DETACHED_COST_GAP_PCT, fitTitleBand, manaCostWidthPct } from "@/lib/cards/title-band";
import { renderCardImage, type RenderPreset } from "@/lib/render/card-image";
import { serveStandInFrames, type StandInFrames } from "@/tests/stubs/stand-in-frames";

// ---------------------------------------------------------------------------
// The real bakes of title-room-scaled-pips-bake.test.tsx (what they measure:
// that file's header), registered in title-room-scaled-pips-bake-<n>.test.ts.
//
// WHY PARTS. The eight bake tests are some 270 HD and 750 px Satori bakes: 3.5 to 4.7 minutes
// in CI as one file, on one worker — the longest file of the unit suite once
// the art-window masters were split (art-window-masters.ts), and so the floor
// of its shard. Template i of TITLE_ROOM_TEMPLATES belongs to part
// (i mod PARTS) + 1: with four templates and four parts, one template a file.
// The union of the parts is held by title-room-scaled-pips-bake.test.tsx.
// ---------------------------------------------------------------------------

/** How many files the bake tests are split over (see the union test before
 *  changing it: the part files must match). */
export const TITLE_ROOM_BAKE_PARTS = 4;

/** Every template that draws its cost in a box of its own. */
export const TITLE_ROOM_TEMPLATES = ["modern", "m15pw", "m15borderlesspw", "m15borderlesspwtall"] as const;
const HD_W = 1500;
/** Long enough to be cut at the floor before any cost. */
const LONG = "Elesh Norn, Grand Cenobite of the Machine Orthodoxy and Its Praetors";
/** The least air, in HD px, between the name's ink and the first disc's
 *  (its shadow's) left edge. The name's box ends DETACHED_COST_GAP_PCT
 *  (30 px) before the row as measured; the row as DRAWN is a little
 *  longer — the style's shadow (5 px on the walkers) and the bake's whole-px
 *  discs, up to 1 px a pip. Measured: 36–56 px (`modern`) and 23–52 px
 *  (the walkers) at 1–10 larger discs; plain pips keep 27–60 px. */
export const MIN_AIR_HD_PX = 20;

/** `n` larger discs: one-colour Phyrexian symbols, every third a two-colour
 *  one; none = a plain cost. */
export const scaledCost = (n: number) =>
  n === 0 ? "{2}{R}{R}" : Array.from({ length: n }, (_, i) => (i % 3 === 2 ? "{G/U/P}" : "{R/P}")).join("");
/** The plain cost with as many pips. */
export const plainTwin = (n: number) => (n === 0 ? "{2}{R}{R}" : "{R}".repeat(n));

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

const PRESETS = ["hd", "default"] as const;

/** The templates of part `part` (1-based) of `parts`. */
export function titleRoomTemplatesOfPart(part: number, parts = TITLE_ROOM_BAKE_PARTS): string[] {
  if (!Number.isInteger(part) || part < 1 || part > parts) throw new Error(`no part ${part} of ${parts}`);
  return TITLE_ROOM_TEMPLATES.filter((_, i) => i % parts === part - 1);
}

/** The bake tests of `templates`, in order: [template, preset, title]. */
export function titleRoomBakePlan(templates: readonly string[]): { template: string; preset: (typeof PRESETS)[number]; title: string }[] {
  return templates.flatMap((template) =>
    PRESETS.map((preset) => ({
      template,
      preset,
      title: `${template} @ ${preset}: 0–10 larger discs — the name's ink ends ${MIN_AIR_HD_PX} HD px or more before the first disc, and the row is as long as measured`,
    })),
  );
}

/** Registers part `part`'s bakes — the whole body of title-room-scaled-pips-bake-<part>.test.ts. */
export function describeTitleRoomBakes(part: number): void {
  describe(`a name before a detached cost of Phyrexian symbols — real bakes — part ${part} of ${TITLE_ROOM_BAKE_PARTS}`, () => {
    let frames: StandInFrames;
    beforeAll(async () => {
      frames = await serveStandInFrames(TITLE_ROOM_TEMPLATES.map((template) => ({ template, keys: ["r"], tone: 128 })));
    });
    afterAll(() => frames.restore());

    for (const { template, preset, title } of titleRoomBakePlan(titleRoomTemplatesOfPart(part))) {
      it(title, async () => {
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
          const measuredLeft = rowRight - manaCostWidthPct(cost, disc) * HD_W;
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
  });
}
