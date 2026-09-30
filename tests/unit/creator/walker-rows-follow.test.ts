import { describe, expect, it } from "vitest";
import {
  TALL_WALKER_MIN_ROWS,
  followWalkerRows,
  framesForKind,
  hasRowDress,
  isRowDress,
  rowDressBaseFor,
  templateRefusesKind,
  walkerRowCount,
  walkerRowsFrameFits,
  walkerRowsFrameFor,
} from "@/lib/creator/card-kinds";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { resolvePublishedFrame } from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { CARD_KIND_VALUES } from "@/lib/creator/card-kinds";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.33: the borderless planeswalker's tall box follows the PRINTED
// ability rows — a loyalty ability is a row, a run of statics shares one —
// automatically, in every path (the creator, the pickers, the AI's frame
// pick, the import chooser; the registry's own rule is in
// tests/unit/scryfall/frame-signatures.test.ts). Checked against 16 prints.
// ---------------------------------------------------------------------------

const EVERY_COLOUR = ["w", "u", "b", "r", "g", "c", "m"];
const allOf = (...templates: string[]) =>
  new Set(templates.flatMap((t) => EVERY_COLOUR.map((k) => frameComboKey(t as FrameTemplate, k))));

const BASRI = "+1: Put a +1/+1 counter on up to one target creature.\n−2: Whenever one or more nontoken creatures attack this turn, create that many 1/1 white Soldier creature tokens.\n−6: You get an emblem.";
const TEFERI = "You may activate loyalty abilities of Teferi on any player's turn any time you could cast an instant.\n+1: Draw a card, then discard a card.\n−3: Target creature you don't control phases out.\n−10: Take two extra turns after this one.";
const EMPEROR = "Flash\nAs long as The Wandering Emperor entered this turn, you may activate her loyalty abilities any time you could cast an instant.\n+1: Put a +1/+1 counter on up to one target creature.\n−1: Create a 2/2 white Samurai creature token with vigilance.\n−2: Exile target tapped creature. You gain 2 life.";
const JACE_MIRROR = "Kicker {1}{U}\nWhen Jace, Mirror Mage enters, if Jace was kicked, create a token that's a copy of Jace.\n+1: Scry 2.\n0: Draw a card and reveal it.";
const ELSPETH_ESCAPE = "−1: Up to two target creatures you control each get +2/+1 until end of turn.\n−2: Create two 1/1 white Human Soldier creature tokens.\n−3: You gain 5 life.\nEscape—{4}{W}{W}, Exile four other cards from your graveyard.";

describe("the printed rows (walkerRowCount)", () => {
  it("counts a loyalty ability as a row and a run of statics as one, as the prints set them", () => {
    expect(walkerRowCount({ rulesText: BASRI })).toBe(3); // M21 #280, regular
    expect(walkerRowCount({ rulesText: TEFERI })).toBe(4); // M21 #281, tall
    expect(walkerRowCount({ rulesText: EMPEROR })).toBe(4); // NEO #303: Flash + a static share a row
    expect(walkerRowCount({ rulesText: JACE_MIRROR })).toBe(3); // ZNR #281: regular
    expect(walkerRowCount({ rulesText: ELSPETH_ESCAPE })).toBe(4); // THB #255: a static after the abilities
    expect(walkerRowCount({ rulesText: "" })).toBe(0);
    expect(walkerRowCount({ rulesText: null })).toBe(0);
  });

  it("reads the renderers' rows: the structured ones first, then the creator's row editor", () => {
    const faceContent = {
      v: 1 as const,
      loyalty: { abilities: [{ cost: "+1", text: "A" }, { cost: "-2", text: "B" }, { cost: "-3", text: "C" }, { cost: "-8", text: "D" }] },
    };
    expect(walkerRowCount({ faceContent, rulesText: BASRI })).toBe(4);
    expect(walkerRowCount({ editorRows: [{ cost: "", text: "Static" }, { cost: "", text: "Static 2" }, { cost: "+1", text: "A" }], rulesText: TEFERI })).toBe(2);
    // Empty editor rows don't count: the rules text decides.
    expect(walkerRowCount({ editorRows: [{ cost: "+1", text: "  " }], rulesText: TEFERI })).toBe(4);
  });
});

describe("the rows pick the box", () => {
  it("regular for three rows or fewer, tall for four or more — between the two borderless walkers only", () => {
    expect(TALL_WALKER_MIN_ROWS).toBe(4);
    for (const start of ["m15borderlesspw", "m15borderlesspwtall"] as FrameTemplate[]) {
      expect(walkerRowsFrameFor("planeswalker", start, 3)).toBe("m15borderlesspw");
      expect(walkerRowsFrameFor("planeswalker", start, 4)).toBe("m15borderlesspwtall");
      expect(walkerRowsFrameFor("planeswalker", start, 6)).toBe("m15borderlesspwtall");
    }
    for (const other of ["m15pw", "m15", "fullart", "m15borderless"] as FrameTemplate[]) {
      expect(walkerRowsFrameFor("planeswalker", other, 5)).toBe(other);
    }
    expect(walkerRowsFrameFor("creature", "m15borderlesspw", 5)).toBe("m15borderlesspw");
    expect(walkerRowsFrameFits("planeswalker", "m15borderlesspwtall", 3)).toBe(false);
    expect(walkerRowsFrameFits("planeswalker", "m15borderlesspw", 3)).toBe(true);
    expect(walkerRowsFrameFits("planeswalker", "m15pw", 9)).toBe(true);
  });

  it("the tall box is a row dress: no chip of its own, the Borderless Planeswalker chip stands for it", () => {
    expect(isRowDress("planeswalker", "m15borderlesspwtall")).toBe(true);
    expect(isRowDress("planeswalker", "m15borderlesspw")).toBe(false);
    expect(hasRowDress("planeswalker", "m15borderlesspw")).toBe(true);
    expect(hasRowDress("planeswalker", "m15pw")).toBe(false);
    expect(rowDressBaseFor("planeswalker", "m15borderlesspwtall")).toBe("m15borderlesspw");
    expect(rowDressBaseFor("planeswalker", "m15pw")).toBe("m15pw");
  });

  it("the creator follows the rows both ways, and leaves every other frame alone", () => {
    expect(followWalkerRows({ kind: "planeswalker", template: "m15borderlesspw", rows: 4 })).toBe("m15borderlesspwtall");
    expect(followWalkerRows({ kind: "planeswalker", template: "m15borderlesspwtall", rows: 3 })).toBe("m15borderlesspw");
    expect(followWalkerRows({ kind: "planeswalker", template: "m15borderlesspwtall", rows: 5 })).toBeNull();
    expect(followWalkerRows({ kind: "planeswalker", template: "m15pw", rows: 5 })).toBeNull();
  });

  it("dresses planeswalkers only: the server refuses the borderless walkers on every other kind", () => {
    for (const kind of CARD_KIND_VALUES) {
      for (const template of ["m15borderlesspw", "m15borderlesspwtall"] as FrameTemplate[]) {
        expect(templateRefusesKind(template, kind), `${template} ${kind}`).toBe(kind !== "planeswalker");
      }
    }
    const offered = framesForKind("planeswalker", allOf("m15pw", "m15borderlesspw", "m15borderlesspwtall"));
    expect(offered.filter((c) => c.group === "skin").map((c) => c.template)).toEqual(["m15borderlesspw", "m15borderlesspwtall"]);
    expect(framesForKind("creature", allOf("m15borderlesspw")).some((c) => c.template.startsWith("m15borderlesspw"))).toBe(false);
  });

  it("an unpublished tall box never stands in for another frame", () => {
    // m15pw isn't published in white here: the fallback is never the tall
    // box, whatever its colours.
    const keys = allOf("m15borderlesspwtall");
    const res = resolvePublishedFrame({
      kind: "planeswalker",
      candidates: ["m15pw"],
      colorKey: "w",
      verifiedKeys: keys,
      prefer: "frame",
    });
    expect(res.status === "frame-switched" ? res.template : null).not.toBe("m15borderlesspwtall");
  });
});

describe("the AI's frame pick takes the same rule", () => {
  const verified = allOf("m15pw", "m15borderlesspw", "m15borderlesspwtall");
  it("a request for either borderless walker lands on the one the rows pick", () => {
    for (const requested of ["m15borderlesspw", "m15borderlesspwtall"] as FrameTemplate[]) {
      expect(
        resolveGeneratedFrame({ cardType: "planeswalker", requested, colorIdentity: ["white"], verifiedKeys: verified, face: { cardType: "planeswalker", rulesText: TEFERI } }),
      ).toBe("m15borderlesspwtall");
      expect(
        resolveGeneratedFrame({ cardType: "planeswalker", requested, colorIdentity: ["white"], verifiedKeys: verified, face: { cardType: "planeswalker", rulesText: BASRI } }),
      ).toBe("m15borderlesspw");
    }
  });

  it("random never draws the box the rows don't pick", () => {
    for (let i = 0; i < 12; i += 1) {
      const pick = resolveGeneratedFrame({
        cardType: "planeswalker",
        requested: "random",
        colorIdentity: ["white"],
        verifiedKeys: verified,
        face: { cardType: "planeswalker", rulesText: BASRI },
        random: () => i / 12,
      });
      expect(pick).not.toBe("m15borderlesspwtall");
    }
  });
});
