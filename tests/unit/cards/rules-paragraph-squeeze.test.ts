import { describe, expect, it } from "vitest";
import { mainRulesLayout, rulesDraw } from "@/lib/cards/rules-box";
import { RULES_TARGETS, fitRulesLayout, layoutRulesAt, linePositions, type RulesLayoutInput } from "@/lib/cards/rules-layout";
import {
  M20_TOKEN_TALL_PARAGRAPH_GAP_MIN_PX,
  M20_TOKEN_TALL_RULES_PX,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { RULES_TEXT, rulesPxToPct } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The full-art token's TALL box (TODO 4.48, tall-box calibration 2026-09-29):
//   * its rules rect sits where the tall prints set their text — 1317–1930 px
//     (centred on the box's middle, 1319–1932, our first and last baselines
//     ran +2 / +2.5 px below six 9 pt prints'; now +0 / +0.5);
//   * before a size steps down, the text is set with its paragraph gaps
//     squeezed (TextSlot.paragraphGapMinPx), as the prints do: TBLB #5
//     Warren Warleader prints its modes and reminder at 9 pt with 10–13 px
//     gaps, where the standard 24 px ran its last line into the P/T plate
//     and stepped it down three sizes, to 70 px.
// No other box squeezes: every other template's layout is unchanged.
// ---------------------------------------------------------------------------

const PORTRAIT = 7 / 5;
const TALL = ["m20tokentall", "m20tokenartifacttall"];
const WARLEADER =
  "Whenever you attack, choose one —\n• Create a 1/1 white Rabbit creature token that's tapped and attacking.\n• Attacking creatures you control get +1/+1 until end of turn.\n(This token's mana cost is {2}{W}{W}.)";

const layoutOf = (template: string, rulesText: string | null, flavorText: string | null = null, pt = true) =>
  mainRulesLayout({ layout: getFrameProfile(template), rulesText, flavorText, aspect: PORTRAIT, show: { pt } });

/** A plain box for the mechanism itself, no vertical padding. */
const box = (over: Partial<RulesLayoutInput> = {}): RulesLayoutInput => ({
  rulesText: "Flying.\nVigilance.\nTrample.\nHaste.\nReach.\nMenace.",
  rect: { topPct: 50, leftPct: 10, widthPct: 60, heightPct: 28 },
  aspect: PORTRAIT,
  sizePct: rulesPxToPct(76),
  vAlign: "center",
  padPx: { x: 9, y: 0 },
  ...over,
});

describe("which boxes squeeze their paragraph gaps", () => {
  it("only the full-art tall box (both templates) — every other slot keeps its gaps", () => {
    const squeezing = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).rules.paragraphGapMinPx !== undefined);
    expect(squeezing).toEqual(TALL);
    for (const t of TALL) expect(getFrameProfile(t).rules.paragraphGapMinPx).toBe(M20_TOKEN_TALL_PARAGRAPH_GAP_MIN_PX);
    expect(M20_TOKEN_TALL_PARAGRAPH_GAP_MIN_PX).toBe(10);
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(t);
      for (const slot of [p.title, p.type, p.footer, p.adventure?.rules, p.secondFace?.rules]) {
        expect(slot?.paragraphGapMinPx, t).toBeUndefined();
      }
    }
    // The layout gets it from the slot, and nothing from a box without it.
    expect(layoutOf("m20tokentall", "Flying").input.paragraphGapMinPx).toBe(10);
    expect("paragraphGapMinPx" in layoutOf("m20tokentext", "Flying").input).toBe(false);
  });

  it("puts the tall rules rect at 1317–1930 px, 613 px tall", () => {
    expect(M20_TOKEN_TALL_RULES_PX).toEqual({ top: 1317, bottom: 1930 });
    for (const t of TALL) {
      const placed = linePositions(layoutOf(t, "Flying"), "hd");
      expect(placed.box.top, t).toBe(1317);
      expect(placed.box.top + placed.box.height, t).toBe(1930);
    }
  });
});

describe("fitRulesLayout's paragraph squeeze (RulesLayoutInput.paragraphGapMinPx)", () => {
  // Six one-word paragraphs: 6 × 74 + 5 × 24 = 564 px of lines and gaps at
  // 76 px, in a box with no vertical padding.
  const heightFor = (px: number) => (px / 2100) * 100;
  const fits = (input: RulesLayoutInput, sizePx: number, gap: number) => {
    const at = layoutRulesAt({ ...input, paragraphGapPx: gap }, sizePx);
    return RULES_TARGETS.every((t) => at.checks[t].fits);
  };

  it("leaves a text that fits as it is: the full gap, nothing recorded", () => {
    const fit = fitRulesLayout(box({ rect: { topPct: 50, leftPct: 10, widthPct: 60, heightPct: heightFor(600) }, paragraphGapMinPx: 10 }));
    expect(fit.sizePx).toBe(76);
    expect(fit.input.paragraphGapPx).toBeUndefined();
  });

  it("sets a text too tall at a size with the widest gap that fits before stepping down", () => {
    // 552 px: 24 px gaps overflow; smaller ones fit.
    const tight = box({ rect: { topPct: 50, leftPct: 10, widthPct: 60, heightPct: heightFor(552) } });
    const plain = fitRulesLayout(tight);
    expect(plain.sizePx).toBeLessThan(76);
    const fit = fitRulesLayout({ ...tight, paragraphGapMinPx: 10 });
    expect(fit.sizePx).toBe(76);
    expect(fit.clipped).toBe(false);
    for (const t of RULES_TARGETS) expect(fit.checks[t].fits, t).toBe(true);
    const gap = fit.input.paragraphGapPx!;
    // The widest even gap that fits: 2 px more doesn't.
    expect(gap).toBeLessThan(RULES_TEXT.paragraphGapPx);
    expect(gap).toBeGreaterThanOrEqual(10);
    expect(gap % 2).toBe(0);
    expect(fits(tight, 76, gap)).toBe(true);
    expect(fits(tight, 76, gap + 2)).toBe(false);
    // Same lines as the unsqueezed layout at that size: a gap never moves a
    // break.
    expect(fit.blocks).toEqual(layoutRulesAt(tight, 76).blocks);
    // The placement and the draw carry the gap: line box to line box is the
    // pitch plus the gap at HD, half of it at 750.
    const hd = linePositions(fit, "hd");
    expect(hd.lines[1].top - hd.lines[0].top).toBe(hd.metrics.linePx + gap);
    const half = linePositions(fit, "default");
    expect(half.lines[1].top - half.lines[0].top).toBe(half.metrics.linePx + gap / 2);
    expect(rulesDraw(fit, "hd").blocks[1]).toMatchObject({ kind: "rules", marginTop: gap });
    expect(rulesDraw(fit, "default").blocks[1]).toMatchObject({ kind: "rules", marginTop: gap / 2 });
  });

  it("stops at the slot's minimum, then steps down (and squeezes there again)", () => {
    // 480 px: even 10 px gaps (494 px) overflow at 76 px.
    const tighter = box({ rect: { topPct: 50, leftPct: 10, widthPct: 60, heightPct: heightFor(480) }, paragraphGapMinPx: 10 });
    expect(fits(tighter, 76, 10)).toBe(false);
    const fit = fitRulesLayout(tighter);
    expect(fit.sizePx).toBeLessThan(76);
    expect(fit.clipped).toBe(false);
    expect(fit.input.paragraphGapPx ?? RULES_TEXT.paragraphGapPx).toBeGreaterThanOrEqual(10);
  });

  it("never squeezes a text with no paragraph gap, nor the gap before the flavour", () => {
    const one = box({
      rulesText:
        "Whenever this creature attacks, draw a card, then discard a card. Then scry two and put a +1/+1 counter on it and each other creature you control.",
      rect: { topPct: 60, leftPct: 10, widthPct: 60, heightPct: heightFor(150) },
      paragraphGapMinPx: 10,
    });
    expect(fitRulesLayout(one).input.paragraphGapPx).toBeUndefined();
    // Rules + flavour, the box too short for 24 px gaps: only the rules
    // paragraphs' gap moves; the flavour's (and its bar) is the prints'
    // constant.
    const flavoured = box({
      rulesText: "Flying.\nVigilance.\nTrample.\nHaste.",
      flavorText: "It sees you.",
      rect: { topPct: 50, leftPct: 10, widthPct: 60, heightPct: heightFor(5 * 74 + 3 * 24 + 61 - 20) },
      paragraphGapMinPx: 10,
    });
    const fit = fitRulesLayout(flavoured);
    expect(fit.sizePx).toBe(76);
    expect(fit.input.paragraphGapPx).toBeLessThan(RULES_TEXT.paragraphGapPx);
    const draw = rulesDraw(fit, "hd");
    const flavour = draw.blocks.find((b) => b.kind === "flavor");
    expect(flavour && flavour.kind === "flavor" ? flavour.bar : null).toMatchObject({
      above: RULES_TEXT.flavorGapPx,
      below: RULES_TEXT.flavorGapPx,
    });
  });
});

describe("TBLB #5 Warren Warleader on the tall box: 9 pt, as printed", () => {
  it("keeps 76 px with its gaps at 12 px, its last line clear of the P/T plate — where 24 px gaps stepped it down to 70", () => {
    for (const t of TALL) {
      const fit = layoutOf(t, WARLEADER);
      expect(fit.sizePx, t).toBe(76);
      expect(fit.clipped, t).toBe(false);
      expect(fit.input.paragraphGapPx, t).toBe(12);
      // Without the squeeze (the rect as it is), the plate stepped it down.
      const { paragraphGapMinPx: _min, paragraphGapPx: _gap, ...unsqueezed } = fit.input;
      void _min;
      void _gap;
      expect(fitRulesLayout(unsqueezed).sizePx, t).toBe(70);
    }
    // Where the print sets it (Scryfall PNG at 1500 × 2100): baselines 1441
    // … 1846, gaps 10–13 px — ours 1441 … 1847.
    const placed = linePositions(layoutOf("m20tokentall", WARLEADER), "hd");
    const base = placed.metrics.baselinePx;
    const baselines = placed.lines.map((l) => l.top + (layoutOf("m20tokentall", WARLEADER).blocks[l.block].kind === "flavor" ? base.italic : base.regular));
    expect(Math.abs(baselines[0] - 1441)).toBeLessThanOrEqual(2);
    expect(Math.abs(baselines[baselines.length - 1] - 1846)).toBeLessThanOrEqual(2);
  });
});
