import { describe, expect, it } from "vitest";
import {
  FRAME_ANATOMY_KEYS,
  NEW_CARD_ANATOMY,
  anatomyDefaults,
  applyFrameAnatomyPatch,
  frameAnatomyOf,
  importedAnatomy,
  importedFormAnatomy,
  newCardFrameStyle,
  normalizeAnatomy,
  storedAnatomyOf,
} from "@/lib/cards/anatomy";
import {
  adventureRulesLayout,
  mainRulesLayout,
  rulesAlignOf,
  rulesDraw,
  secondFaceRulesLayout,
  type DrawnStats,
} from "@/lib/cards/rules-box";
import {
  RULES_TARGETS,
  centredLineIndentPx,
  fitRulesLayout,
  linePositions,
  rectPx,
  type RulesLayout,
  type RulesLayoutInput,
} from "@/lib/cards/rules-layout";
import { getFrameProfile, profileOffersRulesAlign, type FrameProfile, type Rect } from "@/lib/cards/template-layout";
import { defaultValuesFor, remixValuesFrom } from "@/lib/creator/card-fields";
import { frameAnatomyPatchFor } from "@/lib/creator/revise";
import { frameAnatomyPatchSchema, frameStyleSchema } from "@/lib/validation/card";
import { FRAME_TEMPLATE_VALUES, type Card, type FrameStyle, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The card's TEXT ALIGNMENT (TODO 4.21e; owner 2026-10-07: a switch per card,
// on every kind of card, starting LEFT): FrameStyle.rulesAlign === "center"
// sets every line of the card's plain rules boxes centred on its box, as
// MH2 #123, TSR #156 / #161 / #186 and C16 #239 / #240 print a split half's
// short text (every line's centre on the paper's centre; the block centred
// vertically as ours already is). Absent = left = the layout as it was, to
// the byte. The ONE rules layout places each line (a whole-px indent at each
// target); both renderers only draw it.
// ---------------------------------------------------------------------------

const aspectOf = (p: FrameProfile) => (p.orientation === "landscape" ? 5 / 7 : 7 / 5);
const TWO_LINES = "Discard a card, then draw two cards.";
const MIXED =
  "Flying, vigilance\n{T}: Add {G}{G}. (This is a reminder that runs long enough to wrap over more than one line of the box.)\nWhenever this creature attacks, draw a card.";
const FLAVOR = "\"The light does not ask whether you are ready.\"\n—Serra";

type Family = { name: string; build: (text: string, flavor: string | null, rulesAlign?: unknown) => RulesLayout };
const box = (
  template: FrameTemplate,
  which: "main" | "adventure" | "second",
  show: DrawnStats = {},
): Family => ({
  name: `${template}/${which}`,
  build: (rulesText, flavorText, rulesAlign) => {
    const layout = getFrameProfile(template);
    const input = { layout, rulesText, flavorText, aspect: aspectOf(layout), show, rulesAlign };
    const out = which === "main" ? mainRulesLayout(input) : which === "adventure" ? adventureRulesLayout(input) : secondFaceRulesLayout(input);
    if (!out) throw new Error(`${template} has no ${which} box`);
    return out;
  },
});

/** One rules box per family the switch reaches. */
const FAMILIES: Family[] = [
  box("m15", "main", { pt: true }),
  box("m15land", "main"),
  box("retro", "main", { pt: true }),
  box("m15borderless", "main", { pt: true }),
  box("split", "main"),
  box("split", "second"),
  box("aftermath", "main"),
  box("aftermath", "second"),
  box("flip", "main", { pt: true }),
  box("flip", "second", { secondFacePt: true }),
  box("adventure", "main", { pt: true }),
  box("adventure", "adventure", { pt: true }),
  box("battle", "main", { defense: true }),
  box("emblem", "main"),
  box("m15tokentext", "main", { pt: true }),
  box("m20tokentall", "main", { pt: true }),
  box("m15dfcfront", "main", { pt: true }),
  box("m15dfcback", "main", { pt: true }),
  box("m15mdfcfront", "main", { pt: true }),
];

/** The middle of a box less its padding, from the placement. */
function boxCentre(layout: RulesLayout, target: (typeof RULES_TARGETS)[number]): number {
  const placed = linePositions(layout, target);
  const side = layout.sideInsets[target];
  const left = placed.interior.left - side.left;
  const right = placed.interior.left + placed.interior.width + side.right;
  return (left + right) / 2;
}

describe("which frames offer the choice (profileOffersRulesAlign)", () => {
  it("every frame with plain rules boxes — never the saga's rows, a walker frame's rows or a textless frame", () => {
    const without = FRAME_TEMPLATE_VALUES.filter((t) => !profileOffersRulesAlign(getFrameProfile(t)));
    for (const t of without) {
      const p = getFrameProfile(t);
      expect(Boolean(p.chapters || p.loyaltyRows || p.textless), t).toBe(true);
    }
    expect(without).toEqual(expect.arrayContaining(["saga", "m15pw", "m15borderlesspw", "m15borderlesspwtall", "m20token", "m20tokenartifact"]));
    for (const t of ["m15", "m15land", "split", "aftermath", "flip", "adventure", "battle", "emblem", "m15token", "m15tokentext", "m15dfcfront", "m15dfcback", "m15mdfcfront", "retro", "alpha"] as FrameTemplate[]) {
      expect(profileOffersRulesAlign(getFrameProfile(t)), t).toBe(true);
    }
    // No profile opts out today; the opt-out is read.
    expect(FRAME_TEMPLATE_VALUES.filter((t) => getFrameProfile(t).rulesAlignSwitch === false)).toEqual([]);
    expect(profileOffersRulesAlign({ ...getFrameProfile("m15"), rulesAlignSwitch: false })).toBe(false);
    for (const t of FRAME_TEMPLATE_VALUES) expect(frameAnatomyOf(t).rulesAlign, t).toBe(profileOffersRulesAlign(getFrameProfile(t)));
  });

  it("names every frame WITHOUT the choice — a new template is offered it by default, so adding one stops here", () => {
    // The capability is ON unless the profile says otherwise
    // (profileOffersRulesAlign). That is safe to DRAW — only the plain rules
    // boxes read it (lib/cards/rules-box.ts fitSlot), never a row editor —
    // but a frame that sets its text in rows beside badges (a class, a
    // leveler, a prototype…) must not show a control that does nothing or
    // centre text against its badges. Adding a template changes this count:
    // decide then — `rulesAlignSwitch: false`, or one more frame with it.
    const without = FRAME_TEMPLATE_VALUES.filter((t) => !profileOffersRulesAlign(getFrameProfile(t)));
    expect(without).toEqual(["m15pw", "m20token", "m20tokenartifact", "m15borderlesspw", "m15borderlesspwtall", "saga"]);
    expect(FRAME_TEMPLATE_VALUES.length - without.length).toBe(54);
  });

  it("rulesAlignOf is \"center\" only for the card's \"center\" on a frame that offers it", () => {
    const m15 = getFrameProfile("m15");
    expect(rulesAlignOf(m15, "center")).toBe("center");
    for (const value of [undefined, null, "left", "centre", true, "right"]) expect(rulesAlignOf(m15, value)).toBeUndefined();
    for (const t of ["saga", "m15pw", "m20token"] as FrameTemplate[]) expect(rulesAlignOf(getFrameProfile(t), "center"), t).toBeUndefined();
  });

  it("a walker drawn in the plain box and a non-walker on the walker frame stay left whatever the card says", () => {
    const pw = getFrameProfile("m15pw");
    for (const show of [{ loyalty: true }, { pt: true }]) {
      const layout = mainRulesLayout({ layout: pw, rulesText: TWO_LINES, aspect: 7 / 5, show, rulesAlign: "center" });
      expect("align" in layout.input).toBe(false);
      expect(linePositions(layout, "hd").lines.every((l) => l.indent === 0)).toBe(true);
    }
  });
});

describe("left is the layout as it was", () => {
  it.each(FAMILIES)("$name: an absent key, \"left\" and any other value give the SAME layout, with no `align`", ({ build }) => {
    const absent = build(MIXED, FLAVOR);
    expect("align" in absent.input).toBe(false);
    for (const value of ["left", null, "centre", false]) expect(build(MIXED, FLAVOR, value)).toEqual(absent);
    for (const target of RULES_TARGETS) {
      // Only a text-box token's single line is ever indented (4.49 (b)).
      for (const l of linePositions(absent, target).lines) expect(l.indent).toBe(0);
    }
  });

  it("the token's automatic ONE centred line stays as it is with the switch left", () => {
    const token = box("m15tokentext", "main", { pt: true });
    const one = token.build("Vigilance", null);
    expect(linePositions(one, "hd").lines[0].indent).toBeGreaterThan(400);
    expect(token.build("Vigilance", null, "left")).toEqual(one);
  });
});

describe("centred: every line on the box's centre, nothing else moved", () => {
  const TEXTS: [string, string | null, string | null][] = [
    ["two lines", TWO_LINES, null],
    ["one line", "Destroy all lands.", null],
    ["pips, reminder and paragraphs", MIXED, null],
    ["rules + flavor", "Flying, vigilance", FLAVOR],
    ["flavor only", null, "A coil of fire, bound by oath and left to smoulder under the mountain."],
  ];
  for (const family of FAMILIES) {
    it.each(TEXTS)(`${family.name} · %s`, (_name, rules, flavor) => {
      const text = rules ?? "";
      // The adventure page and a second face take rules text only.
      if (!rules && family.name !== `${family.name.split("/")[0]}/main`) return;
      const left = family.build(text, flavor);
      const centred = family.build(text, flavor, "center");
      expect(centred.input.align).toBe("center");
      // Same size, same lines, same verdict: the lines only move sideways —
      // unless a keep-out the left text cleared is met where a line lands
      // (then the fit steps down, as for any keep-out).
      if (centred.sizePx !== left.sizePx) {
        expect((left.input.keepOuts ?? []).length + (left.input.floats ?? []).length, "a size step needs a keep-out").toBeGreaterThan(0);
        expect(centred.sizePx).toBeLessThan(left.sizePx);
        return;
      }
      expect(centred.blocks).toEqual(left.blocks);
      expect(centred.clipped).toBe(left.clipped);
      expect(centred.sideInsets).toEqual(left.sideInsets);
      for (const target of RULES_TARGETS) {
        const a = linePositions(left, target);
        const b = linePositions(centred, target);
        expect(b.interior).toEqual(a.interior);
        expect(b.bar).toEqual(a.bar);
        expect(b.lines.map((l) => [l.top, l.height, l.width, l.inkTop, l.inkBottom])).toEqual(a.lines.map((l) => [l.top, l.height, l.width, l.inkTop, l.inkBottom]));
        const centre = boxCentre(centred, target);
        const floats = (centred.input.floats ?? []).length > 0;
        let moved = 0;
        for (const l of b.lines) {
          expect(Number.isInteger(l.indent), "a whole px").toBe(true);
          expect(l.indent).toBeGreaterThanOrEqual(0);
          expect(l.left).toBe(b.interior.left + l.indent);
          // Inside the column.
          expect(l.left + l.width).toBeLessThanOrEqual(b.interior.left + b.interior.width);
          const room = b.interior.width - l.width;
          const off = Math.abs(l.left + l.width / 2 - centre);
          // On the box's centre to the half px — unless the line fills the
          // column to within the side headroom (it can't move further) or a
          // float holds it back.
          if (!floats && room > 2 * (layoutSide(centred, target) + 1)) expect(off, `${target}: line centre`).toBeLessThanOrEqual(0.5);
          if (l.indent > 0) moved += 1;
        }
        if (b.lines.some((l) => b.interior.width - l.width > 4)) expect(moved).toBeGreaterThan(0);
        // What the renderers draw: the layout's px, line by line.
        const drawn = rulesDraw(centred, target).blocks.flatMap((blk) => (blk.kind === "blank" ? [] : blk.indents));
        expect(drawn).toEqual(b.lines.map((l) => l.indent));
      }
    });
  }

  it("centres reminder and flavor lines with the rules lines (one block)", () => {
    const layout = box("m15", "main").build("Flying (This creature can’t be blocked except by creatures with flying or reach.)", "Up.", "center");
    const placed = linePositions(layout, "hd");
    expect(new Set(placed.lines.map((l) => l.block)).size).toBe(2);
    const centre = boxCentre(layout, "hd");
    for (const l of placed.lines) expect(Math.abs(l.left + l.width / 2 - centre)).toBeLessThanOrEqual(0.5);
    // The flavor bar still spans the column.
    expect(placed.bar).toEqual({ top: placed.bar!.top, left: placed.interior.left, width: placed.interior.width });
  });

  it("centres on the BOX, not on the column the side headroom leaves", () => {
    // An italic line's last glyph reserves headroom on the right only (12
    // px at HD here): the column's own middle would sit 6 px off the
    // paper's centre.
    const layout = box("split", "main").build("Draw a card.", "\"f\" for fire, for the fury of it.", "center");
    expect(layout.sideInsets.hd.left).not.toBe(layout.sideInsets.hd.right);
    for (const target of RULES_TARGETS) {
      const placed = linePositions(layout, target);
      const box0 = placed.box;
      // (A line that fills the column to within the headroom can't reach
      // the centre: it stops at the column's end.)
      const free = placed.lines.filter((l) => placed.interior.width - l.width > 24);
      expect(free.length).toBeGreaterThanOrEqual(2);
      for (const l of free) expect(Math.abs(l.left + l.width / 2 - (box0.left + box0.width / 2)), target).toBeLessThanOrEqual(0.5);
    }
  });

  it("centredLineIndentPx: the nearest whole px, held inside the column", () => {
    expect(centredLineIndentPx(780, 300, 390)).toBe(240);
    expect(centredLineIndentPx(780, 301, 390)).toBe(240); // 239.5 rounds up
    expect(centredLineIndentPx(780, 780, 390)).toBe(0);
    expect(centredLineIndentPx(780, 800, 390)).toBe(0);
    // A centre left of the column's (headroom on the left): never negative.
    expect(centredLineIndentPx(780, 776, 386)).toBe(0);
    // …or right of it: never past the column's end.
    expect(centredLineIndentPx(780, 776, 394)).toBe(4);
    expect(centredLineIndentPx(778, 776, 394)).toBe(2);
  });
});

function layoutSide(layout: RulesLayout, target: (typeof RULES_TARGETS)[number]): number {
  const s = layout.sideInsets[target];
  return Math.max(s.left, s.right);
}

describe("keep-outs and floats are judged where each centred line lands", () => {
  const rect: Rect = getFrameProfile("m15").rules.rect;
  const base: RulesLayoutInput = { rulesText: "Vigilance\nFlying", rect, aspect: 7 / 5, sizePct: getFrameProfile("m15").rules.sizePct, padPx: { x: 4, y: 0 } };

  it("a keep-out in the middle of the box: clear when left, met when centred (the fit steps down or clips)", () => {
    const middle: Rect = { leftPct: rect.leftPct + rect.widthPct / 2 - 1, widthPct: 2, topPct: rect.topPct, heightPct: rect.heightPct };
    const left = fitRulesLayout({ ...base, keepOuts: [middle] });
    expect(left.clipped).toBe(false);
    expect(left.checks.hd.keepOutHit).toBe(false);
    const centred = fitRulesLayout({ ...base, keepOuts: [middle], align: "center" });
    expect(centred.clipped).toBe(true);
    expect(centred.checks.hd.keepOutHit).toBe(true);
  });

  it("a keep-out at the box's left: met when left, clear when centred", () => {
    const leftEdge: Rect = { leftPct: rect.leftPct, widthPct: 4, topPct: rect.topPct, heightPct: rect.heightPct };
    expect(fitRulesLayout({ ...base, keepOuts: [leftEdge] }).checks.hd.keepOutHit).toBe(true);
    const centred = fitRulesLayout({ ...base, keepOuts: [leftEdge], align: "center" });
    expect(centred.clipped).toBe(false);
  });

  it("a centred line on a float's rows is centred on the box but never past the float", () => {
    // A float over the right 40 % of the box's first rows.
    const float: Rect = { leftPct: rect.leftPct + rect.widthPct * 0.6, widthPct: rect.widthPct * 0.4, topPct: rect.topPct, heightPct: 4 };
    const text = "Whenever this creature attacks, draw a card and gain 1 life. Then scry 2 and put a counter on it.";
    const left = fitRulesLayout({ ...base, rulesText: text, floats: [float] });
    const centred = fitRulesLayout({ ...base, rulesText: text, floats: [float], align: "center" });
    expect(centred.clipped).toBe(false);
    // The same breaks: the float narrows the same lines' columns.
    expect(centred.blocks).toEqual(left.blocks);
    for (const target of RULES_TARGETS) {
      const placed = linePositions(centred, target);
      const f = { left: Math.round(((rect.leftPct + rect.widthPct * 0.6) / 100) * (target === "hd" ? 1500 : 750)) };
      const first = placed.lines[0];
      expect(first.left + first.width).toBeLessThanOrEqual(f.left);
      // A line below the float is on the box's centre.
      const last = placed.lines[placed.lines.length - 1];
      expect(Math.abs(last.left + last.width / 2 - boxCentre(centred, target))).toBeLessThanOrEqual(0.5);
    }
  });

  it("a centred line held back by a float keeps its INK out of it: the last glyph's overhang is part of the line there", () => {
    // Every line ends in a regular "r", whose ink reaches past its advance.
    // A line the float holds back is set flush against it, so the advance
    // box alone would leave that ink inside the float — a keep-out hit at
    // every size (skeptic pass 2026-10-07: 14 of 102 fuzzed reverse-P/T
    // texts stepped down for it, up to five steps).
    const float: Rect = { leftPct: rect.leftPct + rect.widthPct * 0.6, widthPct: rect.widthPct * 0.4, topPct: rect.topPct, heightPct: 12 };
    const text = "her offer for her other offer for her offer for her other offer for her offer for her other offer for her";
    const left = fitRulesLayout({ ...base, rulesText: text, floats: [float], vAlign: "start" });
    const centred = fitRulesLayout({ ...base, rulesText: text, floats: [float], vAlign: "start", align: "center" });
    expect(left.clipped).toBe(false);
    expect(centred.clipped).toBe(false);
    expect(centred.sizePx).toBe(left.sizePx);
    expect(centred.blocks).toEqual(left.blocks);
    for (const target of RULES_TARGETS) {
      const placed = linePositions(centred, target);
      const f = rectPx(float, "portrait", 7 / 5, target);
      const held = placed.lines.filter((l) => l.top < f.bottom && l.top + l.height > f.top);
      expect(held.length, target).toBeGreaterThan(1);
      for (const l of held) {
        expect(l.inkRight, target).toBeGreaterThan(l.left + l.width);
        expect(l.inkRight, target).toBeLessThanOrEqual(f.left);
      }
      // …and at least one of them is held back (not on the box's centre).
      expect(held.some((l) => l.left + l.width / 2 < boxCentre(centred, target) - 1), target).toBe(true);
    }
  });

  it("the transform front's reverse P/T: the centred text still fits beside the digits", () => {
    const profile = getFrameProfile("m15dfcfront");
    const digits: Rect = { leftPct: 84, widthPct: 8, topPct: 87, heightPct: 3 };
    const show: DrawnStats = { pt: true, reversePt: digits };
    const text = "Whenever this creature attacks, draw a card and gain 1 life. Then scry 2. At the beginning of your end step, transform it if you control four or more lands and it attacked this turn.";
    const left = mainRulesLayout({ layout: profile, rulesText: text, aspect: 7 / 5, show });
    const centred = mainRulesLayout({ layout: profile, rulesText: text, aspect: 7 / 5, show, rulesAlign: "center" });
    expect(left.clipped).toBe(false);
    expect(centred.clipped).toBe(false);
    expect(centred.input.floats).toHaveLength(1);
  });
});

describe("the switch as card data (FrameStyle.rulesAlign)", () => {
  it("is an anatomy key no default ever stamps: a new card starts left", () => {
    expect(FRAME_ANATOMY_KEYS).toContain("rulesAlign");
    expect("rulesAlign" in NEW_CARD_ANATOMY).toBe(false);
    for (const t of FRAME_TEMPLATE_VALUES) expect("rulesAlign" in anatomyDefaults(t), t).toBe(false);
    for (const t of ["m15", "split"] as FrameTemplate[]) {
      expect("rulesAlign" in newCardFrameStyle({ template: t }, "instant")).toBe(false);
    }
    expect("rulesAlign" in defaultValuesFor(undefined, [], {}).frame_style).toBe(false);
  });

  it("the save keeps \"center\" where the frame offers the choice, and stores nothing else", () => {
    for (const t of ["m15", "split", "adventure", "battle", "m15tokentext", "m15dfcfront"] as FrameTemplate[]) {
      expect(normalizeAnatomy({ template: t, rulesAlign: "center" } as FrameStyle, t, "instant").rulesAlign, t).toBe("center");
      expect(newCardFrameStyle({ template: t, rulesAlign: "center" } as FrameStyle, "instant").rulesAlign, t).toBe("center");
      // The form's "left" is never stored: absent is left.
      expect("rulesAlign" in normalizeAnatomy({ template: t, rulesAlign: "left" } as FrameStyle, t, "instant"), t).toBe(false);
    }
    for (const t of ["saga", "m15pw", "m20token"] as FrameTemplate[]) {
      expect("rulesAlign" in normalizeAnatomy({ template: t, rulesAlign: "center" } as FrameStyle, t, "enchantment"), t).toBe(false);
    }
    // A stray value never survives.
    expect("rulesAlign" in normalizeAnatomy({ template: "m15", rulesAlign: "right" } as unknown as FrameStyle, "m15", "instant")).toBe(false);
    // Nothing to drop → the input itself.
    const kept = { template: "split", rulesAlign: "center" } as FrameStyle;
    expect(normalizeAnatomy(kept, "split", "instant")).toBe(kept);
  });

  it("storedAnatomyOf reads \"center\" only; a remix keeps its parent's, an import stays left", () => {
    expect(storedAnatomyOf({ rulesAlign: "center" })).toEqual({ rulesAlign: "center" });
    expect(storedAnatomyOf({ rulesAlign: "left" })).toEqual({});
    expect(storedAnatomyOf({ rulesAlign: true })).toEqual({});
    const parent = { title: "Fast", slug: "fast", color_identity: ["red"], subtypes: [], tags: [], frame_style: { template: "split", rulesAlign: "center" } } as unknown as Card;
    expect(remixValuesFrom(parent, [], {}).frame_style.rulesAlign).toBe("center");
    expect(defaultValuesFor(parent, [], {}).frame_style.rulesAlign).toBe("center");
    const imported = importedAnatomy({ printed_crown: true, printed_collector: "2015" }, "split");
    expect("rulesAlign" in imported.style).toBe(false);
    // The creator clears every anatomy key the import names none for.
    expect(importedFormAnatomy(imported.style)).not.toHaveProperty("rulesAlign");
  });

  it("an edit's patch sets \"center\" and takes it off again; every other key as stored", () => {
    const stored = { frameStyle: { template: "split", finish: "foil" }, colorIdentity: ["red"] as const, cardType: "instant" };
    const on = applyFrameAnatomyPatch(stored, { rulesAlign: "center" });
    expect(on).toEqual({ ok: true, frameStyle: { template: "split", finish: "foil", rulesAlign: "center" }, colorIdentity: null });
    const off = applyFrameAnatomyPatch({ ...stored, frameStyle: { ...stored.frameStyle, rulesAlign: "center" } }, { rulesAlign: "left" });
    expect(off).toEqual({ ok: true, frameStyle: stored.frameStyle, colorIdentity: null });
    // On a frame without the choice the patch stores nothing.
    const saga = applyFrameAnatomyPatch({ frameStyle: { template: "saga" }, colorIdentity: ["red"], cardType: "enchantment" }, { rulesAlign: "center" });
    expect(saga).toEqual({ ok: true, frameStyle: { template: "saga" }, colorIdentity: null });
  });

  it("frameAnatomyPatchFor sends the alignment only when it changed", () => {
    const card = (frame_style: Record<string, unknown>) => ({ frame_style, color_identity: ["red"] as const });
    const values = (rulesAlign?: "left" | "center") => ({ frame_style: { template: "split", ...(rulesAlign ? { rulesAlign } : {}) } as FrameStyle, color_identity: ["red"] as ["red"] });
    expect(frameAnatomyPatchFor(card({ template: "split" }), values())).toBeUndefined();
    expect(frameAnatomyPatchFor(card({ template: "split" }), values("left"))).toBeUndefined();
    expect(frameAnatomyPatchFor(card({ template: "split" }), values("center"))).toEqual({ rulesAlign: "center" });
    expect(frameAnatomyPatchFor(card({ template: "split", rulesAlign: "center" }), values("center"))).toBeUndefined();
    expect(frameAnatomyPatchFor(card({ template: "split", rulesAlign: "center" }), values("left"))).toEqual({ rulesAlign: "left" });
    expect(frameAnatomyPatchFor(card({ template: "split", rulesAlign: "center" }), values())).toEqual({ rulesAlign: "left" });
  });

  it("the shared schemas take \"left\" and \"center\" and refuse anything else", () => {
    for (const value of ["left", "center"]) {
      expect(frameAnatomyPatchSchema.safeParse({ rulesAlign: value }).success, value).toBe(true);
      expect(frameStyleSchema.safeParse({ template: "split", rulesAlign: value }).success, value).toBe(true);
    }
    for (const value of ["right", "centre", true, 1, null]) {
      expect(frameAnatomyPatchSchema.safeParse({ rulesAlign: value }).success, String(value)).toBe(false);
      expect(frameStyleSchema.safeParse({ template: "split", rulesAlign: value }).success, String(value)).toBe(false);
    }
  });
});
