import { describe, expect, it } from "vitest";
import { parseLoyaltyAbilities, type LoyaltyAbility } from "@/lib/cards/card-display";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import {
  LOYALTY_ROW,
  LOYALTY_ROW_SIZE_PX,
  layoutLoyaltyRows,
  layoutProfileLoyaltyRows,
  loyaltyRowEdgesPx,
  loyaltyRowLines,
  loyaltyRowPx,
  loyaltyRowsDrawing,
  loyaltyShieldRect,
  type LoyaltyRowsLayout,
} from "@/lib/cards/loyalty-rows";
import { walkerSizePct } from "@/lib/cards/rules-box";
import { RULES_TARGETS, blockHeightPx, metricsFor, rectPx, rulesLadderPx, type RulesTarget } from "@/lib/cards/rules-layout";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
import {
  detachedCostTitleWidthPct,
  fitDetachedCostTitle,
  manaCostWidthPct,
  TITLE_COST_GAP_PCT,
  TITLE_FIT_HEADROOM,
} from "@/lib/cards/title-band";
import { RULES_SIZE_PX, RULES_TEXT, pctToPt, ptToPct, rulesPxToPct } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// Planeswalker ability rows sized by their text (TODO 3.13), the last one
// wrapping before the loyalty shield when its text would reach it (4.19),
// laid out since layout v33 (TODO 3.29) by the ONE rules layout: each
// ability's real lines, broken once and checked at both bake targets, at
// the rules standard's spacing — and the name that stops before a detached
// cost (4.31), shrinking to fit there (3.10 for these frames). All pure,
// shared by the preview and the bake; real-pixel checks live in
// tests/unit/render/pw-rows-bake.test.tsx and walker-saga-matrix.test.tsx.
// ---------------------------------------------------------------------------

const M15PW = getFrameProfile("m15pw");
const ASPECT = 7 / 5;
const layout = (rules: string) =>
  layoutLoyaltyRows({
    abilities: parseLoyaltyAbilities(rules),
    rect: M15PW.rules.rect,
    baseSizePct: walkerSizePct(M15PW),
    aspect: ASPECT,
  });
const withShield = (rules: string) => layoutProfileLoyaltyRows(M15PW, parseLoyaltyAbilities(rules), ASPECT);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const lineCounts = (l: LoyaltyRowsLayout) => l.text.map((t) => sum(t.blocks.map((b) => b.lines.length)));

/** A row's natural height at a target: its text block as drawn (lines,
 *  gaps, ink headroom) or its badge, plus its padding — whole px. */
const need = (l: LoyaltyRowsLayout, i: number, t: RulesTarget) => {
  const a = loyaltyRowPx(t);
  return Math.max(blockHeightPx(l.text[i], t), a.badgeHeight) + 2 * a.padY;
};

// The acceptance walker: 1-line / 1-line / 6-line at the 64 px ceiling
// without a shield (5 lines when the rail scaled with the text).
const WALKER_115 =
  "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"";
const SHORT = "+2: Scry 2.\n−3: Draw a card.\n−7: You win.";
// Test walkers whose last ability, at the full width, reaches the shield:
// a mixed-case one and an ALL-CAPS one.
const REACHES =
  "+1: Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n−3: Return target creature card from your graveyard to your hand.\n−7: Search your library for up to three creature cards, reveal them, put them into your hand, then shuffle. You gain 1 life for each card.";
const CAPS =
  "+1: CREATURES YOU CONTROL GET +2/+2 AND GAIN TRAMPLE UNTIL END OF TURN.\n−3: DESTROY TARGET CREATURE OR PLANESWALKER WITH MANA VALUE 4 OR GREATER. ITS CONTROLLER CREATES A TREASURE TOKEN AND A CLUE TOKEN.\n−8: YOU GET AN EMBLEM WITH \"WHENEVER A CREATURE YOU CONTROL ATTACKS, DRAW A CARD.\"";
// A test walker whose ultimate stays clear of it at the ceiling: its long
// lines end above the shield and the line beside it is short.
const CLEARS =
  "+1: Draw a card, then discard a card.\n−2: Draw a card.\n−10: Search your library for any number of creature cards, put them onto the battlefield, then shuffle. They gain haste. Exile them at the beginning of the next end step.";
// A test walker whose ultimate reaches the shield at the full width where
// its rows first fit (64 px) and whose narrowed rows don't fit there, while
// a smaller size clears the shield at the full width.
const SMALLER_CLEARS =
  "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with At the beginning of your upkeep exile the top three cards of your library Until end of turn you may play those cards and you may spend mana as though it were mana of any.";
const WALKERS = [WALKER_115, SHORT, REACHES, CAPS, CLEARS, SMALLER_CLEARS];

describe("layoutLoyaltyRows (layout v33: the rules layout's lines)", () => {
  it("sets the rows' text on the rules ladder from the walker's 64 px ceiling (7.5 pt), at the standard's spacing", () => {
    expect(rulesLadderPx(walkerSizePct(M15PW))[0]).toBe(RULES_SIZE_PX.compact);
    // Any OTHER card on the planeswalker frame keeps the rules slot's own
    // 68 px (v32's 8 pt, 67 px — never a shrink).
    expect(rulesLadderPx(M15PW.rules.sizePct)[0]).toBe(RULES_SIZE_PX.reduced);
    const l = layout(SHORT);
    expect(l.sizePx).toBe(64);
    expect(l.sizePct).toBe(rulesPxToPct(64));
    // The row spacing, stated: lines at RULES_TEXT.lineHeight (0.98 em, the
    // prints' pitch), the fixed 24 px paragraph gap, LOYALTY_ROW.padYEm of
    // the anatomy's fixed 46 px above and below — whole px at each target.
    for (const t of RULES_TARGETS) {
      const m = loyaltyRowsDrawing(l, t).text[0].metrics;
      expect(m).toEqual(metricsFor(64, RULES_TEXT.lineHeight, t));
      expect(m.linePx).toBe(t === "hd" ? 63 : 31);
      expect(m.paragraphGapPx).toBe(t === "hd" ? 24 : 12);
      expect(loyaltyRowPx(t).padY).toBe(t === "hd" ? 10 : 5);
    }
    expect(LOYALTY_ROW.padYEm).toBe(0.22);
  });

  it("draws the row anatomy at ONE size whatever the text's: the text column starts where the walker prints start theirs", () => {
    expect(LOYALTY_ROW_SIZE_PX).toBe(46);
    // padding 18 + badge 106 + gap 23: the text at x 275 of an HD card (the
    // rules box from 128), the prints' 274–276 (BFZ #29, DOM #1, AKH #97).
    expect(loyaltyRowPx("hd")).toMatchObject({ padX: 18, badgeWidth: 106, badgeGap: 23, rail: 147, badgeHeight: 69 });
    expect(rectPx(M15PW.rules.rect, "portrait", ASPECT, "hd").left + loyaltyRowPx("hd").rail).toBe(275);
    // A short walker (64 px text) and a long one (at the floor) draw the
    // same badges and start their text on the same margin.
    for (const t of RULES_TARGETS) {
      expect(loyaltyRowsDrawing(layout(SHORT), t).row).toEqual(loyaltyRowsDrawing(withShield(WALKER_115), t).row);
      for (const l of [layout(SHORT), withShield(WALKER_115)]) {
        const box = rectPx(M15PW.rules.rect, "portrait", ASPECT, t);
        for (let i = 0; i < l.text.length; i += 1) {
          for (const line of loyaltyRowLines(l, i, t).lines) expect(line.left).toBe(box.left + loyaltyRowPx(t).rail);
        }
      }
    }
  });

  it("keeps equal rows at the ceiling for equally short abilities (the old look)", () => {
    const { rowFractions } = layout(SHORT);
    expect(rowFractions).toHaveLength(3);
    for (const f of rowFractions) expect(f).toBeCloseTo(1 / 3, 10);
  });

  it("gives a long ability the height its lines need and shares the rest (1 / 1 / 6 lines)", () => {
    const l = layout(WALKER_115);
    const [a, b, c] = l.rowFractions;
    expect(l.sizePx).toBe(64);
    expect(lineCounts(l)).toEqual([1, 1, 6]);
    expect(sum(l.rowFractions)).toBeCloseTo(1, 10);
    expect(a).toBeCloseTo(b, 10);
    expect(c).toBeGreaterThan(2 * a);
    // The long row is taller than a short one by exactly what its lines add
    // (the slack is shared equally).
    const boxHd = rectPx(M15PW.rules.rect, "portrait", ASPECT, "hd").height;
    expect(Math.abs((c - a) * boxHd - (need(l, 2, "hd") - need(l, 0, "hd")))).toBeLessThanOrEqual(2);
    expect(l.clipped).toBe(false);
    // It is the largest ladder step at which every row holds its text: from
    // a ceiling one step higher, the size it lands on is the same.
    for (const rules of [WALKER_115, REACHES, CAPS]) {
      const at = withShield(rules);
      const up = layoutLoyaltyRows({
        abilities: parseLoyaltyAbilities(rules),
        rect: M15PW.rules.rect,
        baseSizePct: rulesPxToPct(at.sizePx + 2),
        aspect: ASPECT,
        shield: loyaltyShieldRect(M15PW),
      });
      const facts = (x: LoyaltyRowsLayout) => [x.sizePx, x.rowFractions, x.lastRowInsetPct, x.text.map((t) => t.blocks)];
      expect(facts(up)).toEqual(facts(at));
    }
  });

  it("holds every row's text in the whole-px rows the bake draws, at BOTH targets — no row overlaps the next", () => {
    for (const rules of WALKERS) {
      for (const l of [layout(rules), withShield(rules)]) {
        for (const t of RULES_TARGETS) {
          const { edges, boxHeight } = loyaltyRowsDrawing(l, t);
          expect(boxHeight).toBe(rectPx(M15PW.rules.rect, "portrait", ASPECT, t).height);
          expect(edges.at(-1)).toBe(boxHeight);
          l.text.forEach((_, i) => expect(edges[i + 1] - edges[i], `${rules.slice(0, 20)} row ${i} ${t}`).toBeGreaterThanOrEqual(need(l, i, t)));
          // And its lines, where the row puts them, inside its stripe.
          l.text.forEach((_, i) => {
            const placed = loyaltyRowLines(l, i, t);
            const top = rectPx(M15PW.rules.rect, "portrait", ASPECT, t).top;
            for (const line of placed.lines) {
              expect(line.inkTop).toBeGreaterThanOrEqual(top + edges[i]);
              expect(line.inkBottom).toBeLessThanOrEqual(top + edges[i + 1]);
            }
          });
        }
      }
    }
  });

  it("breaks each ability's lines for its row's column at both targets: no line is wider than it", () => {
    for (const rules of WALKERS) {
      const l = withShield(rules);
      for (const t of RULES_TARGETS) {
        const d = loyaltyRowsDrawing(l, t);
        l.text.forEach((text, i) => {
          for (const block of text.blocks) for (const line of block.lines) expect(line.widthPx[t]).toBeLessThanOrEqual(d.text[i].column);
        });
        // The column: the box less the rail and the right padding (and, on a
        // narrowed last row, the shield's inset).
        const a = d.row;
        const width = rectPx(M15PW.rules.rect, "portrait", ASPECT, t).width;
        expect(d.text[0].column).toBe(width - a.rail - a.padX);
      }
    }
  });

  it("shrinks the whole box's text only when the rows together overflow it", () => {
    const long = "Each opponent sacrifices a creature, discards a card and loses 2 life. ";
    const rules = ["+1: " + long.repeat(2), "−2: " + long.repeat(2), "−6: " + long.repeat(3), "−9: " + long.repeat(2)].join("\n");
    const tight = layout(rules);
    expect(tight.sizePx).toBeLessThan(layout(WALKER_115).sizePx);
    expect(sum(tight.rowFractions)).toBeCloseTo(1, 10);
  });

  it("past the floor scales every row down alike instead of dropping the last ones, and says it clips", () => {
    const rules = Array.from({ length: 6 }, (_, i) => `−${i + 1}: ${"Destroy all creatures and all lands you do not control. ".repeat(4)}`).join("\n");
    const l = layout(rules);
    expect(l.sizePx).toBe(RULES_SIZE_PX.floor);
    expect(pctToPt(l.sizePct)).toBeCloseTo(RULES_TEXT.hardFloorPt, 0);
    expect(l.clipped).toBe(true);
    expect(sum(l.rowFractions)).toBeCloseTo(1, 10);
    for (const f of l.rowFractions) expect(f).toBeCloseTo(1 / 6, 10);
  });

  it("measures capitals at their own advances, so an ALL-CAPS walker gets the lines it draws", () => {
    const [c, lower] = [layout(CAPS), layout(CAPS.toLowerCase())];
    expect(c.sizePx).toBeLessThan(lower.sizePx);
    // At one size the capitals take more lines.
    const at = (rules: string, size: number) =>
      layoutLoyaltyRows({ abilities: parseLoyaltyAbilities(rules), rect: M15PW.rules.rect, baseSizePct: rulesPxToPct(size), aspect: ASPECT });
    expect(sum(lineCounts(at(CAPS, 42)))).toBeGreaterThan(sum(lineCounts(at(CAPS.toLowerCase(), 42))));
  });

  it("gives a static (unbadged) ability and an empty hint row the badge-height floor", () => {
    const abilities: LoyaltyAbility[] = [
      { cost: null, text: "" },
      { cost: "+1", text: "Scry 1." },
    ];
    const l = layoutLoyaltyRows({ abilities, rect: M15PW.rules.rect, baseSizePct: walkerSizePct(M15PW), aspect: ASPECT });
    expect(l.rowFractions[0]).toBeCloseTo(l.rowFractions[1], 10);
    expect(l.text[0].blocks).toEqual([]);
  });

  it("sets a static ability's paragraphs the fixed paragraph gap apart", () => {
    const abilities = [{ cost: null, text: "Skeptic can be your commander.\nSkeptic can't be countered." }, { cost: "+1", text: "Scry 1." }];
    const l = layoutLoyaltyRows({ abilities, rect: M15PW.rules.rect, baseSizePct: walkerSizePct(M15PW), aspect: ASPECT });
    expect(l.text[0].blocks.map((b) => b.kind)).toEqual(["rules", "rules"]);
    for (const t of RULES_TARGETS) {
      const [first, second] = loyaltyRowLines(l, 0, t).lines;
      const m = metricsFor(l.sizePx, RULES_TEXT.lineHeight, t);
      expect(second.top - first.top).toBe(m.linePx + m.paragraphGapPx);
    }
  });

  it("is deterministic and empty for no abilities", () => {
    expect(layout(WALKER_115)).toEqual(layout(WALKER_115));
    expect(layoutLoyaltyRows({ abilities: [], rect: M15PW.rules.rect, baseSizePct: walkerSizePct(M15PW), aspect: ASPECT })).toEqual({
      sizePx: 64,
      sizePct: walkerSizePct(M15PW),
      rowFractions: [],
      lastRowInsetPct: 0,
      text: [],
      clipped: false,
    });
  });
});

describe("the last ability wraps before the loyalty shield when its text would reach it (TODO 4.19)", () => {
  const rulesRight = (M15PW.rules.rect.leftPct + M15PW.rules.rect.widthPct) / 100;
  const plate = M15PW.loyalty!.plateRect!;
  /** The last row's lines against the shield at a target: the furthest any
   *  line beside the shield reaches right, and the edge the narrowed column
   *  ends at (the shield's box less the row's padding). */
  const beside = (l: LoyaltyRowsLayout, t: RulesTarget) => {
    const s = rectPx(plate, "portrait", ASPECT, t);
    const lines = loyaltyRowLines(l, l.text.length - 1, t).lines;
    const near = lines.filter((line) => line.inkBottom > s.top);
    return {
      reach: Math.max(0, ...near.map((line) => line.left + line.width)),
      widest: Math.max(...lines.map((line) => line.left + line.width)),
      narrowEnd: s.left - loyaltyRowPx(t).padX,
      nearCount: near.length,
    };
  };

  it("takes the shield from the loyalty plate's box, else the value's", () => {
    expect(loyaltyShieldRect(M15PW)).toEqual(plate);
    expect(loyaltyShieldRect({ loyalty: { ...M15PW.loyalty!, plateRect: undefined } })).toEqual(M15PW.loyalty!.rect);
    expect(loyaltyShieldRect(getFrameProfile("m15"))).toBeNull();
  });

  it("ends a reaching last row's text column where the shield's box begins (m15pw: 12.4 % of the width), at both targets", () => {
    for (const rules of [REACHES, CAPS]) {
      const l = withShield(rules);
      expect(l.lastRowInsetPct).toBeCloseTo(rulesRight - plate.leftPct / 100, 12);
      expect(l.lastRowInsetPct).toBeCloseTo(0.124, 6);
      for (const t of RULES_TARGETS) {
        const d = loyaltyRowsDrawing(l, t);
        // 186 HD px narrower (93 at 750); only the LAST row.
        expect(d.text[0].column - d.text.at(-1)!.column).toBe(t === "hd" ? 186 : 93);
        for (const row of d.text.slice(0, -1)) expect(row.column).toBe(d.text[0].column);
        // Every line of it ends before the shield (less the row's padding).
        const b = beside(l, t);
        expect(b.widest).toBeLessThanOrEqual(b.narrowEnd);
      }
    }
    // The same call both renderers make.
    expect(withShield(REACHES)).toEqual(
      layoutLoyaltyRows({
        abilities: parseLoyaltyAbilities(REACHES),
        rect: M15PW.rules.rect,
        baseSizePct: walkerSizePct(M15PW),
        aspect: ASPECT,
        shield: plate,
      }),
    );
  });

  it("keeps the full width — the layout it would have without a shield — when the last ability stays clear of it", () => {
    // Owner decision 2026-09-26: a last ability that never comes near the
    // shield wraps exactly as it would without one, instead of leaving a word
    // on a line of its own.
    for (const rules of [CLEARS, SHORT]) {
      const clear = withShield(rules);
      expect(clear.lastRowInsetPct, rules).toBe(0);
      expect(clear).toEqual(layout(rules));
    }
    // It isn't a narrow text: its long lines run past where a narrowed
    // column would end — only the line beside the shield is short.
    const l = withShield(CLEARS);
    expect(l.sizePx).toBe(64);
    for (const t of RULES_TARGETS) {
      const b = beside(l, t);
      expect(b.widest).toBeGreaterThan(b.narrowEnd);
      expect(b.nearCount).toBeGreaterThan(0);
      expect(b.reach).toBeLessThanOrEqual(b.narrowEnd);
    }
  });

  it("sizes a narrowed last row for its narrower column, so its text still fits its row", () => {
    const before = layout(CAPS); // the whole width, as without a shield
    const after = withShield(CAPS);
    expect(after.lastRowInsetPct).toBeGreaterThan(0);
    expect(lineCounts(after).at(-1)!).toBeGreaterThan(lineCounts(before).at(-1)!);
    expect(after.rowFractions[2] > before.rowFractions[2] || after.sizePx < before.sizePx).toBe(true);
    for (const t of RULES_TARGETS) {
      const { edges } = loyaltyRowsDrawing(after, t);
      expect(edges[3] - edges[2]).toBeGreaterThanOrEqual(need(after, 2, t));
    }
  });

  it("checks each step of the size ladder at the full width first: a smaller size that alone clears the shield keeps it", () => {
    // This ultimate reaches the shield at the full width where its rows
    // first fit (64 px), and its narrowed rows don't fit there; a few steps
    // down its lines clear the shield at the full width — so it keeps the
    // full width there.
    const noShield = layout(SMALLER_CLEARS);
    const l = withShield(SMALLER_CLEARS);
    expect(noShield.sizePx).toBe(64);
    expect(lineCounts(noShield)).toEqual([1, 1, 6]);
    expect(l.sizePx).toBe(58);
    expect(lineCounts(l)).toEqual([1, 1, 5]);
    expect(l.lastRowInsetPct).toBe(0);
  });

  it("never lets a line's ink under the shield, at either target", () => {
    for (const rules of WALKERS) {
      const l = withShield(rules);
      for (const t of RULES_TARGETS) {
        const s = rectPx(plate, "portrait", ASPECT, t);
        l.text.forEach((_, i) => {
          for (const line of loyaltyRowLines(l, i, t).lines) {
            const under = line.left + line.width > s.left && line.inkBottom > s.top;
            expect(under, `${rules.slice(0, 20)} row ${i} ${t}`).toBe(false);
          }
        });
      }
    }
  });

  it("ignores a shield that misses the box, and never takes more than half its width", () => {
    const rect = M15PW.rules.rect;
    const lay = (shield: typeof plate | null) =>
      layoutLoyaltyRows({ abilities: parseLoyaltyAbilities(REACHES), rect, baseSizePct: walkerSizePct(M15PW), aspect: ASPECT, shield });
    expect(lay(null).lastRowInsetPct).toBe(0);
    expect(lay({ ...plate, topPct: rect.topPct + rect.heightPct + 1 }).lastRowInsetPct).toBe(0); // below the box
    expect(lay({ ...plate, leftPct: rect.leftPct + rect.widthPct + 1 }).lastRowInsetPct).toBe(0); // right of it
    // A shield over the whole box: every line reaches it, even narrowed —
    // the floor, clipped — and the column still keeps half the box.
    const over = lay({ topPct: rect.topPct, leftPct: 0, widthPct: 100, heightPct: rect.heightPct });
    expect(over.lastRowInsetPct).toBeCloseTo(rect.widthPct / 200, 12);
    expect(over.clipped).toBe(true);
  });
});

describe("loyaltyRowEdgesPx", () => {
  it("shares every seam and ends on the box's own height", () => {
    const box = (M15PW.rules.rect.heightPct / 100) * 2100; // 594.3 px at HD
    const edges = loyaltyRowEdgesPx(layout(WALKER_115).rowFractions, box);
    expect(edges[0]).toBe(0);
    expect(edges.at(-1)).toBe(Math.round(box));
    for (let i = 1; i < edges.length; i += 1) {
      expect(Number.isInteger(edges[i])).toBe(true);
      expect(edges[i]).toBeGreaterThan(edges[i - 1]);
    }
    expect(loyaltyRowEdgesPx([0.25, 0.25, 0.25, 0.25], 297)).toEqual([0, 74, 149, 223, 297]);
  });
});

// The old detached-cost fit (fitDetachedCostTitle) — the 2003 Modern
// frame's, and the planeswalker's until layout v32 (TODO 4.20) moved the
// walker onto the measured fit (fitTitleBand, tests/unit/cards/
// title-band.test.ts) and its cost box onto the print. These cases keep
// testing that path on the walker's v31 title slot and cost box, whatever
// the live profile does.
const LEGACY_PW: FrameProfile = {
  ...M15PW,
  title: { ...M15PW.title, rect: { topPct: 4.18, leftPct: 8.5, widthPct: 80, heightPct: 4.4 }, sizePct: 0.0427, fit: undefined },
  costRect: { topPct: 3.8, leftPct: 51.2, widthPct: 40, heightPct: 4.4 },
  costSizePct: undefined,
};

describe("the name next to a detached cost (costRect)", () => {
  it("measures a cost as its discs plus the pip gaps", () => {
    expect(manaCostWidthPct("{W}", 0.04)).toBeCloseTo(0.04, 10);
    expect(manaCostWidthPct("{1}{R}{W}{B}", 0.04)).toBeCloseTo(4 * 0.04 + 3 * 0.12 * 0.04, 10);
    expect(manaCostWidthPct("{W/U}{B/P}{2/R}", 0.04)).toBeCloseTo(3 * 0.04 + 2 * 0.12 * 0.04, 10);
    expect(manaCostWidthPct("", 0.04)).toBe(0);
  });

  it("ends the name one band gap before the pips, never past the band", () => {
    const cost = "{1}{R}{W}{B}";
    const w = detachedCostTitleWidthPct(LEGACY_PW, cost)!;
    const pipsLeft = (LEGACY_PW.costRect!.leftPct + LEGACY_PW.costRect!.widthPct) / 100 - manaCostWidthPct(cost, LEGACY_PW.title.sizePct);
    expect(LEGACY_PW.title.rect.leftPct / 100 + w + TITLE_COST_GAP_PCT).toBeCloseTo(pipsLeft, 10);
    // A short cost leaves what the band always left the name (band − gap).
    expect(detachedCostTitleWidthPct({ ...LEGACY_PW, costRect: { ...LEGACY_PW.costRect!, leftPct: 90, widthPct: 30 } }, "{W}")).toBeCloseTo(
      LEGACY_PW.title.rect.widthPct / 100 - TITLE_COST_GAP_PCT,
      10,
    );
    // More pips, less name.
    expect(detachedCostTitleWidthPct(LEGACY_PW, "{W}")!).toBeGreaterThan(w);
  });

  it("only applies to a drawn cost in a detached box", () => {
    expect(detachedCostTitleWidthPct(LEGACY_PW, null)).toBeNull();
    expect(detachedCostTitleWidthPct(LEGACY_PW, "  ")).toBeNull();
    expect(detachedCostTitleWidthPct(getFrameProfile("m15"), "{1}{R}")).toBeNull();
    expect(detachedCostTitleWidthPct(getFrameProfile("modern"), "{1}{R}")).not.toBeNull();
  });
});

describe("a long name shrinks to fit before a detached cost (owner decision, TODO 3.10)", () => {
  const MODERN = getFrameProfile("modern");
  const FLOOR = ptToPct(RULES_TEXT.hardFloorPt);
  /** The name's drawn width at `size` with the fit's headroom, card-width. */
  const drawn = (p: typeof LEGACY_PW, text: string, size: number) =>
    displayTextWidthEm(text, { letterSpacingEm: p.title.letterSpacingEm }) * size * TITLE_FIT_HEADROOM;

  it("keeps a name that fits at the slot's own size, whole", () => {
    for (const [p, title, cost] of [
      [LEGACY_PW, "Kikyo Zoldyck", "{1}{R}{W}{B}"],
      [LEGACY_PW, "Coden, the Great Creator", "{4}"],
      [MODERN, "Durgan Rompehechizos", "{2}{U}{R}{W}"],
      [MODERN, "The Death Star", "{3}{B}{B}{B}{B}{B}{B}"],
    ] as const) {
      expect(fitDetachedCostTitle(p, title, cost)).toEqual({
        text: title,
        widthPct: detachedCostTitleWidthPct(p, cost),
        sizePct: p.title.sizePct,
      });
    }
  });

  it("shrinks Miner the Miner, Damned Delver just enough to end before its pips (was cut to 'Del…')", () => {
    const title = "Miner the Miner, Damned Delver";
    const fit = fitDetachedCostTitle(LEGACY_PW, title, "{1}{R}{W}{B}")!;
    expect(fit.text).toBe(title);
    expect(fit.sizePct).toBeLessThan(LEGACY_PW.title.sizePct);
    // The largest size that fits: the name, with its headroom, fills the
    // width exactly (about 5 % smaller than the slot's 7.7 pt).
    expect(drawn(LEGACY_PW, title, fit.sizePct)).toBeCloseTo(fit.widthPct, 12);
    expect(pctToPt(fit.sizePct)).toBeGreaterThan(7.2);
  });

  it("does the same on the 2003 Modern frame (was cut with a clipped two-dot ellipsis)", () => {
    const title = "Skeptic, the Endlessly Wandering Knight";
    const fit = fitDetachedCostTitle(MODERN, title, "{2}{W}{U}{B}")!;
    expect(fit.text).toBe(title);
    expect(fit.sizePct).toBeLessThan(MODERN.title.sizePct);
    expect(fit.sizePct).toBeGreaterThan(FLOOR);
    expect(drawn(MODERN, title, fit.sizePct)).toBeCloseTo(fit.widthPct, 12);
  });

  it("stops at the 5 pt floor; past it the name is cut, with a whole '…' that fits (14-symbol cost)", () => {
    const cost = "{W}".repeat(14);
    // (The 2003 frame left this loop with TODO 4.10b: its 68 px discs leave
    // fourteen of them no room for a name at all, and its name is fitted by
    // fitTitleBand — tests/unit/cards/modern-2003-profile.test.ts.)
    for (const p of [LEGACY_PW]) {
      const fit = fitDetachedCostTitle(p, "Skeptic, the Endlessly Wandering Walker of Worlds", cost)!;
      expect(fit.sizePct).toBe(FLOOR);
      expect(fit.text.endsWith("…")).toBe(true);
      expect(fit.text).toMatch(/^Skeptic\S*…$|^Skeptic, the…$/u);
      // It fits its width, and one more character would not have.
      expect(drawn(p, fit.text, FLOOR)).toBeLessThanOrEqual(fit.widthPct + 1e-12);
      // A short name still fits whole at the floor or above.
      const short = fitDetachedCostTitle(p, "Skeptic", cost)!;
      expect(short.text).toBe("Skeptic");
      expect(short.sizePct).toBeGreaterThanOrEqual(FLOOR);
    }
    // The cut drops a trailing separator before the "…".
    const cut = fitDetachedCostTitle(LEGACY_PW, "Skeptic, the Endlessly Wandering Walker of Worlds", cost)!.text;
    expect(cut).not.toMatch(/[\s,;:]…$/u);
  });

  it("never leaves a word cut to one or two letters: it goes back to the last whole word", () => {
    const name = "Skeptic — Walker, Tester; Doubter";
    // The cut used to keep a stub of the next word ("Skeptic — W…").
    expect(fitDetachedCostTitle(LEGACY_PW, name, "{W}".repeat(13))!.text).toBe("Skeptic…");
    expect(fitDetachedCostTitle(LEGACY_PW, name, "{W}".repeat(11))!.text).toBe("Skeptic — Walker…");
    // Three letters or more of a cut word stay, and so does a cut first word.
    const long = "Skeptic, the Endlessly Wandering Walker of Worlds";
    expect(fitDetachedCostTitle(LEGACY_PW, long, "{W}".repeat(12))!.text).toBe("Skeptic, the End…");
    expect(fitDetachedCostTitle(LEGACY_PW, long, "{W}".repeat(15))!.text).toBe("Skep…");
    // Every cut, on both frames: the text before the "…" is the name's
    // start, ending on a whole word or on at least three letters of one.
    const names = [
      long,
      name,
      "SKEPTIC, THE ENDLESSLY WANDERING WALKER",
      "Illili Ilitil Iliil, the Lilt of Fill and Jilt",
      "Ælfwine Guðmundsson, Ørsted",
    ];
    let cuts = 0;
    for (const p of [LEGACY_PW, MODERN]) {
      for (let pips = 6; pips <= 16; pips += 1) {
        for (const title of names) {
          const { text } = fitDetachedCostTitle(p, title, "{W}".repeat(pips))!;
          if (text === title) continue;
          cuts += 1;
          const head = text.slice(0, -1);
          expect(title.startsWith(head), text).toBe(true);
          const next = title.charAt(head.length);
          const wholeWord = /[\s,;:—]/u.test(next);
          const lastWord = /\S*$/u.exec(head)![0];
          expect(wholeWord || lastWord === head || Array.from(lastWord).length >= 3, text).toBe(true);
        }
      }
    }
    expect(cuts).toBeGreaterThan(40);
  });

  it("never grows a name, and leaves an inline cost's name alone", () => {
    expect(fitDetachedCostTitle(LEGACY_PW, "Wing", "{W}")!.sizePct).toBe(LEGACY_PW.title.sizePct);
    expect(fitDetachedCostTitle(getFrameProfile("m15"), "Miner the Miner, Damned Delver", "{1}{R}{W}{B}")).toBeNull();
    expect(fitDetachedCostTitle(LEGACY_PW, "Miner the Miner, Damned Delver", null)).toBeNull();
  });
});
