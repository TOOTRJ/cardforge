import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { parseLoyaltyAbilities } from "@/lib/cards/card-display";
import { LOYALTY_ROW, layoutLoyaltyRows, loyaltyRowEdgesPx } from "@/lib/cards/loyalty-rows";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { detachedCostTitleWidthPct } from "@/lib/cards/title-band";
import { RENDER_PRESETS } from "@/lib/render/card-image";

// ---------------------------------------------------------------------------
// Planeswalker ability rows on REAL bakes (TODO 3.13). Satori/Yoga used to
// give every row the same height (`flex: 1`, no automatic minimum), so a
// long ability overflowed its stripe and the box clipped it — Chrollo's
// static ability lost its first lines in the saved image while the browser
// grew that row in the editor. The rows are now sized from their text by
// layoutLoyaltyRows (lib/cards/loyalty-rows.ts) and both renderers draw the
// same boxes, at the layout's text size — an ALL-CAPS walker included (its
// capitals are counted at their own width). Also here: a long name stops
// before the detached cost box (4.31). The m15pw masters live in the frames bucket (never in git), so
// these bakes get a synthetic stand-in through a stubbed bucket — a white
// card with a transparent art window — while the rows, badges, stripes and
// geometry are the real M15PW profile's. Rendered at the "default" preset
// (750 × 1050). Offline and deterministic.
// ---------------------------------------------------------------------------

const W = RENDER_PRESETS.default.width;
const H = RENDER_PRESETS.default.height;
const ORIGIN = "https://frames.test";
const P = getFrameProfile("m15pw");

// The acceptance walker: 1-line / 1-line / 5-line.
const WALKER_115 =
  "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"";

async function standInBucket() {
  const { frameObjectKey } = await import("@/lib/frames/frame-url");
  const [fw, fh] = [1500, 2100];
  const a = P.artSlot;
  const [x0, x1] = [Math.round((a.leftPct / 100) * fw), Math.round(((a.leftPct + a.widthPct) / 100) * fw)];
  const [y0, y1] = [Math.round((a.topPct / 100) * fh), Math.round(((a.topPct + a.heightPct) / 100) * fh)];
  const px = Buffer.alloc(fw * fh * 4);
  for (let y = 0; y < fh; y += 1) {
    for (let x = 0; x < fw; x += 1) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue; // the window: transparent
      px.fill(255, (y * fw + x) * 4, (y * fw + x) * 4 + 4);
    }
  }
  const frame = await sharp(px, { raw: { width: fw, height: fh, channels: 4 } }).png().toBuffer();
  const plate = await sharp({ create: { width: 240, height: 154, channels: 4, background: { r: 128, g: 128, b: 128, alpha: 1 } } })
    .png()
    .toBuffer();
  const files: Record<string, Buffer> = { "m15pw/b.png": frame, "m15pw/loyalty/b.png": plate };
  const manifest = {
    version: 1 as const,
    bucket: "frames",
    files: Object.fromEntries(
      Object.entries(files).map(([key, buf]) => {
        const sha256 = createHash("sha256").update(buf).digest("hex");
        return [key, { hash: sha256.slice(0, 12), sha256, bytes: buf.length, width: 1, height: 1 }];
      }),
    ),
  };
  const byUrl = new Map(
    Object.entries(files).map(([key, buf]) => [`${ORIGIN}/${frameObjectKey(key, manifest.files[key].hash)}`, buf]),
  );
  return { manifest, byUrl };
}

async function solidArt(v: number): Promise<string> {
  const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: v, g: v, b: v } } }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

describe("m15pw ability rows + title — real bakes", () => {
  let bucket: Awaited<ReturnType<typeof standInBucket>>;
  let art: string;
  let restoreStorage: () => void = () => {};

  beforeAll(async () => {
    bucket = await standInBucket();
    art = await solidArt(40);
  });
  afterEach(() => {
    restoreStorage();
    restoreStorage = () => {};
    vi.unstubAllGlobals();
  });

  async function bake(over: Partial<CardPreviewData>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const buf = bucket.byUrl.get(String(input));
        if (!buf) throw new Error(`unexpected fetch: ${input}`);
        return new Response(new Uint8Array(buf), { status: 200, headers: { "content-type": "image/png" } });
      }),
    );
    restoreStorage = (await import("@/lib/frames/frame-url")).setFrameStorageForTests({
      manifest: bucket.manifest,
      origin: ORIGIN,
    });
    const mod = await import("@/lib/render/card-image");
    const card = {
      title: "Probe",
      cost: "{B}",
      cardType: "planeswalker",
      supertype: "Legendary",
      subtypes: ["Probe"],
      rarity: "rare",
      colorIdentity: ["black"],
      rulesText: WALKER_115,
      flavorText: null,
      power: null,
      toughness: null,
      loyalty: "4",
      defense: null,
      artistCredit: "Probe",
      artUrl: art,
      artPosition: {},
      frameStyle: { template: "m15pw", finish: "regular" },
      setIconUrl: null,
      setIconCode: null,
      backFace: null,
      faceContent: null,
      watermark: null,
      ...over,
    } as unknown as CardPreviewData;
    const png = Buffer.from(
      await (await mod.renderCardImage(card, "default", { brandMark: false, watermarkText: null })).arrayBuffer(),
    );
    const data = await sharp(png).removeAlpha().raw().toBuffer();
    return (x: number, y: number) => {
      const i = (y * W + x) * 3;
      return [data[i], data[i + 1], data[i + 2]] as const;
    };
  }
  const lum = ([r, g, b]: readonly [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

  /** The rows as both renderers draw them, in this bake's pixels. */
  function rowGeometry(rules: string) {
    const rect = P.rules.rect;
    const { sizePct, rowFractions } = layoutLoyaltyRows({
      abilities: parseLoyaltyAbilities(rules),
      rect,
      baseSizePct: P.rules.sizePct,
      aspect: H / W,
    });
    const top = Math.round((rect.topPct / 100) * H);
    const size = Math.round(sizePct * W); // the bake's fpx
    const left = Math.round((rect.leftPct / 100) * W);
    const padX = Math.round(size * LOYALTY_ROW.padXEm);
    return {
      size,
      edges: loyaltyRowEdgesPx(rowFractions, (rect.heightPct / 100) * H).map((e) => top + e),
      left,
      right: Math.round(((rect.leftPct + rect.widthPct) / 100) * W),
      bottom: Math.round(((rect.topPct + rect.heightPct) / 100) * H),
      padX,
      // Where the ability text starts: the row padding, the badge box and its
      // gap, each rounded like LoyaltyRowsBake rounds them.
      textLeft:
        left + padX + Math.round(size * LOYALTY_ROW.badgeWidthEm) + Math.round(size * LOYALTY_ROW.badgeGapEm),
    };
  }

  /** Stripe seams where the rows put them, and every ability's text inside
   *  its own stripe (clear of both of its seams and the box's edges). */
  function expectRowsHoldTheirText(px: Awaited<ReturnType<typeof bake>>, rules: string) {
    const { size, edges, left, right, padX, textLeft } = rowGeometry(rules);
    const count = edges.length - 1;
    // Stripe A (pale cream) and B (darker tan) alternate over the dark art:
    // walk down the rows' left padding and find where they change.
    expect(padX).toBeGreaterThan(5);
    const x = left + 4;
    const kind = (y: number) => (px(x, y)[2] > 176 ? "A" : "B");
    const seams: number[] = [];
    for (let y = edges[0] + 12; y < edges.at(-1)! - 12; y += 1) {
      if (kind(y) !== kind(y - 1)) seams.push(y);
    }
    expect(seams).toHaveLength(count - 1);
    seams.forEach((s, i) => expect(Math.abs(s - edges[i + 1])).toBeLessThanOrEqual(1));

    const textRight = Math.min(right - padX, Math.round((P.loyalty!.plateRect!.leftPct / 100) * W) - 4);
    const inkRows = new Set<number>();
    for (let y = edges[0]; y < edges.at(-1)!; y += 1) {
      for (let xx = textLeft; xx < textRight; xx += 1) {
        if (lum(px(xx, y)) < 70) inkRows.add(y);
      }
    }
    for (let r = 0; r < count; r += 1) {
      const inRow = [...inkRows].filter((y) => y >= edges[r] && y < edges[r + 1]);
      expect(inRow.length, `row ${r} has text`).toBeGreaterThan(size / 2);
      expect(Math.min(...inRow) - edges[r], `row ${r} top`).toBeGreaterThanOrEqual(2);
      expect(edges[r + 1] - 1 - Math.max(...inRow), `row ${r} bottom`).toBeGreaterThanOrEqual(2);
    }
  }

  it("draws the rows layoutLoyaltyRows sized, each ability inside its own stripe (1 / 1 / 5 lines)", async () => {
    const px = await bake({});
    // Before, the long ability ran over the seam above it and out of the box
    // (clipped).
    expectRowsHoldTheirText(px, WALKER_115);
    // The long row really is the tall one, the short ones share the rest.
    const { edges, textLeft } = rowGeometry(WALKER_115);
    const heights = edges.slice(1).map((e, i) => e - edges[i]);
    expect(Math.abs(heights[0] - heights[1])).toBeLessThanOrEqual(1);
    expect(heights[2]).toBeGreaterThan(2.5 * heights[0]);

    // At the layout's text size: each row's text starts where the badge rail
    // at that size ends (the rail is 3.2 em, so half a point off moves it
    // ~7 px here).
    for (let r = 0; r < 3; r += 1) {
      const [y0, y1] = [edges[r] + 2, edges[r + 1] - 2];
      let start = -1;
      for (let x = textLeft - 6; x < textLeft + 40 && start < 0; x += 1) {
        for (let y = y0; y < y1; y += 1) {
          if (lum(px(x, y)) < 70) {
            start = x;
            break;
          }
        }
      }
      expect(start - textLeft, `row ${r} text start`).toBeGreaterThanOrEqual(-1);
      expect(start - textLeft, `row ${r} text start`).toBeLessThanOrEqual(3);
    }
  }, 60_000);

  it("gives ALL-CAPS abilities the rows they draw: nothing over a seam, nothing under the loyalty shield", async () => {
    // Capitals are ≈1.5× a lower-case letter's width; counted alike, the −3
    // got a 3-line row and drew 5 lines — over the next stripe, with the last
    // ability's end hidden under the starting-loyalty shield.
    const caps =
      "+1: CREATURES YOU CONTROL GET +2/+2 AND GAIN TRAMPLE UNTIL END OF TURN.\n−3: DESTROY TARGET CREATURE OR PLANESWALKER WITH MANA VALUE 4 OR GREATER. ITS CONTROLLER CREATES A TREASURE TOKEN AND A CLUE TOKEN.\n−8: YOU GET AN EMBLEM WITH \"WHENEVER A CREATURE YOU CONTROL ATTACKS, DRAW A CARD.\"";
    expectRowsHoldTheirText(await bake({ rulesText: caps }), caps);

    // The shield hides whatever is under it, so bake the walker without one
    // and look where it would sit (inside the box, clear of its rounded
    // corner): no ability text there.
    const px = await bake({ rulesText: caps, loyalty: null });
    const { right, bottom, padX } = rowGeometry(caps);
    const plate = P.loyalty!.plateRect!;
    let hidden = 0;
    for (let y = Math.round((plate.topPct / 100) * H); y < bottom - 2; y += 1) {
      for (let x = Math.round((plate.leftPct / 100) * W); x < right - padX; x += 1) {
        if (lum(px(x, y)) < 70) hidden += 1;
      }
    }
    expect(hidden).toBe(0);
  }, 60_000);

  it("ends a long name one band gap before the detached cost's pips", async () => {
    const cost = "{1}{R}{W}{B}";
    const title = "Miner the Miner, Damned Delver of the Deep";
    const px = await bake({ title, cost });
    const band = P.title.rect;
    const [y0, y1] = [Math.round((band.topPct / 100) * H) + 2, Math.round(((band.topPct + band.heightPct) / 100) * H) - 2];
    const x0 = Math.round((band.leftPct / 100) * W);
    const x1 = Math.round(((P.costRect!.leftPct + P.costRect!.widthPct) / 100) * W);
    // Columns that show anything but the white stand-in frame: the name's
    // ink, then the pips (discs, glyphs, their hard shadow).
    const marked = (x: number) => {
      for (let y = y0; y < y1; y += 1) if (lum(px(x, y)) < 235) return true;
      return false;
    };
    // From the right: past the pips (a few px between discs) to the first
    // real blank run — the gap between the name's last glyph and the cost.
    let x = x1 - 1;
    while (x > x0 && !marked(x)) x -= 1; // the last pip's right edge
    let gapEnd = -1;
    for (let run = 0; x > x0; x -= 1) {
      run = marked(x) ? 0 : run + 1;
      if (run === 1) gapEnd = x + 1;
      if (run >= 7) break;
    }
    let gapStart = x;
    while (gapStart > x0 && !marked(gapStart - 1)) gapStart -= 1;
    // The name (its ellipsis) runs up to its cap, less than a glyph short,
    // and never past it; the pips start one band gap (2 % of the width, less
    // their hard shadow) after the cap. Before, the name ran on under the
    // pips: no gap at all.
    const cap = x0 + Math.round(detachedCostTitleWidthPct(P, cost)! * W);
    expect(gapStart).toBeLessThanOrEqual(cap + 1);
    expect(gapStart).toBeGreaterThanOrEqual(cap - 20);
    expect(gapEnd - cap).toBeGreaterThanOrEqual(Math.round(0.02 * W) - 4);
    expect(gapEnd - cap).toBeLessThanOrEqual(Math.round(0.02 * W) + 2);
  }, 60_000);
});
