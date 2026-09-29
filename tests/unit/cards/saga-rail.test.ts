import { describe, expect, it } from "vitest";
import { parseChapters, parseSagaIntro } from "@/lib/cards/card-display";
import { displayTextExactWidthEm, displayTextWidthEm } from "@/lib/cards/display-metrics";
import { RULES_TARGETS, metricsFor, rectPx, rulesTargetFor, runWidthPx, type RulesBlock } from "@/lib/cards/rules-layout";
import {
  SAGA_RAIL,
  layoutSagaRail,
  sagaBadgeWidthPx,
  sagaChapterSizePx,
  sagaRailMetrics,
  sagaRailPx,
} from "@/lib/cards/saga-rail";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { RULES_TEXT } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The saga chapter rail's text through the ONE rules line drawing (layout
// v33, TODO 3.29). Owner decision 2026-09-28: correctness only — real pips,
// reminder italics, U+2212 — at v32's sizes, in v32's equal rows, beside
// v32's badges. The print anatomy is TODO 4.21. Real-pixel checks:
// tests/unit/render/walker-saga-bake.test.tsx.
// ---------------------------------------------------------------------------

const SAGA = getFrameProfile("saga");
const SLOT = SAGA.chapters!;
const DOM_122 =
  "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga deals 1 damage to each creature without flying.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain. If you do, this Saga deals 3 damage to each creature.";
const rail = (rules: string) => layoutSagaRail(SLOT, parseSagaIntro(rules), parseChapters(rules));
const lines = (blocks: readonly RulesBlock[]) => blocks.flatMap((b) => b.lines);

describe("the bake targets", () => {
  it("draws the HD target at the HD bake's width and the 750 px one below it, in both orientations", () => {
    expect(rulesTargetFor(1500, "portrait")).toBe("hd");
    expect(rulesTargetFor(750, "portrait")).toBe("default");
    expect(rulesTargetFor(2100, "landscape")).toBe("hd");
    expect(rulesTargetFor(1050, "landscape")).toBe("default");
  });
});

describe("the saga rail at today's size (v32)", () => {
  it("keeps v32's text sizes at both bakes: 22 / 44 px chapters, 20 / 40 px intro", () => {
    expect(SLOT.sizePct).toBe(0.029);
    expect(sagaChapterSizePx(SLOT)).toBe(44);
    for (const t of RULES_TARGETS) {
      const width = t === "hd" ? 1500 : 750;
      const px = sagaRailPx(SLOT, t);
      // v32's ChapterBake: fpx(sizePct) and round(size × 0.9).
      expect(px.size).toBe(Math.round(SLOT.sizePct * width));
      expect(px.introSize).toBe(Math.round(Math.round(SLOT.sizePct * width) * 0.9));
      const m = sagaRailMetrics(rail(DOM_122), t);
      expect(m.chapter.fontPx).toBe(px.size);
      expect(m.intro.fontPx).toBe(px.introSize);
      // v32's line heights (1.22 / 1.2), whole px.
      expect(m.chapter.linePx).toBe(Math.round(px.size * SAGA_RAIL.chapterLineHeight));
      expect(m.intro.linePx).toBe(Math.round(px.introSize * SAGA_RAIL.introLineHeight));
    }
  });

  it("keeps v32's anatomy: every padding, badge and gap rounded from the target's own size", () => {
    for (const t of RULES_TARGETS) {
      const px = sagaRailPx(SLOT, t);
      const s = px.size;
      expect(px).toEqual({
        size: s,
        introSize: px.introSize,
        introPadY: Math.round(s * 0.4),
        introPadX: Math.round(s * 0.3),
        rowPadY: Math.round(s * 0.3),
        rowPadX: Math.round(s * 0.2),
        badge: Math.round(s * 1.7),
        badgeHeight: Math.round(Math.round(s * 1.7) * 1.12),
        badgePadX: Math.round(s * 0.32),
        badgeGap: Math.round(s * 0.6),
        markerText: Math.round(s * 0.82),
        markerLift: Math.round(s * 0.3),
      });
    }
  });

  it("gives a marker badge its minimum width, or its numeral's EXACT Beleren advances + padding (a combined marker)", () => {
    for (const t of RULES_TARGETS) {
      const px = sagaRailPx(SLOT, t);
      expect(sagaBadgeWidthPx("I", px)).toBe(px.badge);
      expect(sagaBadgeWidthPx("III", px)).toBe(px.badge);
      const wide = sagaBadgeWidthPx("II,III,IV", px);
      expect(wide).toBe(Math.ceil(displayTextExactWidthEm("II,III,IV") * px.markerText - 1e-6) + 2 * px.badgePadX);
      expect(wide).toBeGreaterThan(px.badge);
    }
    // v32's own boxes, px for px: Satori laid "II,III,IV" out at 116.96 px
    // (36 px Beleren, unkerned) + 2 × 14 — 145 at HD (the thousandth-rounded
    // advances add up to 117.07 and made it 146: a sub-pixel shift of the
    // whole badge on a public saga, layout v33 review); 59 + 2 × 7 at 750.
    expect(sagaBadgeWidthPx("II,III,IV", sagaRailPx(SLOT, "hd"))).toBe(145);
    expect(sagaBadgeWidthPx("II,III,IV", sagaRailPx(SLOT, "default"))).toBe(73);
    expect(displayTextWidthEm("II,III,IV") * 36).toBeGreaterThan(117);
  });
});

describe("the rail's text in lines", () => {
  it("draws DOM #122's 'Add {R}{R}.' as two red pips, not braces", () => {
    const { chapters } = rail(DOM_122);
    expect(chapters.map((c) => c.marker)).toEqual(["I", "II", "III"]);
    const [line] = lines(chapters[1].blocks);
    const items = line.runs.flat();
    expect(items.filter((it) => it.t === "m").map((it) => (it.t === "m" ? it.suffix : ""))).toEqual(["r", "r"]);
    expect(items.some((it) => it.t === "w" && it.v.includes("{"))).toBe(false);
  });

  it("sets reminder text italic in a chapter, and the whole intro italic (as v32 did)", () => {
    const r = rail("Keep going.\nI — Draw a card. (You may play it.)\nII — Scry 2.");
    const intro = lines(r.intro!).flatMap((l) => l.runs.flat());
    expect(intro.every((it) => it.t !== "w" || it.em)).toBe(true);
    const ch = lines(r.chapters[0].blocks).flatMap((l) => l.runs.flat());
    expect(ch.filter((it) => it.t === "w" && it.em).map((it) => (it.t === "w" ? it.v : ""))).toEqual(["(You", "may", "play", "it.)"]);
    expect(ch.find((it) => it.t === "w" && it.v === "Draw")).not.toHaveProperty("em");
  });

  it("measures U+2212 as the hyphen both renderers draw", () => {
    const withMinus = rail("I — Put a −1/−1 counter on each creature.");
    const withHyphen = rail("I — Put a -1/-1 counter on each creature.");
    const w = (r: ReturnType<typeof rail>) => lines(r.chapters[0].blocks).map((l) => l.widthPx.hd);
    expect(w(withMinus)).toEqual(w(withHyphen));
  });

  it("keeps a chapter one paragraph, as v32's plain text did (a line break inside it is a space)", () => {
    const [ch] = layoutSagaRail(SLOT, null, [{ marker: "III", text: "opp picks 1 X 1/1 hexproof nurses\n/tap 1 creature" }]).chapters;
    expect(ch.blocks).toHaveLength(1);
    expect(ch.blocks[0].kind).toBe("rules");
    expect(layoutSagaRail(SLOT, "  ", [{ marker: "I", text: "   " }])).toMatchObject({ intro: null, chapters: [{ marker: "I", blocks: [] }] });
  });

  it("breaks every line for the column its row leaves the text, at BOTH targets", () => {
    const rules =
      "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after IV.)\nI — Kashimo gets reach and double strike permanently give him 2 1/1 counters Kashimo also stuns for 3 turns now\nII, III, IV — Give kashimo a 1/1 counter and give target creature 4 stun counters and 2 −1/−1 counters\nV — Add {G}{G}{U}. Tap Kashimo.";
    const r = rail(rules);
    for (const t of RULES_TARGETS) {
      const px = sagaRailPx(SLOT, t);
      const railWidth = rectPx(SLOT.rect, "portrait", 7 / 5, t).width;
      for (const line of lines(r.intro!)) expect(line.widthPx[t]).toBeLessThanOrEqual(railWidth - 2 * px.introPadX);
      for (const ch of r.chapters) {
        const column = railWidth - 2 * px.rowPadX - sagaBadgeWidthPx(ch.marker, px) - px.badgeGap;
        for (const line of lines(ch.blocks)) {
          expect(line.widthPx[t]).toBeLessThanOrEqual(column);
          // …as the target draws it: each word ceiled, the rules word gap.
          const m = metricsFor(r.sizePx, SAGA_RAIL.chapterLineHeight, t);
          const drawn = line.runs.reduce((w, run, i) => w + (i ? m.wordGapPx : 0) + runWidthPx(run, m), 0);
          expect(line.widthPx[t]).toBe(drawn);
        }
      }
    }
    // The pips and word gap are the rules standard's.
    const m = sagaRailMetrics(r, "hd").chapter;
    expect(m.pipPx).toBe(Math.round(44 * RULES_TEXT.pipDiscEm));
    expect(m.wordGapPx).toBe(Math.round(44 * RULES_TEXT.wordGapEm));
  });
});
