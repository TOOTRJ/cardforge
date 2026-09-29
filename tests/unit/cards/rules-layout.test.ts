import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error -- opentype.js (a dev dependency) ships no type declarations.
import opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import {
  RULES_TARGETS,
  blockHeightPx,
  breakRulesText,
  fitRulesLayout,
  keepOutInBoxFrame,
  layoutRulesAt,
  linePositions,
  metricsFor,
  rectPx,
  rulesLadderPx,
  runWidthPx,
  statKeepOuts,
  type RulesBlock,
  type RulesLayoutInput,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import type { RulesItem } from "@/lib/cards/rules-text";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { RULES_BOX_PAD_PX, RULES_SIZE_PX, RULES_TEXT, ptToPct, rulesPxToPct } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// lib/cards/rules-layout.ts — the ONE rules layout of layout v33 (TODO 3.29):
// the size, every line break and every vertical position, checked against
// both bake targets. The widths below are recomputed from MPlantin's own
// advances (the committed TTFs, as tests/unit/cards/rules-metrics.test.ts
// reads them), never from the module's tables.
// ---------------------------------------------------------------------------

type Font = { unitsPerEm: number; charToGlyph(ch: string): { advanceWidth: number } };
const parse = (file: string): Font => {
  const buf = readFileSync(join(process.cwd(), "public/fonts", file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
};
const REGULAR = parse("mplantin.ttf");
const ITALIC = parse("mplantin-italic.ttf");
/** A word's width in the font's own advances, ceiled to the px as Satori's
 *  text measure reports it. */
const wordPx = (word: string, fontPx: number, italic = false) => {
  const font = italic ? ITALIC : REGULAR;
  let units = 0;
  for (const ch of word) units += font.charToGlyph(ch === "−" ? "-" : ch).advanceWidth;
  return Math.ceil((units / font.unitsPerEm) * fontPx - 1e-6);
};

const M15 = getFrameProfile("m15");
const PORTRAIT = 7 / 5;
/** The M15 box with the prints' margins (the profile's: 4 / 0 HD px — a
 *  by-eye item on the round-9 sheet) and the P/T plate's measured ink
 *  (1157.6, 1864.8 HD px on m15 / artifact / snow / devoid) as its keep-out. */
const PRINT_PAD = M15.rules.padPx!;
const PLATE_INK: Rect = {
  leftPct: (1157.6 / 1500) * 100,
  topPct: (1864.8 / 2100) * 100,
  widthPct: 100 - (1157.6 / 1500) * 100,
  heightPct: 100 - (1864.8 / 2100) * 100,
};
const m15 = (rulesText: string, over: Partial<RulesLayoutInput> = {}): RulesLayoutInput => ({
  rulesText,
  rect: M15.rules.rect,
  aspect: PORTRAIT,
  sizePct: M15.rules.sizePct,
  vAlign: M15.rules.vAlign,
  ...over,
});
const lineCounts = (blocks: readonly RulesBlock[]) => blocks.map((b) => b.lines.length).join("+");
const EVEN_LADDER = Array.from({ length: (76 - 42) / 2 + 1 }, (_, i) => 76 - 2 * i);

// Two of the round-9 print references (EOE #30, TLA #112): the design's
// harness put them at 58 and 62 px with the prints' margins and the plate
// keep-out (print: 59.85 and 60.6 px).
const EOE_30 =
  "When this creature enters, put a +1/+1 counter on target creature you control.\nWhenever a nontoken creature you control with a +1/+1 counter on it dies, create a 1/1 white Human Soldier creature token.\nWarp {1}{W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)";
const TLA_112 =
  "When this enchantment enters and at the beginning of your upkeep, you lose 1 life and create a Clue token. (It’s an artifact with “{2}, Sacrifice this token: Draw a card.”)\nWhenever you attack, put X +1/+1 counters on target attacking creature, where X is the number of permanents you’ve sacrificed this turn. If X is three or greater, that creature gains lifelink until end of turn.";

describe("metricsFor — whole px per target", () => {
  it("draws the 76 px standard at the prints' spacing: HD, and exactly half the font at 750", () => {
    expect(metricsFor(76, RULES_TEXT.lineHeight, "hd")).toMatchObject({
      fontPx: 76,
      linePx: 74, // 0.98 em
      wordGapPx: 20,
      pipPx: 65,
      pipGapPx: 8,
      paragraphGapPx: 24,
      flavorGapPx: 30,
      flavorGapNoBarPx: 42,
      barPx: 1,
      blankLinePx: 46,
      baselinePx: { regular: 58, italic: 58 },
    });
    expect(metricsFor(76, RULES_TEXT.lineHeight, "default")).toMatchObject({
      fontPx: 38,
      linePx: 37,
      wordGapPx: 10,
      pipPx: 33,
      pipGapPx: 4,
      paragraphGapPx: 12,
      flavorGapPx: 15,
      flavorGapNoBarPx: 21,
      barPx: 1,
      blankLinePx: 23,
    });
  });

  it("gives every ladder size a whole-px font at both targets, each rounding its own vertical metrics", () => {
    for (const s of EVEN_LADDER) {
      const hd = metricsFor(s, RULES_TEXT.lineHeight, "hd");
      const half = metricsFor(s, RULES_TEXT.lineHeight, "default");
      expect(half.fontPx * 2, `${s}`).toBe(hd.fontPx);
      expect(Number.isInteger(half.fontPx), `${s}`).toBe(true);
      expect(hd.linePx).toBe(Math.round(0.98 * s));
      expect(half.linePx).toBe(Math.round(0.49 * s));
      // Baseline: the half-leading plus the hhea ascender, to the px.
      expect(hd.baselinePx.regular).toBe(Math.round((hd.linePx - 0.999 * s) / 2 + 0.774 * s));
    }
    // The 750 bake's word gap, doubled, is a px wider than the HD one at
    // 50 / 58 / 66 / 74 — why lines are checked at both targets.
    for (const s of [50, 58, 66, 74]) {
      expect(2 * metricsFor(s, 0.98, "default").wordGapPx, `${s}`).toBe(metricsFor(s, 0.98, "hd").wordGapPx + 1);
    }
  });

  it("takes a slot's line height (a profile override) for the line pitch", () => {
    expect(metricsFor(76, 1.2, "hd").linePx).toBe(91);
    expect(metricsFor(76, 1.2, "default").linePx).toBe(46);
  });
});

describe("the even HD-px ladder", () => {
  it("names the prints' sizes at 63 mm rounded UP to an even px — none below the v32 size it replaces", () => {
    const printPx = (pt: number) => ((pt / 72) * 25.4 * 1500) / 63; // a 63 mm card, 1500 px wide
    for (const [px, pt] of [
      [RULES_SIZE_PX.standard, 9],
      [RULES_SIZE_PX.reduced, 8],
      [RULES_SIZE_PX.compact, 7.5],
    ] as const) {
      expect(px % 2, `${pt} pt`).toBe(0);
      expect(px, `${pt} pt`).toBe(Math.ceil(printPx(pt) / 2) * 2);
      expect(px, `${pt} pt`).toBeGreaterThanOrEqual(ptToPct(pt) * 1500);
    }
    expect(RULES_SIZE_PX.floor).toBe(Math.round(ptToPct(RULES_TEXT.hardFloorPt) * 1500)); // 5 pt, as the bake drew it
    expect(RULES_SIZE_PX.stepPx).toBe(2);
  });

  it("steps 2 px from the slot's ceiling down to the 42 px floor", () => {
    expect(rulesLadderPx(rulesPxToPct(RULES_SIZE_PX.standard))).toEqual(EVEN_LADDER);
    expect(rulesLadderPx(rulesPxToPct(RULES_SIZE_PX.reduced))[0]).toBe(68);
    expect(rulesLadderPx(rulesPxToPct(RULES_SIZE_PX.compact))[0]).toBe(64);
    expect(rulesLadderPx(rulesPxToPct(RULES_SIZE_PX.reduced, "landscape"), "landscape")).toEqual(
      EVEN_LADDER.filter((s) => s <= 68),
    );
    for (const ladder of [EVEN_LADDER, rulesLadderPx(0.04321)]) {
      expect(ladder.at(-1)).toBe(RULES_SIZE_PX.floor);
      expect(ladder.every((s) => s % 2 === 0)).toBe(true);
    }
  });

  it("snaps an off-grid size DOWN to the grid (an override never grows); a size under the floor is its own step", () => {
    expect(rulesLadderPx(ptToPct(9))[0]).toBe(74); // 75 px, the old 9 pt
    expect(rulesLadderPx(ptToPct(8))[0]).toBe(66); // 66.67 px
    expect(rulesLadderPx(0.0507)[0]).toBe(76); // 76.05 px
    expect(rulesLadderPx(40 / 1500)).toEqual([40]);
  });

  it("gives every profile's rules box a named ceiling", () => {
    const named = new Set(
      [RULES_SIZE_PX.standard, RULES_SIZE_PX.reduced, RULES_SIZE_PX.compact].flatMap((px) => [
        rulesPxToPct(px),
        rulesPxToPct(px, "landscape"),
      ]),
    );
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(t);
      for (const slot of [p.rules, p.secondFace?.rules, p.adventure?.rules]) {
        if (slot) expect(named.has(slot.sizePct), `${t} ${slot.sizePct}`).toBe(true);
      }
    }
    expect(getFrameProfile("m15").rules.sizePct).toBe(rulesPxToPct(76));
    expect(getFrameProfile("m15token").rules.sizePct).toBe(rulesPxToPct(76)); // the prints set tokens at 9 pt
    // Walkers print at most 7.5 pt (rules-box.ts walkerSizePct caps them at
    // the rows' maxSizePct); any other card on the frame gets v32's 8 pt.
    expect(getFrameProfile("m15pw").rules.sizePct).toBe(rulesPxToPct(68));
    expect(getFrameProfile("m15pw").loyaltyRows!.maxSizePct).toBe(rulesPxToPct(64));
    expect(getFrameProfile("battle").rules.sizePct).toBe(rulesPxToPct(68, "landscape"));
    // The saga's chapter rail keeps today's size (owner decision 2026-09-28:
    // its geometry is TODO 4.21's).
    expect(getFrameProfile("saga").chapters!.sizePct).toBe(0.029);
  });
});

describe("breakRulesText — explicit lines at MPlantin's advances", () => {
  it("measures each line as the bake draws it: ceiled words, whole-px pips and gaps", () => {
    const s = 76;
    const [block] = breakRulesText("{T}: Add {G}{G}. (Tap it.)", null, s, { hd: 5000, default: 2500 });
    expect(block.kind).toBe("rules");
    expect(block.lines).toHaveLength(1);
    const line = block.lines[0];
    expect(line.runs.map((r) => r.map((it) => (it.t === "m" ? `{${it.suffix}}` : it.v)).join(""))).toEqual([
      "{tap}:", "Add", "{g}{g}.", "(Tap", "it.)",
    ]);
    for (const target of RULES_TARGETS) {
      const m = metricsFor(s, 0.98, target);
      const expected =
        m.pipPx + wordPx(":", m.fontPx) + m.wordGapPx +
        wordPx("Add", m.fontPx) + m.wordGapPx +
        m.pipPx + m.pipGapPx + m.pipPx + wordPx(".", m.fontPx) + m.wordGapPx +
        wordPx("(Tap", m.fontPx, true) + m.wordGapPx +
        wordPx("it.)", m.fontPx, true);
      expect(line.widthPx[target], target).toBe(expected);
    }
  });

  it("fills each line greedily at BOTH targets: every line fits, and the next run would not", () => {
    const text = EOE_30;
    const columns = { hd: 1237, default: 618 };
    for (const s of [76, 62, 58, 50, 42]) {
      const blocks = breakRulesText(text, null, s, columns);
      const m = { hd: metricsFor(s, 0.98, "hd"), default: metricsFor(s, 0.98, "default") };
      for (const block of blocks) {
        block.lines.forEach((line, i) => {
          for (const t of RULES_TARGETS) expect(line.widthPx[t], `${s} ${t}`).toBeLessThanOrEqual(columns[t]);
          const next = block.lines[i + 1];
          if (!next) return;
          const joined = RULES_TARGETS.some(
            (t) => line.widthPx[t] + m[t].wordGapPx + runWidthPx(next.runs[0], m[t]) > columns[t],
          );
          expect(joined, `${s}: line ${i} could have taken "${JSON.stringify(next.runs[0])}"`).toBe(true);
        });
      }
    }
  });

  it("breaks where the 750 bake's own gaps overflow, even when the HD line would fit", () => {
    // At 74 px a word gap is 19 HD px but 10 px at 750 — 20 HD px. A column
    // the HD line of n words fills exactly, halved for 750, holds fewer.
    const s = 74;
    const hd = metricsFor(s, 0.98, "hd");
    const word = wordPx("a", hd.fontPx) + hd.wordGapPx; // per word, gap included
    const n = 12;
    const column = n * word - hd.wordGapPx;
    const text = Array(2 * n).fill("a").join(" ");
    const hdOnly = breakRulesText(text, null, s, { hd: column, default: 10_000 });
    expect(hdOnly[0].lines[0].runs).toHaveLength(n);
    const both = breakRulesText(text, null, s, { hd: column, default: Math.floor(column / 2) });
    expect(both[0].lines[0].runs.length).toBeLessThan(n);
    for (const line of both[0].lines) expect(line.widthPx.default).toBeLessThanOrEqual(Math.floor(column / 2));
  });

  it("never splits a run, and breaks a word after a pip from the pip (the v33 tokenizer)", () => {
    const blocks = breakRulesText("Pay an amount of {B} equal to its power.", null, 76, { hd: 700, default: 350 });
    const runs = blocks[0].lines.flatMap((l) => l.runs.map((r) => r.map((it) => (it.t === "m" ? `{${it.suffix}}` : it.v)).join("")));
    expect(runs).toContain("{b}");
    expect(runs).toContain("equal");
  });

  it("keeps paragraphs, blank lines and the flavor's source lines — flavor italic, broken at spaces only", () => {
    const blocks = breakRulesText("  Flying\n\nHaste  ", "“Swift as the wind.”\n\n—Old well-known saying ", 76, {
      hd: 1237,
      default: 618,
    });
    expect(blocks.map((b) => b.kind)).toEqual(["rules", "blank", "rules", "flavor"]);
    const flavor = blocks[3].lines;
    expect(flavor).toHaveLength(2); // the blank flavor line is dropped
    const items = flavor.flatMap((l) => l.runs.flat()) as Extract<RulesItem, { t: "w" }>[];
    expect(items.every((it) => it.t === "w" && it.em === "flavor")).toBe(true);
    expect(items.map((it) => it.v)).toContain("well-known"); // no break at a hyphen
    expect(breakRulesText(" \n ", "  ", 76, { hd: 1237, default: 618 })).toEqual([]);
  });

  it("gives a run wider than the column a line of its own", () => {
    const [block] = breakRulesText("A Pneumonoultramicroscopicsilicovolcanoconiosis b", null, 76, { hd: 900, default: 450 });
    expect(block.lines.map((l) => l.runs.length)).toEqual([1, 1, 1]);
    expect(block.lines[1].widthPx.hd).toBeGreaterThan(900);
  });
});

describe("layoutRulesAt — block height and positions", () => {
  const box = (target: RulesTarget) => rectPx(M15.rules.rect, "portrait", PORTRAIT, target);

  it("lays M15's box out on Yoga's whole-px edges", () => {
    expect(box("hd")).toEqual({ left: 128, top: 1336, right: 1373, bottom: 1924, width: 1245, height: 588 });
    expect(box("default")).toEqual({ left: 64, top: 668, right: 686, bottom: 962, width: 622, height: 294 });
  });

  it("stacks lines at the pitch, a fixed 24 px between abilities, 30 + 1 + 30 around the flavor bar (42 without)", () => {
    const rules = "Flying\nVigilance\n\nLifelink";
    const flavor = "Wings of light.";
    for (const target of RULES_TARGETS) {
      const m = metricsFor(76, 0.98, target);
      const bar = layoutRulesAt(m15(rules, { flavorText: flavor, padPx: PRINT_PAD }), 76);
      const noBar = layoutRulesAt(m15(rules, { flavorText: flavor, padPx: PRINT_PAD, divider: false }), 76);
      const lines = 4 * m.linePx;
      const gaps = 3 * m.paragraphGapPx + m.blankLinePx; // Flying | Vigilance | blank | Lifelink
      expect(blockHeightPx(bar, target), target).toBe(lines + gaps + 2 * m.flavorGapPx + m.barPx);
      expect(blockHeightPx(noBar, target), target).toBe(lines + gaps + m.flavorGapNoBarPx);
      const placed = linePositions(bar, target);
      const [flying, vigilance, lifelink, flavorLine] = placed.lines;
      expect(vigilance.top - flying.top).toBe(m.linePx + m.paragraphGapPx);
      expect(lifelink.top - vigilance.top).toBe(m.linePx + 2 * m.paragraphGapPx + m.blankLinePx);
      expect(placed.bar!.top - (lifelink.top + m.linePx)).toBe(m.flavorGapPx);
      expect(flavorLine.top - (placed.bar!.top + m.barPx)).toBe(m.flavorGapPx);
      expect(placed.blanks).toHaveLength(1);
      expect(linePositions(noBar, target).bar).toBeNull();
    }
    // Flavor alone: no gap, no bar.
    const alone = layoutRulesAt(m15("", { flavorText: flavor }), 76);
    expect(blockHeightPx(alone, "hd")).toBe(74);
    expect(linePositions(alone, "hd").bar).toBeNull();
  });

  it("places the block by the slot's vAlign inside the padded box", () => {
    const at = (vAlign: "start" | "center" | "end") => linePositions(layoutRulesAt(m15("Flying", { vAlign }), 76), "hd");
    const interiorTop = 1336 + RULES_BOX_PAD_PX.y;
    const interiorH = 588 - 2 * RULES_BOX_PAD_PX.y;
    expect(at("start").lines[0].top).toBe(interiorTop);
    expect(at("center").lines[0].top).toBe(interiorTop + (interiorH - 74) / 2);
    expect(at("end").lines[0].top).toBe(interiorTop + interiorH - 74);
    expect(at("start").lines[0].left).toBe(128 + RULES_BOX_PAD_PX.x);
  });

  it("reserves headroom for a first line's accented capital, so the box's clip keeps its accent", () => {
    const input = (text: string) => m15(text, { vAlign: "start", padPx: PRINT_PAD });
    for (const target of RULES_TARGETS) {
      const accent = linePositions(layoutRulesAt(input("Élan Vital"), 76), target);
      const plain = linePositions(layoutRulesAt(input("Elan Vital"), 76), target);
      const pips = linePositions(layoutRulesAt(input("{T}: Add {G}."), 76), target);
      // É reaches 0.901 em above the baseline — past the line box's top,
      // where the M15 box keeps no margin of its own (the prints' 4 / 0) — so
      // the block moves down by the difference, and its ink stays inside
      // the box.
      expect(accent.insetTop, target).toBeGreaterThan(0);
      expect(accent.lines[0].inkTop, target).toBeGreaterThanOrEqual(accent.box.top);
      expect(plain.insetTop, target).toBe(0);
      expect(pips.insetTop, target).toBe(0);
      expect(accent.lines[0].top - plain.lines[0].top).toBe(accent.insetTop);
    }
    expect(linePositions(layoutRulesAt(input("Élan Vital"), 76), "hd").insetTop).toBe(11);
    expect(linePositions(layoutRulesAt(input("Élan Vital"), 76), "default").insetTop).toBe(6);
    // Today's 18 px margin absorbs it.
    expect(linePositions(layoutRulesAt(m15("Élan Vital", { vAlign: "start" }), 76), "hd").insetTop).toBe(0);
    // A deep last line takes room below too, when the margin can't.
    const deep = linePositions(layoutRulesAt(m15("snake_case_", { vAlign: "end", padPx: { x: 4, y: 0 } }), 76), "hd");
    expect(deep.insetBottom).toBeGreaterThan(0);
    expect(deep.lines[0].inkBottom).toBeLessThanOrEqual(deep.box.top + deep.box.height);
  });
});

describe("fitRulesLayout — the largest step that fits both targets, no safety margin", () => {
  it("keeps short text at the ceiling", () => {
    const fit = fitRulesLayout(m15("Flying"));
    expect(fit.sizePx).toBe(76);
    expect(fit.clipped).toBe(false);
    expect(fit.sizePct).toBe(rulesPxToPct(76));
    const empty = fitRulesLayout(m15(""));
    expect(empty.sizePx).toBe(76);
    expect(empty.blocks).toEqual([]);
    expect(empty.clipped).toBe(false);
  });

  it("returns a size that fits at both targets, one step below a size that doesn't", () => {
    const texts = [
      "Flying, vigilance",
      "Flying\nWhenever this creature attacks, each other creature you control gets +1/+1 until end of turn.",
      EOE_30,
      TLA_112,
      `${EOE_30}\n${TLA_112}`,
    ];
    for (const text of texts) {
      for (const pad of [RULES_BOX_PAD_PX, PRINT_PAD]) {
        const input = m15(text, { padPx: pad, keepOuts: [PLATE_INK], flavorText: "“Hold the line.”" });
        const fit = fitRulesLayout(input);
        if (!fit.clipped) {
          for (const t of RULES_TARGETS) expect(fit.checks[t].fits, `${text.slice(0, 20)} ${t}`).toBe(true);
        }
        if (fit.sizePx < 76) expect(layoutRulesAt(input, fit.sizePx + 2).clipped, text.slice(0, 20)).toBe(true);
      }
    }
  });

  it("fits a block that fills the interior exactly — overflow 0 is a fit", () => {
    // Padding that leaves the M15 box one 76 px line box of interior: 74 px.
    const exact = layoutRulesAt(m15("Flying", { padPx: { x: 4, y: (588 - 74) / 2 } }), 76);
    expect(exact.checks.hd.overflowPx).toBe(0);
    expect(exact.checks.hd.fits).toBe(true);
    // (Its 750 twin rounds that padding up and loses a px: that target
    // overflows, and the fit would step down for it.)
    expect(exact.checks.default.overflowPx).toBe(1);
  });

  it("reproduces the print references: EOE #30 at 60 px (2+3+4 lines; print 59.85), TLA #112 at 62 px", () => {
    const eoe = fitRulesLayout(m15(EOE_30, { padPx: PRINT_PAD, keepOuts: [PLATE_INK] }));
    expect(eoe.sizePx).toBe(60);
    expect(lineCounts(eoe.blocks)).toBe("2+3+4");
    expect(blockHeightPx(eoe, "hd")).toBe(579); // 9 × 59 + 2 × 24, in the 588 px box
    // (The first cut's 6 px top and bottom padding left a 576 px interior:
    // 3 px short, and EOE #30 one step small at 58.)
    expect(layoutRulesAt(m15(EOE_30, { padPx: { x: 4, y: 6 }, keepOuts: [PLATE_INK] }), 60).checks.hd.overflowPx).toBe(3);
    const tla = fitRulesLayout(m15(TLA_112, { padPx: PRINT_PAD, keepOuts: [PLATE_INK] }));
    expect(tla.sizePx).toBe(62);
    expect(lineCounts(tla.blocks)).toBe("4+5");
    // With today's 9 / 18 px margins both sit a step or two lower.
    expect(fitRulesLayout(m15(EOE_30, { keepOuts: [PLATE_INK] })).sizePx).toBe(56);
    expect(fitRulesLayout(m15(TLA_112, { keepOuts: [PLATE_INK] })).sizePx).toBe(58);
  });

  it("steps down until no line's ink enters a keep-out, at either target", () => {
    const text =
      "Whenever this creature attacks, each other creature you control gets +1/+1 until end of turn, and you gain 1 life for each creature you control with power 4 or greater.";
    const input = m15(text, { padPx: PRINT_PAD, vAlign: "end" });
    const free = fitRulesLayout(input);
    const kept = fitRulesLayout({ ...input, keepOuts: [PLATE_INK] });
    expect(free.sizePx).toBe(76);
    expect(layoutRulesAt({ ...input, keepOuts: [PLATE_INK] }, 76).checks.hd.keepOutHit).toBe(true);
    expect(kept.sizePx).toBe(74);
    expect(kept.clipped).toBe(false);
    for (const target of RULES_TARGETS) {
      const plate = rectPx(PLATE_INK, "portrait", PORTRAIT, target);
      for (const line of linePositions(kept, target).lines) {
        const overlaps =
          line.left + line.width > plate.left && line.left < plate.right && line.inkBottom > plate.top && line.inkTop < plate.bottom;
        expect(overlaps, target).toBe(false);
      }
    }
  });

  it("steps down past a run wider than the column", () => {
    // 23 m's and a period: ≈ 20.2 em of MPlantin, one unbreakable run — wider
    // than M15's column (1237 px at HD, 618 at 750) at the ceiling.
    const run = `${"m".repeat(23)}.`;
    const input = m15(`Draw ${run}`, { padPx: PRINT_PAD });
    expect(layoutRulesAt(input, 76).checks.hd.overwideRun).toBe(true);
    const fits = (s: number) => wordPx(run, s) <= 1237 && wordPx(run, s / 2) <= 618;
    const expected = EVEN_LADDER.find(fits)!;
    expect(expected).toBeLessThan(76);
    const fit = fitRulesLayout(input);
    expect(fit.sizePx).toBe(expected);
    expect(fit.clipped).toBe(false);
    expect(layoutRulesAt(input, expected + 2).clipped).toBe(true);
  });

  it("clips at the floor only when nothing fits — the box keeps overflow hidden", () => {
    const token = getFrameProfile("m15token");
    const long =
      "Whenever a creature you control deals combat damage to a player, create a 1/1 green Saproling creature token. ".repeat(11);
    const fit = fitRulesLayout({ rulesText: long, rect: token.rules.rect, aspect: PORTRAIT, sizePct: token.rules.sizePct, vAlign: "center" });
    expect(fit.sizePx).toBe(RULES_SIZE_PX.floor);
    expect(fit.clipped).toBe(true);
    expect(fit.checks.hd.overflowPx).toBeGreaterThan(0);
  });

  it("takes the slot's line height: a looser pitch fits a smaller size", () => {
    const tight = fitRulesLayout(m15(TLA_112, { padPx: PRINT_PAD }));
    const loose = fitRulesLayout(m15(TLA_112, { padPx: PRINT_PAD, lineHeight: 1.15 }));
    expect(loose.sizePx).toBeLessThan(tight.sizePx);
    expect(loose.lineHeight).toBe(1.15);
  });

  it("draws the same lines at every target: one set of breaks, the 750 font exactly half", () => {
    const fit = fitRulesLayout(m15(TLA_112, { padPx: PRINT_PAD, flavorText: "“Clues everywhere.”\n—An investigator" }));
    const hd = linePositions(fit, "hd");
    const half = linePositions(fit, "default");
    expect(half.lines.map((l) => [l.block, l.line])).toEqual(hd.lines.map((l) => [l.block, l.line]));
    expect(half.metrics.fontPx * 2).toBe(hd.metrics.fontPx);
    for (const l of half.lines) expect(l.width).toBeLessThanOrEqual(half.interior.width);
    for (const l of hd.lines) expect(l.width).toBeLessThanOrEqual(hd.interior.width);
  });

  it("measures a box's padding as a function of the size when its column depends on it", () => {
    const pad = (s: number) => ({ left: 3.4 * s, right: 20, top: 10, bottom: 10 });
    const fit = fitRulesLayout(m15(TLA_112, { padPx: pad }));
    const placed = linePositions(fit, "hd");
    expect(placed.interior.left).toBe(128 + Math.round(3.4 * fit.sizePx));
    expect(placed.interior.width).toBe(1245 - Math.round(3.4 * fit.sizePx) - 20);
    expect(fit.sizePx).toBeLessThan(fitRulesLayout(m15(TLA_112)).sizePx);
  });
});

describe("keep-outs", () => {
  it("lists only the stat badges the card draws, where each puts ink", () => {
    const m15pw = getFrameProfile("m15pw");
    const battle = getFrameProfile("battle");
    const hd = (r: Rect) => rectPx(r, "portrait", PORTRAIT, "hd");
    // The M15 plate's measured ink (lib/cards/plate-ink.ts): 1156.9 / 1864.8
    // px — the design's 1157.6 / 1864.8 within a px — inside the plate's box.
    const [pt] = statKeepOuts(M15, { pt: true });
    expect(pt.leftPct * 15).toBeCloseTo(1156.9, 0);
    expect(pt.topPct * 21).toBeCloseTo(1864.8, 0);
    const plate = M15.pt!.plateRect!;
    expect(hd(pt).right).toBeLessThanOrEqual(hd(plate).right);
    expect(hd(pt).bottom).toBeLessThanOrEqual(hd(plate).bottom);
    expect(statKeepOuts(M15, { pt: false })).toEqual([]);
    // The loyalty shield's body, inside its plate box.
    const [shield] = statKeepOuts(m15pw, { loyalty: true });
    expect(shield.leftPct).toBeGreaterThan(m15pw.loyalty!.plateRect!.leftPct);
    expect(shield.topPct).toBeGreaterThan(m15pw.loyalty!.plateRect!.topPct);
    // The battle's drawn defense disc, inset in its rect (STAT_BADGE_INSET).
    const [defense] = statKeepOuts(battle, { defense: true });
    const d = battle.defense!.rect;
    expect(defense.leftPct).toBeCloseTo(d.leftPct + d.widthPct * 0.12, 9);
    expect(defense.topPct).toBeCloseTo(d.topPct + d.heightPct * 0.08, 9);
    expect(defense.widthPct).toBeCloseTo(d.widthPct * 0.76, 9);
    // A value printed straight on the art (no plate, no badge): its rect.
    const avatar = getFrameProfile("avatar");
    expect(statKeepOuts(avatar, { pt: true })).toEqual([avatar.pt!.rect]);
    expect(statKeepOuts(battle, { pt: true, loyalty: true })).toEqual([]); // the battle frame has neither
  });

  it("turns a keep-out into a rotated box's own frame", () => {
    const box: Rect = { leftPct: 10, topPct: 40, widthPct: 80, heightPct: 20 };
    const k: Rect = { leftPct: 80, topPct: 55, widthPct: 10, heightPct: 5 };
    expect(keepOutInBoxFrame(k, box, 0, PORTRAIT)).toEqual(k);
    // Half a turn mirrors it through the box's centre: bottom-right → top-left.
    const half = keepOutInBoxFrame(k, box, 180, PORTRAIT);
    expect(half.leftPct).toBeCloseTo(10, 9);
    expect(half.topPct).toBeCloseTo(40, 9);
    expect(half.widthPct).toBeCloseTo(10, 9);
    expect(half.heightPct).toBeCloseTo(5, 9);
    // A quarter turn clockwise carries the box's top-middle to its right —
    // so a keep-out on the card right of the centre sits at the unturned
    // box's top, its width and height swapped in physical units.
    const c = { x: 50, y: 50 * PORTRAIT }; // the box centre, card-width units
    // 4 × 4 card-width units, centred 12 right of the box's centre.
    const right: Rect = { leftPct: 60, topPct: (c.y - 2) / PORTRAIT, widthPct: 4, heightPct: 4 / PORTRAIT };
    const quarter = keepOutInBoxFrame(right, box, 90, PORTRAIT);
    expect(quarter.leftPct + quarter.widthPct / 2).toBeCloseTo(c.x, 9);
    expect(((quarter.topPct + quarter.heightPct / 2) / 100) * 100 * PORTRAIT).toBeCloseTo(c.y - 12, 9);
    // Turning back undoes it.
    const back = keepOutInBoxFrame(quarter, box, -90, PORTRAIT);
    expect(back.leftPct).toBeCloseTo(right.leftPct, 9);
    expect(back.topPct).toBeCloseTo(right.topPct, 9);
  });
});
