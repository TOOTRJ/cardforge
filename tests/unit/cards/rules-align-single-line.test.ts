import { describe, expect, it } from "vitest";
import { mainRulesLayout, rulesDraw } from "@/lib/cards/rules-box";
import {
  RULES_TARGETS,
  fitRulesLayout,
  isSingleRulesLine,
  layoutRulesAt,
  linePositions,
  singleLineIndentPx,
  type RulesLayoutInput,
} from "@/lib/cards/rules-layout";
import { getFrameProfile, type Rect } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TextSlot.alignSingleLine (TODO 4.49 (b)): the 2014–19 text-box token prints
// ONE line of rules text centred in its box ("Vigilance" TDOM #2, "Flying,
// vigilance" TM19 #1, "This creature is all colors." TWAR #16) and two or
// more lines from the box's left (TWAR #6, TM19 #9, TXLN #7). The layout
// places the line — a whole-px indent at each target — so both renderers draw
// it where the fit judged it (keep-outs included); 4.48 and 4.52 reuse it.
// ---------------------------------------------------------------------------

const PORTRAIT = 7 / 5;
const TOKEN_TEXT = getFrameProfile("m15tokentext");
const layoutOf = (template: string, rulesText: string | null, flavorText: string | null = null, pt = true) =>
  mainRulesLayout({ layout: getFrameProfile(template), rulesText, flavorText, aspect: PORTRAIT, show: { pt } });

describe("which profiles centre a single line", () => {
  it("only the token frames' and the emblem's rules slot sets alignSingleLine (no other box, no other slot)", () => {
    const centring = FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).rules.alignSingleLine);
    // The 2014–19 text-box tokens (4.49 (b)), 4.52's emblem (TDSK #17 /
    // TFRA #16 centre their one line) and the full-art tokens (4.48, every
    // height: the textless one's slot is never drawn).
    expect(centring).toEqual([
      "m15tokentext", "m15tokenartifacttext",
      "emblem",
      "m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall",
    ]);
    for (const t of centring) expect(getFrameProfile(t).rules.alignSingleLine).toBe("center");
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(t);
      for (const slot of [p.title, p.type, p.footer, p.adventure?.rules, p.secondFace?.rules]) {
        expect(slot?.alignSingleLine, t).toBeUndefined();
      }
    }
  });

  it("hands the layout the slot's alignSingleLine, and nothing to a box without one", () => {
    expect(layoutOf("m15tokentext", "Vigilance").input.alignSingleLine).toBe("center");
    expect("alignSingleLine" in layoutOf("m15token", "Vigilance").input).toBe(false);
    expect("alignSingleLine" in layoutOf("m15", "Vigilance").input).toBe(false);
  });
});

describe("isSingleRulesLine / singleLineIndentPx", () => {
  it("is one rules block of one line — no flavor, no blank line, no second paragraph", () => {
    expect(isSingleRulesLine(layoutOf("m15tokentext", "Vigilance").blocks)).toBe(true);
    expect(isSingleRulesLine(layoutOf("m15tokentext", "Flying\nVigilance").blocks)).toBe(false);
    expect(isSingleRulesLine(layoutOf("m15tokentext", "Flying", "Up.").blocks)).toBe(false);
    expect(isSingleRulesLine(layoutOf("m15tokentext", null, "Up.").blocks)).toBe(false);
    expect(isSingleRulesLine(layoutOf("m15tokentext", null).blocks)).toBe(false);
  });

  it("indents by half the room left, floored to the whole px, never below 0", () => {
    expect(singleLineIndentPx(1000, 300)).toBe(350);
    expect(singleLineIndentPx(1000, 301)).toBe(349);
    expect(singleLineIndentPx(300, 301)).toBe(0);
  });
});

describe("a centred single line (m15tokentext)", () => {
  it.each(["Vigilance", "Flying, vigilance", "This creature is all colors.", "Sacrifice this creature: Add {C}."])(
    "%s: centred in the box's interior at both targets, whole px",
    (text) => {
      const layout = layoutOf("m15tokentext", text);
      expect(layout.clipped).toBe(false);
      for (const target of RULES_TARGETS) {
        const placed = linePositions(layout, target);
        expect(placed.lines).toHaveLength(1);
        const [line] = placed.lines;
        const indent = singleLineIndentPx(placed.interior.width, line.width);
        expect(indent, target).toBeGreaterThan(0);
        expect(line.indent).toBe(indent);
        expect(Number.isInteger(line.indent)).toBe(true);
        expect(line.left).toBe(placed.interior.left + indent);
        // Its centre within a px of the column's.
        const centre = line.left + line.width / 2;
        expect(Math.abs(centre - (placed.interior.left + placed.interior.width / 2)), target).toBeLessThanOrEqual(1);
        // The ink reach moves with it.
        expect(line.inkLeft).toBeGreaterThan(placed.interior.left);
        expect(line.inkRight).toBeLessThan(placed.interior.left + placed.interior.width);
        // What the renderers draw: the same px as the line's margin.
        const d = rulesDraw(layout, target);
        expect(d.blocks[0].kind === "blank" ? null : d.blocks[0].indents).toEqual([indent]);
      }
    },
  );

  it("leaves two or more lines, and a line with flavor, at the left", () => {
    const five = layoutOf(
      "m15tokentext",
      "Flying\nVigilance\nLifelink\nWhenever this creature attacks, create a 1/1 white Soldier creature token.\nThis creature can't block.",
    );
    const lines = linePositions(five, "hd").lines;
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const l of lines) expect(l.indent).toBe(0);
    for (const target of RULES_TARGETS) {
      for (const b of rulesDraw(five, target).blocks) if (b.kind !== "blank") expect(b.indents.every((i) => i === 0)).toBe(true);
    }
    const withFlavor = linePositions(layoutOf("m15tokentext", "Flying", "Up."), "hd").lines;
    expect(withFlavor.map((l) => l.indent)).toEqual([0, 0]);
  });

  it("leaves a single line at the left on every box without it (m15token, M15)", () => {
    for (const template of ["m15token", "m15", "m15tokenartifact"]) {
      const layout = layoutOf(template, "Vigilance");
      for (const target of RULES_TARGETS) {
        const [line] = linePositions(layout, target).lines;
        expect(line.indent, template).toBe(0);
        const b = rulesDraw(layout, target).blocks[0];
        expect(b.kind === "blank" ? null : b.indents, template).toEqual([0]);
      }
    }
  });

  it("judges the keep-outs where the centred line lands", () => {
    // A keep-out in the middle of the box, on the line's row: the left-set
    // line clears it at the ceiling; centred, the same line runs into it and
    // the fit steps down (and past the floor, clips).
    const rect: Rect = TOKEN_TEXT.rules.rect;
    const middle: Rect = {
      leftPct: rect.leftPct + rect.widthPct / 2 - 1,
      widthPct: 2,
      topPct: rect.topPct,
      heightPct: rect.heightPct,
    };
    const input: RulesLayoutInput = {
      rulesText: "Vigilance",
      rect,
      aspect: PORTRAIT,
      sizePct: TOKEN_TEXT.rules.sizePct,
      padPx: TOKEN_TEXT.rules.padPx,
      vAlign: "center",
      keepOuts: [middle],
    };
    const left = fitRulesLayout(input);
    expect(left.clipped).toBe(false);
    expect(left.sizePx).toBe(76);
    const centred = layoutRulesAt({ ...input, alignSingleLine: "center" }, 76);
    expect(centred.checks.hd.keepOutHit).toBe(true);
    expect(centred.clipped).toBe(true);
    expect(fitRulesLayout({ ...input, alignSingleLine: "center" }).sizePx).toBeLessThan(76);
  });
});
