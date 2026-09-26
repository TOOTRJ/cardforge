import { describe, expect, it } from "vitest";
import { parseLoyaltyAbilities } from "@/lib/cards/card-display";
import { displayTextWidthEm } from "@/lib/cards/display-metrics";
import {
  LOYALTY_ROW,
  layoutLoyaltyRows,
  layoutProfileLoyaltyRows,
  loyaltyRowEdgesPx,
  loyaltyShieldRect,
} from "@/lib/cards/loyalty-rows";
import { estimateRulesHeightW, fitRulesSizePct, rulesSizeLadder } from "@/lib/cards/render-tiers";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  detachedCostTitleWidthPct,
  fitDetachedCostTitle,
  manaCostWidthPct,
  TITLE_COST_GAP_PCT,
  TITLE_FIT_HEADROOM,
} from "@/lib/cards/title-band";
import { RULES_TEXT, pctToPt, ptToPct } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// Planeswalker ability rows sized by their text (TODO 3.13), the last one
// wrapping before the loyalty shield (4.19), and the name that stops before
// a detached cost (4.31), shrinking to fit there (3.10 for these frames).
// All pure, shared by the preview and the bake; real-pixel checks live in
// tests/unit/render/pw-rows-bake.test.tsx.
// ---------------------------------------------------------------------------

const M15PW = getFrameProfile("m15pw");
const ASPECT = 7 / 5;
const layout = (rules: string) =>
  layoutLoyaltyRows({
    abilities: parseLoyaltyAbilities(rules),
    rect: M15PW.rules.rect,
    baseSizePct: M15PW.rules.sizePct,
    aspect: ASPECT,
  });
const boxH = (M15PW.rules.rect.heightPct / 100) * ASPECT;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// The acceptance walker: 1-line / 1-line / 5-line.
const WALKER_115 =
  "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"";

describe("layoutLoyaltyRows", () => {
  it("keeps equal rows at the base size for equally short abilities (the old look)", () => {
    const { sizePct, rowFractions } = layout("+2: Scry 2.\n−3: Draw a card.\n−7: You win.");
    expect(sizePct).toBe(M15PW.rules.sizePct);
    expect(rowFractions).toHaveLength(3);
    for (const f of rowFractions) expect(f).toBeCloseTo(1 / 3, 10);
  });

  it("gives a long ability the height its text needs and shares the rest (1 / 1 / 5 lines)", () => {
    const { sizePct, rowFractions } = layout(WALKER_115);
    const [a, b, c] = rowFractions;
    expect(sum(rowFractions)).toBeCloseTo(1, 10);
    expect(a).toBeCloseTo(b, 10);
    expect(c).toBeGreaterThan(2.5 * a);
    // The long row holds its estimated text + padding at the chosen size…
    const columnW =
      M15PW.rules.rect.widthPct / 100 -
      sizePct * (2 * LOYALTY_ROW.padXEm + LOYALTY_ROW.badgeWidthEm + LOYALTY_ROW.badgeGapEm);
    const ability = parseLoyaltyAbilities(WALKER_115)[2].text;
    const textH = estimateRulesHeightW(ability, sizePct, RULES_TEXT.lineHeight, columnW);
    // (The estimate errs wide: it counts at least the five lines it prints.)
    expect(textH / (RULES_TEXT.lineHeight + RULES_TEXT.wrapGapEm) / sizePct).toBeGreaterThanOrEqual(5 - 1e-9);
    expect(c * boxH).toBeGreaterThanOrEqual(textH + 2 * LOYALTY_ROW.padYEm * sizePct);
    // …and the short ones at least a badge and its padding.
    const floor = (LOYALTY_ROW.badgeHeightEm + 2 * LOYALTY_ROW.padYEm) * sizePct;
    expect(a * boxH).toBeGreaterThanOrEqual(floor);
    // It is the largest ladder step at which all rows fit: one half-point up
    // they would not.
    const ladder = rulesSizeLadder(M15PW.rules.sizePct, ASPECT);
    expect(ladder).toContain(sizePct);
    expect(pctToPt(sizePct)).toBeLessThan(pctToPt(M15PW.rules.sizePct));
  });

  it("shrinks the whole box's text only when the rows together overflow it", () => {
    const long = "Each opponent sacrifices a creature, discards a card and loses 2 life. ";
    const rules = ["+1: " + long.repeat(2), "−2: " + long.repeat(2), "−6: " + long.repeat(3), "−9: " + long.repeat(2)].join("\n");
    const tight = layout(rules);
    expect(tight.sizePct).toBeLessThan(layout(WALKER_115).sizePct);
    expect(sum(tight.rowFractions)).toBeCloseTo(1, 10);
  });

  it("past the hard floor scales every row down alike instead of dropping the last ones", () => {
    const rules = Array.from({ length: 6 }, (_, i) => `−${i + 1}: ${"Destroy all creatures and all lands you do not control. ".repeat(4)}`).join("\n");
    const { sizePct, rowFractions } = layout(rules);
    expect(pctToPt(sizePct)).toBeCloseTo(RULES_TEXT.hardFloorPt, 6);
    expect(sum(rowFractions)).toBeCloseTo(1, 10);
    for (const f of rowFractions) expect(f).toBeCloseTo(1 / 6, 10);
  });

  it("counts capitals at their own width, so an ALL-CAPS ability gets the rows it draws", () => {
    // MPlantin capitals are ≈0.74 em against the 0.5 em a mixed-case letter
    // is counted at: counted alike, an all-caps −3 got a 3-line row and drew
    // 5 lines, over the next stripe and under the loyalty shield.
    const caps =
      "+1: CREATURES YOU CONTROL GET +2/+2 AND GAIN TRAMPLE UNTIL END OF TURN.\n−3: DESTROY TARGET CREATURE OR PLANESWALKER WITH MANA VALUE 4 OR GREATER. ITS CONTROLLER CREATES A TREASURE TOKEN AND A CLUE TOKEN.\n−8: YOU GET AN EMBLEM WITH \"WHENEVER A CREATURE YOU CONTROL ATTACKS, DRAW A CARD.\"";
    const lower = caps.toLowerCase();
    const size = M15PW.rules.sizePct;
    const text = parseLoyaltyAbilities(caps)[1].text;
    const columnW = 0.5;
    expect(estimateRulesHeightW(text, size, RULES_TEXT.lineHeight, columnW)).toBeGreaterThan(
      1.3 * estimateRulesHeightW(text.toLowerCase(), size, RULES_TEXT.lineHeight, columnW),
    );
    // So the caps walker fits at a smaller size than the same words in lower
    // case.
    const [c, l] = [layout(caps), layout(lower)];
    expect(c.sizePct).toBeLessThan(l.sizePct);
    // The whole-box fit (every other frame's rules box) keeps the plain
    // count: capitals never move a fitted size there.
    const fit = (rulesText: string) =>
      fitRulesSizePct({ rulesText, flavorText: null, rect: M15PW.rules.rect, baseSizePct: size, aspect: ASPECT });
    expect(fit(caps)).toBe(fit(lower));
  });

  it("gives a static (unbadged) ability and an empty hint row the badge-height floor", () => {
    const { rowFractions } = layoutLoyaltyRows({
      abilities: [
        { cost: null, text: "" },
        { cost: "+1", text: "Scry 1." },
      ],
      rect: M15PW.rules.rect,
      baseSizePct: M15PW.rules.sizePct,
      aspect: ASPECT,
    });
    expect(rowFractions[0]).toBeCloseTo(rowFractions[1], 10);
  });

  it("is deterministic and empty for no abilities", () => {
    expect(layout(WALKER_115)).toEqual(layout(WALKER_115));
    expect(layoutLoyaltyRows({ abilities: [], rect: M15PW.rules.rect, baseSizePct: 0.04, aspect: ASPECT })).toEqual({
      sizePct: 0.04,
      rowFractions: [],
      lastRowInsetPct: 0,
    });
  });
});

describe("the last ability wraps before the loyalty shield (TODO 4.19)", () => {
  const rulesRight = (M15PW.rules.rect.leftPct + M15PW.rules.rect.widthPct) / 100;
  const plate = M15PW.loyalty!.plateRect!;
  const withShield = (rules: string) => layoutProfileLoyaltyRows(M15PW, parseLoyaltyAbilities(rules), ASPECT);
  // A 3-ability walker whose ultimate is long (a test walker; its closing
  // quote reached under the shield on the reviewed branch).
  const LONG_LAST =
    "+1: Create a 1/1 white Soldier creature token.\n−4: Exile target nonland permanent. Its controller creates a 2/2 colorless Robot artifact creature token.\n−8: You get an emblem with \"Whenever you cast a spell, exile the top card of your library. You may play it this turn. At the beginning of your end step, return all creature cards exiled with Probe to the battlefield.\"";

  it("takes the shield from the loyalty plate's box, else the value's", () => {
    expect(loyaltyShieldRect(M15PW)).toEqual(plate);
    expect(loyaltyShieldRect({ loyalty: { ...M15PW.loyalty!, plateRect: undefined } })).toEqual(M15PW.loyalty!.rect);
    expect(loyaltyShieldRect(getFrameProfile("m15"))).toBeNull();
  });

  it("ends the last row's text column where the shield's box begins (m15pw: 12.4 % of the width)", () => {
    const { lastRowInsetPct } = withShield(WALKER_115);
    expect(lastRowInsetPct).toBeCloseTo(rulesRight - plate.leftPct / 100, 12);
    expect(lastRowInsetPct).toBeCloseTo(0.124, 6);
    // The same call both renderers make.
    expect(withShield(WALKER_115)).toEqual(
      layoutLoyaltyRows({
        abilities: parseLoyaltyAbilities(WALKER_115),
        rect: M15PW.rules.rect,
        baseSizePct: M15PW.rules.sizePct,
        aspect: ASPECT,
        shield: plate,
      }),
    );
  });

  it("sizes the last row for its narrower column, so its text still fits its row", () => {
    const abilities = parseLoyaltyAbilities(LONG_LAST);
    const before = layout(LONG_LAST); // the whole width, as on the reviewed branch
    const after = withShield(LONG_LAST);
    // The ultimate needs more lines in the narrower column: its row grows
    // (or the whole box steps its text down).
    expect(after.rowFractions[2] > before.rowFractions[2] || after.sizePct < before.sizePct).toBe(true);
    expect(sum(after.rowFractions)).toBeCloseTo(1, 10);
    // The estimate in the narrow column, plus padding, fits the last row.
    const { sizePct, rowFractions, lastRowInsetPct } = after;
    const columnW =
      M15PW.rules.rect.widthPct / 100 -
      sizePct * (2 * LOYALTY_ROW.padXEm + LOYALTY_ROW.badgeWidthEm + LOYALTY_ROW.badgeGapEm) -
      lastRowInsetPct;
    const textH = estimateRulesHeightW(abilities[2].text, sizePct, RULES_TEXT.lineHeight, columnW);
    expect(rowFractions[2] * boxH).toBeGreaterThanOrEqual(textH + 2 * LOYALTY_ROW.padYEm * sizePct - 1e-12);
    // (At the full-width layout's size, the narrow column takes more lines
    // than the full one — why this walker's rows changed at all.)
    const at = (w: number) =>
      estimateRulesHeightW(
        abilities[2].text,
        before.sizePct,
        RULES_TEXT.lineHeight,
        M15PW.rules.rect.widthPct / 100 -
          before.sizePct * (2 * LOYALTY_ROW.padXEm + LOYALTY_ROW.badgeWidthEm + LOYALTY_ROW.badgeGapEm) -
          w,
      );
    expect(at(lastRowInsetPct)).toBeGreaterThan(at(0));
  });

  it("only narrows the last row, and leaves equal short abilities equal", () => {
    // Three one-liners: every row still fits a badge and a line, so the
    // stripes stay equal; only the last text column is narrower.
    const short = withShield("+2: Scry 2.\n−3: Draw a card.\n−7: You win.");
    for (const f of short.rowFractions) expect(f).toBeCloseTo(1 / 3, 10);
    expect(short.lastRowInsetPct).toBeGreaterThan(0);
  });

  it("ignores a shield that misses the box, and never takes more than half its width", () => {
    const rect = M15PW.rules.rect;
    const lay = (shield: typeof plate | null) =>
      layoutLoyaltyRows({ abilities: parseLoyaltyAbilities(WALKER_115), rect, baseSizePct: M15PW.rules.sizePct, aspect: ASPECT, shield });
    expect(lay(null).lastRowInsetPct).toBe(0);
    expect(lay({ ...plate, topPct: rect.topPct + rect.heightPct + 1 }).lastRowInsetPct).toBe(0); // below the box
    expect(lay({ ...plate, leftPct: rect.leftPct + rect.widthPct + 1 }).lastRowInsetPct).toBe(0); // right of it
    expect(lay({ ...plate, leftPct: 0 }).lastRowInsetPct).toBeCloseTo(rect.widthPct / 200, 12);
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

describe("the name next to a detached cost (costRect)", () => {
  it("measures a cost as its discs plus the pip gaps", () => {
    expect(manaCostWidthPct("{W}", 0.04)).toBeCloseTo(0.04, 10);
    expect(manaCostWidthPct("{1}{R}{W}{B}", 0.04)).toBeCloseTo(4 * 0.04 + 3 * 0.12 * 0.04, 10);
    expect(manaCostWidthPct("{W/U}{B/P}{2/R}", 0.04)).toBeCloseTo(3 * 0.04 + 2 * 0.12 * 0.04, 10);
    expect(manaCostWidthPct("", 0.04)).toBe(0);
  });

  it("ends the name one band gap before the pips, never past the band", () => {
    const cost = "{1}{R}{W}{B}";
    const w = detachedCostTitleWidthPct(M15PW, cost)!;
    const pipsLeft = (M15PW.costRect!.leftPct + M15PW.costRect!.widthPct) / 100 - manaCostWidthPct(cost, M15PW.title.sizePct);
    expect(M15PW.title.rect.leftPct / 100 + w + TITLE_COST_GAP_PCT).toBeCloseTo(pipsLeft, 10);
    // A short cost leaves what the band always left the name (band − gap).
    expect(detachedCostTitleWidthPct({ ...M15PW, costRect: { ...M15PW.costRect!, leftPct: 90, widthPct: 30 } }, "{W}")).toBeCloseTo(
      M15PW.title.rect.widthPct / 100 - TITLE_COST_GAP_PCT,
      10,
    );
    // More pips, less name.
    expect(detachedCostTitleWidthPct(M15PW, "{W}")!).toBeGreaterThan(w);
  });

  it("only applies to a drawn cost in a detached box", () => {
    expect(detachedCostTitleWidthPct(M15PW, null)).toBeNull();
    expect(detachedCostTitleWidthPct(M15PW, "  ")).toBeNull();
    expect(detachedCostTitleWidthPct(getFrameProfile("m15"), "{1}{R}")).toBeNull();
    expect(detachedCostTitleWidthPct(getFrameProfile("modern"), "{1}{R}")).not.toBeNull();
  });
});

describe("a long name shrinks to fit before a detached cost (owner decision, TODO 3.10)", () => {
  const MODERN = getFrameProfile("modern");
  const FLOOR = ptToPct(RULES_TEXT.hardFloorPt);
  /** The name's drawn width at `size` with the fit's headroom, card-width. */
  const drawn = (p: typeof M15PW, text: string, size: number) =>
    displayTextWidthEm(text, { letterSpacingEm: p.title.letterSpacingEm }) * size * TITLE_FIT_HEADROOM;

  it("keeps a name that fits at the slot's own size, whole", () => {
    for (const [p, title, cost] of [
      [M15PW, "Kikyo Zoldyck", "{1}{R}{W}{B}"],
      [M15PW, "Coden, the Great Creator", "{4}"],
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
    const fit = fitDetachedCostTitle(M15PW, title, "{1}{R}{W}{B}")!;
    expect(fit.text).toBe(title);
    expect(fit.sizePct).toBeLessThan(M15PW.title.sizePct);
    // The largest size that fits: the name, with its headroom, fills the
    // width exactly (about 5 % smaller than the slot's 7.7 pt).
    expect(drawn(M15PW, title, fit.sizePct)).toBeCloseTo(fit.widthPct, 12);
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
    for (const p of [M15PW, MODERN]) {
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
    const cut = fitDetachedCostTitle(M15PW, "Skeptic, the Endlessly Wandering Walker of Worlds", cost)!.text;
    expect(cut).not.toMatch(/[\s,;:]…$/u);
  });

  it("never grows a name, and leaves an inline cost's name alone", () => {
    expect(fitDetachedCostTitle(M15PW, "Wing", "{W}")!.sizePct).toBe(M15PW.title.sizePct);
    expect(fitDetachedCostTitle(getFrameProfile("m15"), "Miner the Miner, Damned Delver", "{1}{R}{W}{B}")).toBeNull();
    expect(fitDetachedCostTitle(M15PW, "Miner the Miner, Damned Delver", null)).toBeNull();
  });
});
