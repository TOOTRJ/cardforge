import { describe, expect, it } from "vitest";
import { frameAnatomyOf, normalizeAnatomy } from "@/lib/cards/anatomy";
import { crownKeyFor } from "@/lib/cards/crown";
import { dfcBodyOf } from "@/lib/cards/dfc";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  NO_CROWN_COLOUR_REASON,
  NO_CROWN_REASON,
  NOT_LEGENDARY_LOCKED_REASON,
  legendaryVariationOf,
  withLegendaryWord,
  type LegendaryVariationInput,
} from "@/lib/creator/legendary-variation";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 3b.17 — the Variations section's "Legendary" entry, as rules (the
// chip: tests/unit/components/legendary-variation.test.tsx). It is the crown
// switch (`frame_style.crown`) and the word "Legendary", nothing else:
//   • OFFERED on every template whose PROFILES entry declares a crown (read
//     from the profiles, never a hand list), for a card type that prints
//     one, in a colour the crown is published in — disabled with a one-line
//     reason everywhere else;
//   • SELECTED only while the switch is exactly `true` AND a face has the
//     word (the crown is drawn);
//   • picking it on a card with no legendary face names the face that takes
//     the word; the word goes FIRST.
// ---------------------------------------------------------------------------

const input = (over: Partial<LegendaryVariationInput> = {}): LegendaryVariationInput => ({
  template: "m15",
  cardType: "creature",
  supertype: "",
  colorIdentity: ["white"],
  cost: "{2}{W}",
  crown: true,
  twoColor: true,
  ...over,
});

/** A card type each template can be judged with: the type its own kind
 *  saves, where that is a crownless one. */
function typeFor(template: FrameTemplate): string {
  const name = template as string;
  if (name.includes("token")) return "token";
  if (name === "emblem") return "emblem";
  if (name === "battle") return "battle";
  if (name.includes("pw") || name.includes("planeswalker")) return "planeswalker";
  if (name.includes("land")) return "land";
  return "creature";
}

describe("offered where the frame declares a crown — from the PROFILES data", () => {
  const fronts = FRAME_TEMPLATE_VALUES.filter((t) => dfcBodyOf(t)?.role !== "back");
  const crowned = fronts.filter((t) => frameAnatomyOf(t).crown);
  const crownless = fronts.filter((t) => !frameAnatomyOf(t).crown);

  it("the crowned templates are the ones this entry was specified for (and no crownless one sneaks in)", () => {
    // Named by the item's text: m15, m15artifact, m15land, the wave-2
    // treatments of 4.6f and the DFC bodies of 5.1d.
    for (const named of ["m15", "m15artifact", "m15land", "m15borderless", "m15borderlessartifact", "extendedart", "m15snow", "m15snowland", "m15dfcfront", "m15dfclandfront", "m15mdfcfront"]) {
      expect(crowned, named).toContain(named);
    }
    for (const named of ["m15pw", "saga", "m15token", "m20token", "emblem", "retro", "modern", "alpha", "m15devoid", "m15borderlessland", "battle", "split", "m15mdfclandfront"]) {
      if (!(FRAME_TEMPLATE_VALUES as readonly string[]).includes(named)) continue;
      expect(crownless, named).toContain(named);
    }
  });

  it.each(crowned)("%s: offered, for a legendary card of its type in white", (template) => {
    const state = legendaryVariationOf(input({ template, cardType: typeFor(template), supertype: "Legendary" }));
    expect(state).toMatchObject({ available: true, reason: null, selected: true, switchShown: true, addsWordTo: null });
  });

  it.each(crownless)("%s: disabled with the reason, whatever the switch and the word say", (template) => {
    const state = legendaryVariationOf(input({ template, cardType: typeFor(template), supertype: "Legendary", crown: true }));
    expect(state).toEqual({ available: false, reason: NO_CROWN_REASON, selected: false, switchShown: false, addsWordTo: null });
  });

  it.each(crowned)("%s: whatever is offered, the save keeps (normalizeAnatomy) and both renderers' rule draws (crownKeyFor)", (template) => {
    const cardType = typeFor(template);
    expect(normalizeAnatomy({ template, crown: true }, template, cardType)).toMatchObject({ crown: true });
    expect(
      crownKeyFor(
        { colorIdentity: ["white"], cost: "{2}{W}", cardType, supertype: "Legendary", frameStyle: { crown: true } },
        getFrameProfile(template),
      ),
    ).not.toBeNull();
  });

  it.each(crownless)("%s: the save would drop the switch — which is why it is not offered", (template) => {
    expect("crown" in normalizeAnatomy({ template, crown: true }, template, typeFor(template))).toBe(false);
  });
});

describe("the card type and the colour", () => {
  it.each(["planeswalker", "token", "battle", "emblem"])("a %s never prints the standard crown, even on a frame that draws one", (cardType) => {
    expect(legendaryVariationOf(input({ cardType, supertype: "Legendary" }))).toMatchObject({ available: false, reason: NO_CROWN_REASON });
  });

  it("every colour key of every crowned template is published — or the reason names the colour", () => {
    const colours: ColorIdentity[][] = [["white"], ["blue"], ["black"], ["red"], ["green"], ["multicolor"], ["colorless"], ["white", "blue"], ["white", "blue", "black"]];
    for (const template of FRAME_TEMPLATE_VALUES.filter((t) => frameAnatomyOf(t).crown && dfcBodyOf(t)?.role !== "back")) {
      for (const colorIdentity of colours) {
        const cardType = typeFor(template);
        const state = legendaryVariationOf(input({ template, cardType, colorIdentity, supertype: "Legendary" }));
        const drawn =
          crownKeyFor({ colorIdentity, cost: "{2}{W}", cardType, supertype: "Legendary", frameStyle: { crown: true, twoColor: true } }, getFrameProfile(template)) !== null;
        expect(state.available, `${template} ${colorIdentity.join("+")}`).toBe(drawn);
        if (!drawn) expect(state.reason).toBe(NO_CROWN_COLOUR_REASON);
      }
    }
  });
});

describe("selected = the switch is on AND the crown is drawn", () => {
  it("a new card that is not legendary: the switch is on (the new-card default) but the entry is not selected; picking adds the word to the front", () => {
    expect(legendaryVariationOf(input({ supertype: "", crown: true }))).toEqual({
      available: true,
      reason: null,
      selected: false,
      switchShown: false,
      addsWordTo: "front",
    });
  });

  it("a legendary card: selected with the switch on; off, absent (every card stored before the crown) and anything else are not", () => {
    expect(legendaryVariationOf(input({ supertype: "Legendary", crown: true })).selected).toBe(true);
    for (const crown of [false, undefined, null, "true", 1]) {
      const state = legendaryVariationOf(input({ supertype: "Legendary", crown }));
      expect(state, String(crown)).toMatchObject({ available: true, selected: false, switchShown: true, addsWordTo: null });
    }
  });

  it("the whole word only: \"Lengendary\" is not legendary", () => {
    expect(legendaryVariationOf(input({ supertype: "Lengendary Snow" }))).toMatchObject({ selected: false, addsWordTo: "front" });
    expect(legendaryVariationOf(input({ supertype: "legendary snow" }))).toMatchObject({ selected: true, addsWordTo: null });
  });
});

describe("an edit or a remix: the type line is locked", () => {
  it("a stored card that is not legendary: disabled with the reason — the word is never written there", () => {
    expect(legendaryVariationOf(input({ supertype: "Snow", crown: undefined, typeLineLocked: true }))).toEqual({
      available: false,
      reason: NOT_LEGENDARY_LOCKED_REASON,
      selected: false,
      switchShown: false,
      addsWordTo: null,
    });
  });

  it("a stored legendary card: offered, and reflects the stored switch", () => {
    expect(legendaryVariationOf(input({ supertype: "Legendary", crown: true, typeLineLocked: true }))).toMatchObject({ available: true, selected: true, addsWordTo: null });
    expect(legendaryVariationOf(input({ supertype: "Legendary", crown: undefined, typeLineLocked: true }))).toMatchObject({ available: true, selected: false, addsWordTo: null });
  });

  it("a frame with no crown keeps its own reason", () => {
    expect(legendaryVariationOf(input({ template: "saga", cardType: "enchantment", typeLineLocked: true })).reason).toBe(NO_CROWN_REASON);
  });
});

describe("a double-faced card: one switch, both faces", () => {
  const dfc = (over: Partial<LegendaryVariationInput> = {}) =>
    input({ template: "m15dfcfront", dfcIcon: "arrows", backCardType: "creature", backSupertype: "", ...over });

  it("neither face legendary: picking adds the word to the FRONT", () => {
    expect(dfc()).toBeDefined();
    expect(legendaryVariationOf(dfc())).toMatchObject({ available: true, selected: false, addsWordTo: "front" });
  });

  it("only the back legendary (MOM #43's shape): the crown is drawn there, so the entry is selected and writes no word", () => {
    expect(legendaryVariationOf(dfc({ backSupertype: "Legendary" }))).toMatchObject({
      available: true,
      selected: true,
      switchShown: true,
      addsWordTo: null,
    });
  });

  it("a back body that draws none never counts: a transform land back", () => {
    // The front (a creature on m15dfcfront) still can: the word goes there.
    expect(legendaryVariationOf(dfc({ backCardType: "land", backSupertype: "Legendary" }))).toMatchObject({
      available: true,
      selected: false,
      addsWordTo: "front",
    });
  });

  it("the modal land front draws no crown and the save drops its switch: not offered, whatever the back is", () => {
    const state = legendaryVariationOf(
      input({ template: "m15mdfclandfront", cardType: "land", backCardType: "creature", backSupertype: "Legendary" }),
    );
    expect(state).toMatchObject({ available: false, reason: NO_CROWN_REASON, switchShown: false });
  });
});

describe("the word goes first", () => {
  it.each([
    ["", "Legendary"],
    [null, "Legendary"],
    ["Artifact", "Legendary Artifact"],
    ["Snow  Artifact", "Legendary Snow Artifact"],
    ["Elite", "Legendary Elite"],
    ["Legendary Artifact", "Legendary Artifact"],
    ["snow legendary", "snow legendary"],
  ])("%j → %j", (before, after) => {
    expect(withLegendaryWord(before)).toBe(after);
  });
});
