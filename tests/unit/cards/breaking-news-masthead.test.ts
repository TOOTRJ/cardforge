import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { resolveHoloStamp } from "@/lib/cards/anatomy";
import { HOLO_STAMP_OVAL_ART, HOLO_STAMP_OVAL_STRIP_ART, holoStampArtOf } from "@/lib/cards/holo-stamp-art";
import { HOLO_STAMP_STRIP_RING_RGB } from "@/lib/cards/holo-stamp";
import { costRowDrawnPx, mastheadAssetPaths, resolveMasthead } from "@/lib/cards/masthead";
import { BREAKING_NEWS_MASTHEAD, getFrameProfile } from "@/lib/cards/template-layout";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import { BREAKING_NEWS_PAIR_RAMP, BREAKING_NEWS_STRIP_RGB } from "@/scripts/lib/cc-frames.mjs";
import { costRowWidthPct } from "@/lib/cards/render-tiers";
import { symbolStyleOf } from "@/lib/cards/symbol-style";
import { manaCostWidthPct } from "@/lib/cards/title-band";
import {
  BREAKING_NEWS_MASTHEAD_RECIPE as RECIPE,
  cutMastheadPieces,
  pairPaperPiece,
  paperSources,
  rowAlpha,
  wordmarkAlpha,
} from "@/scripts/lib/breaking-news-masthead.mjs";

// The OTJ Breaking News masthead makes room for the cost row as print does
// (owner decision on #624: FOLLOW PRINT; lib/cards/masthead.ts). The prints'
// numbers at 1500 × 2100 (OTP, measured 2026-10-28): #7 {3}{U}{U} keeps the
// chevron (discs 1185–1411); #25 {X}{R}{R}{R} drops it, nothing moves
// (1108–1411); #22 {X}{X}{X}{R}{R} slides the row to 1461 and keeps the
// wordmark (discs from 1080); #40 {U}{U}{B}{B}{B}{R}{R} slides the wordmark
// 156 px left (the P 427 → 271).

const BN = getFrameProfile("breakingnews");
const PX = (pct: number, side = 1500) => (pct / 100) * side;

describe("the Breaking News masthead rule", () => {
  it("leaves a row that clears the chevron as the master paints it (#7, #2)", () => {
    expect(resolveMasthead(BN, "{3}{U}{U}", "u")).toBeNull();
    expect(resolveMasthead(BN, "{1}{W}", "w")).toBeNull();
    expect(resolveMasthead(BN, null, "w")).toBeNull();
    expect(resolveMasthead(BN, "  ", "w")).toBeNull();
  });

  it("drops the chevron at four pips and moves nothing (#25)", () => {
    const m = resolveMasthead(BN, "{X}{R}{R}{R}", "r")!;
    expect(m).toMatchObject({ state: "chevron", shiftPx: 0, costDxPx: 0 });
    const [paper, wordmark] = m.pieces;
    expect(paper.piece).toBe("paper");
    expect(Math.round(PX(paper.window.leftPct))).toBe(1082);
    expect(Math.round(PX(paper.window.leftPct + paper.window.widthPct))).toBe(1228);
    expect(wordmark.piece).toBe("wordmark");
    expect(Math.round(PX(wordmark.rect.leftPct))).toBe(376);
  });

  it("slides the row right at five pips and keeps the wordmark (#22)", () => {
    const m = resolveMasthead(BN, "{X}{X}{X}{R}{R}", "r")!;
    expect(m).toMatchObject({ state: "chevron", shiftPx: 0, costDxPx: 52 });
    const left = 1411 + m.costDxPx - costRowDrawnPx(BN, "{X}{X}{X}{R}{R}");
    expect(left).toBeGreaterThanOrEqual(BREAKING_NEWS_MASTHEAD.wordmarkClearPx);
  });

  it("slides the wordmark left at seven pips, as far as print does (#40)", () => {
    const m = resolveMasthead(BN, "{U}{U}{B}{B}{B}{R}{R}", "m")!;
    expect(m).toMatchObject({ state: "chevron", shiftPx: 156, costDxPx: 52 });
    const wordmark = m.pieces.find((p) => p.piece === "wordmark")!;
    expect(Math.round(PX(wordmark.rect.leftPct))).toBe(376 - 156);
    const paper = m.pieces.find((p) => p.piece === "paper")!;
    expect(Math.round(PX(paper.window.leftPct))).toBe(1082 - 156);
    // The wordmark's last ink (the Y's arm, 1062) stays clear: 16 px by the estimate (14–16 drawn; print 18).
    const left = 1411 + m.costDxPx - costRowDrawnPx(BN, "{U}{U}{B}{B}{B}{R}{R}");
    expect(left - (1062 - m.shiftPx)).toBeGreaterThanOrEqual(16);
  });

  it("reads the row's drawn width, never a pip count", () => {
    // Three large (Phyrexian) pips are wider than three plain ones: the
    // chevron goes for them, stays for the plain ones.
    expect(costRowDrawnPx(BN, "{W/P}{W/P}{W/P}")).toBeGreaterThan(costRowDrawnPx(BN, "{W}{W}{W}"));
    expect(resolveMasthead(BN, "{W}{W}{W}", "w")).toBeNull();
    expect(resolveMasthead(BN, "{W/P}{W/P}{W/P}", "w")?.state).toBe("chevron");
  });

  it("measures a text token by its drawn letters (the check's WWWWWWWWWW), pips as before", () => {
    const disc = BN.costSizePct!;
    // A pip-only cost: exactly the name's room's estimate.
    expect(costRowDrawnPx(BN, "{U}{U}{B}{B}{B}{R}{R}")).toBe(manaCostWidthPct("{U}{U}{B}{B}{B}{R}{R}", disc, symbolStyleOf(BN)) * 1500);
    for (const cost of ["WWWWWWWWWW", "2BB", "{1}{G} or MMMM"]) {
      // Never short of the bake's own measure of the row (render-tiers
      // costRowWidthPct), less its hard shadow.
      expect(costRowDrawnPx(BN, cost), cost).toBeGreaterThanOrEqual(costRowWidthPct(cost, disc) * 1500 - 0.2 * 70);
    }
    // Drawn 430 px wide on the check's bake (981–1411): the estimate is no
    // narrower, and the wordmark slides clear of it.
    expect(costRowDrawnPx(BN, "WWWWWWWWWW")).toBeGreaterThanOrEqual(430);
    const m = resolveMasthead(BN, "WWWWWWWWWW", "w")!;
    expect(m.state).toBe("chevron");
    const left = 1411 + m.costDxPx - costRowDrawnPx(BN, "WWWWWWWWWW");
    expect(m.shiftPx).toBeGreaterThan(0);
    expect(left - (1062 - m.shiftPx)).toBeGreaterThanOrEqual(16);
  });

  it("never draws the wordmark under a cost past anything printed", () => {
    const eight = resolveMasthead(BN, "{U}{U}{U}{U}{B}{B}{R}{R}", "m")!;
    expect(eight.state).toBe("chevron");
    expect(eight.shiftPx).toBeLessThanOrEqual(BREAKING_NEWS_MASTHEAD.maxShiftPx);
    const nine = resolveMasthead(BN, "{U}{U}{U}{U}{U}{B}{B}{R}{R}", "m")!;
    expect(nine).toMatchObject({ state: "wordmark", shiftPx: 0 });
    expect(nine.pieces.map((p) => p.piece)).toEqual(["paper"]);
    expect(Math.round(PX(nine.pieces[0].window.leftPct))).toBe(384);
    const many = resolveMasthead(BN, "{W}".repeat(15), "w")!;
    expect(many.state).toBe("box");
    expect(Math.round(PX(many.pieces[0].window.leftPct))).toBe(52);
    for (let n = 4; n <= 18; n++) {
      const cost = "{G}".repeat(n);
      const m = resolveMasthead(BN, cost, "g")!;
      const left = 1411 + m.costDxPx - costRowDrawnPx(BN, cost);
      if (m.state === "chevron") expect(left - (1062 - m.shiftPx)).toBeGreaterThanOrEqual(16);
      if (m.state === "wordmark") expect(left).toBeGreaterThanOrEqual(BREAKING_NEWS_MASTHEAD.boxClearPx);
    }
  });

  it("puts every piece edge and slide on an even HD px (whole at the 750 bake)", () => {
    for (let n = 4; n <= 18; n++) {
      const m = resolveMasthead(BN, "{B}".repeat(n), "b")!;
      expect(m.costDxPx % 2).toBe(0);
      expect(m.shiftPx % 2).toBe(0);
      for (const p of m.pieces) {
        for (const r of [p.rect, p.window]) {
          for (const v of [PX(r.leftPct), PX(r.leftPct + r.widthPct), PX(r.topPct, 2100), PX(r.topPct + r.heightPct, 2100)]) {
            expect(Math.abs(v - Math.round(v))).toBeLessThan(1e-6);
            expect(Math.round(v) % 2).toBe(0);
          }
        }
      }
    }
  });

  it("is the Breaking News frame's alone, and only for the keys it publishes", () => {
    expect(resolveMasthead(getFrameProfile("m15"), "{U}{U}{B}{B}{B}{R}{R}", "m")).toBeNull();
    expect(resolveMasthead(BN, "{U}{U}{B}{B}{B}{R}{R}", "nope")).toBeNull();
  });
});

describe("the masthead's pieces", () => {
  it("are the recipe's numbers (the profile and the build agree)", () => {
    expect(BREAKING_NEWS_MASTHEAD.keys).toEqual([...RECIPE.keys]);
    expect(BREAKING_NEWS_MASTHEAD.rows).toEqual([...RECIPE.rows]);
    expect(BREAKING_NEWS_MASTHEAD.wordmark).toMatchObject({ x0: RECIPE.wordmark.x0, x1: RECIPE.wordmark.x1, fadeFromPx: RECIPE.wordmark.chevronOpaque });
    expect(BREAKING_NEWS_MASTHEAD.paper).toMatchObject({ x0: RECIPE.paper.x0, x1: RECIPE.paper.x1 });
    expect(BREAKING_NEWS_MASTHEAD.wordmark.assetPathTemplate).toBe(`/frames/${RECIPE.folder}/{key}.png`);
    expect(BREAKING_NEWS_MASTHEAD.paper.assetPathTemplate).toBe(`/frames/${RECIPE.folder}/paper/{key}.png`);
    // The template's master keys (the `breakingnews` masters in the manifest).
    const manifest = JSON.parse(readFileSync("lib/frames/frame-manifest.json", "utf8")).files as Record<string, unknown>;
    for (const key of RECIPE.keys) expect(manifest[`breakingnews/${key}.png`]).toBeDefined();
  });

  it("are published for every key", () => {
    const manifest = JSON.parse(readFileSync("lib/frames/frame-manifest.json", "utf8")).files as Record<string, unknown>;
    for (const path of mastheadAssetPaths(BREAKING_NEWS_MASTHEAD)) {
      const rel = path.replace(/^\/frames\//, "");
      expect(manifest[rel], rel).toBeDefined();
      expect(manifest[rel.replace(/\.png$/, ".webp")], rel).toBeDefined();
    }
  });

  it("keep the wordmark opaque over its ink and cut the box hard, fading only paper", () => {
    // Every wordmark ink px (x 416–1081, rows 51–176) is drawn whole.
    for (const y of [51, 60, 100, 150, 176]) for (const x of [416, 600, 1062, 1081]) expect(wordmarkAlpha(x, y)).toBe(1);
    // The box's rows: a hard left edge on the box's right border.
    for (const y of [81, 113, 145]) expect(wordmarkAlpha(376, y)).toBe(1);
    // Off them, a fade from 0.
    expect(wordmarkAlpha(376, 70)).toBeLessThan(0.1);
    // The chevron (1096 on) is never in the piece.
    for (const y of [65, 110, 158]) expect(wordmarkAlpha(1094, y)).toBe(0);
    expect(rowAlpha(RECIPE.rows[0] - 1)).toBe(0);
    expect(rowAlpha(RECIPE.rows[1])).toBe(0);
  });

  it("lay the paper's clean run end to end, never a chevron or crease column", () => {
    for (let x = RECIPE.paper.x0; x < RECIPE.paper.x1; x++) {
      const sources = paperSources(x);
      expect(sources.reduce((s, [, w]) => s + w, 0)).toBeCloseTo(1, 9);
      for (const [sx] of sources) {
        expect(sx).toBeGreaterThanOrEqual(RECIPE.paper.run[0]);
        expect(sx).toBeLessThan(Math.max(RECIPE.paper.run[1], x + 1));
      }
    }
    // It ends on the master's own columns.
    expect(paperSources(RECIPE.paper.x1 - 1)).toEqual([[RECIPE.paper.x1 - 1, 1]]);
  });

  it("give a pair's paper its first colour left of the split and its second right of it", () => {
    const solid = (rgb: [number, number, number]) => {
      const w = RECIPE.paper.x1 - RECIPE.paper.x0;
      const h = RECIPE.rows[1] - RECIPE.rows[0];
      const data = Buffer.alloc(w * h * 4);
      for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
      return { data, width: w, height: h, x0: RECIPE.paper.x0, y0: RECIPE.rows[0] };
    };
    const pair = pairPaperPiece(solid([200, 0, 0]), solid([0, 0, 200]), BREAKING_NEWS_PAIR_RAMP);
    const at = (x: number) => [...pair.data.subarray((x - RECIPE.paper.x0) * 4, (x - RECIPE.paper.x0) * 4 + 4)];
    expect(at(600)).toEqual([200, 0, 0, 255]); // left of 45.7 %W (686 px)
    expect(at(900)).toEqual([0, 0, 200, 255]); // right of 55.6 %W (834 px)
    expect(at(760)[0]).toBeGreaterThan(0);
    expect(at(760)[2]).toBeGreaterThan(0);
  });

  it("change no colour of the master in the wordmark and only set alpha", () => {
    const W = 1500;
    const H = 2100;
    const master = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      master[i * 4] = i % 251;
      master[i * 4 + 1] = (i >> 3) % 253;
      master[i * 4 + 2] = (i >> 7) % 255;
      master[i * 4 + 3] = 255;
    }
    const { wordmark, paper } = cutMastheadPieces(master);
    for (let y = 0; y < wordmark.height; y += 7) {
      for (let x = 0; x < wordmark.width; x += 5) {
        const o = (y * wordmark.width + x) * 4;
        const s = ((y + wordmark.y0) * W + x + wordmark.x0) * 4;
        expect([wordmark.data[o], wordmark.data[o + 1], wordmark.data[o + 2]]).toEqual([master[s], master[s + 1], master[s + 2]]);
      }
    }
    expect(paper.width).toBe(RECIPE.paper.x1 - RECIPE.paper.x0);
    expect(paper.height).toBe(RECIPE.rows[1] - RECIPE.rows[0]);
  });
});

describe("the preload list", () => {
  const card = (cost: string) =>
    ({
      title: "Cruel Ultimatum",
      cost,
      cardType: "sorcery",
      supertype: null,
      subtypes: [],
      rarity: "rare",
      colorIdentity: ["blue", "black", "red"],
      rulesText: "",
      flavorText: "",
      artUrl: null,
      frameStyle: { template: "breakingnews" },
    }) as unknown as CardPreviewData;

  it("warms the pieces a long cost draws, and nothing for a short one", () => {
    const long = frameAssetPathsFor(card("{U}{U}{B}{B}{B}{R}{R}"));
    expect(long).toContain("/frames/breakingnewsmasthead/m.png");
    expect(long).toContain("/frames/breakingnewsmasthead/paper/m.png");
    expect(frameAssetPathsFor(card("{1}{B}")).some((p) => p.includes("breakingnewsmasthead"))).toBe(false);
  });
});

describe("the Breaking News stamp on its charcoal strip", () => {
  it("draws its ring in the strip's charcoal with no keyline (print)", () => {
    expect([...HOLO_STAMP_STRIP_RING_RGB]).toEqual([...BREAKING_NEWS_STRIP_RGB]);
    const stamp = resolveHoloStamp(BN, { stamp: "oval" }, { colorKey: "w", colors: ["white"], cardType: "instant", rarity: "rare" } as never)!;
    expect(stamp.ring).toBe("strip");
    expect(holoStampArtOf(stamp.shape, stamp.tone, stamp.ring)).toBe(HOLO_STAMP_OVAL_STRIP_ART);
    // Every other oval frame keeps the notch's black.
    const m15 = resolveHoloStamp(getFrameProfile("m15"), { stamp: "oval" }, { colorKey: "w", colors: ["white"], cardType: "instant", rarity: "rare" } as never)!;
    expect(m15.ring).toBeUndefined();
    expect(holoStampArtOf(m15.shape, m15.tone, m15.ring)).toBe(HOLO_STAMP_OVAL_ART);
  });
});
