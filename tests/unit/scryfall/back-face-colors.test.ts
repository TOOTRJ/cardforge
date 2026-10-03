import { describe, expect, it } from "vitest";
import type { ScryfallCard } from "@/lib/scryfall/client";
import { backFaceColors, frameColorsFromScryfall, referenceBackColorIdentity } from "@/lib/scryfall/import-mapper";
import { aang, agadeem, archangelAvacyn, beanstalkGiant, serraAngel, tergrid, valki } from "./fixtures/dfc-printings";

// ---------------------------------------------------------------------------
// The BACK face's frame colour (TODO 5.0b; lib/scryfall/import-mapper.ts
// backFaceColors / referenceBackColorIdentity): frontFaceColors' rule read
// on `card_faces[1]` — printed colours + indicator, a colourless back stays
// colourless, a LAND back is dressed by its own mana symbols and basic land
// types; never the card-level fields, which cover both faces. What the
// compare view draws a back body in and a back body's pin is checked
// against; the import stores it from 5.4.
// ---------------------------------------------------------------------------

function withBack(card: ScryfallCard, back: Record<string, unknown>): ScryfallCard {
  return { ...card, card_faces: [card.card_faces![0], { ...card.card_faces![1], ...back }] } as ScryfallCard;
}

describe("backFaceColors", () => {
  it("reads the back's own printed colours and indicator, not the front's", () => {
    expect(backFaceColors(archangelAvacyn)).toEqual(["R"]);
    expect(frameColorsFromScryfall(archangelAvacyn)).toEqual(["white"]);
    expect(backFaceColors(valki)).toEqual(["B", "R"]);
  });

  it("a colourless back stays colourless unless it is a land", () => {
    expect(backFaceColors(tergrid)).toEqual([]);
    expect(backFaceColors(aang)).toEqual([]);
    // A land back: its mana ability, else its basic land types.
    expect(backFaceColors(agadeem)).toEqual(["B"]);
    const mountain = withBack(agadeem, { type_line: "Land — Mountain", oracle_text: "", mana_cost: "" });
    expect(backFaceColors(mountain)).toEqual(["R"]);
    const twoMana = withBack(agadeem, { oracle_text: "{T}: Add {G} or {U}." });
    expect(backFaceColors(twoMana)).toEqual(["G", "U"]);
    // Never the card-level identity, which covers both faces.
    const colourlessLand = withBack(agadeem, { oracle_text: "{T}: Add {C}." });
    expect(backFaceColors(colourlessLand)).toEqual([]);
  });

  it("is empty with no second face", () => {
    expect(backFaceColors(serraAngel)).toEqual([]);
  });
});

describe("referenceBackColorIdentity", () => {
  it("is the creator's model of the back colour: two colours stay two, none is colourless, more is multicolor", () => {
    expect(referenceBackColorIdentity(archangelAvacyn)).toEqual(["red"]);
    expect(referenceBackColorIdentity(valki)).toEqual(["black", "red"]);
    expect(referenceBackColorIdentity(tergrid)).toEqual(["colorless"]);
    expect(referenceBackColorIdentity(agadeem)).toEqual(["black"]);
    const three = withBack(valki, { colors: ["W", "U", "B"] });
    expect(referenceBackColorIdentity(three)).toEqual(["multicolor"]);
  });

  it("is empty — not colourless — with no second face, and colourless for a one-picture adventure's text face", () => {
    expect(referenceBackColorIdentity(serraAngel)).toEqual([]);
    // Beanstalk Giant's Fertile Footsteps carries no colours of its own
    // (the card's are both halves'): colourless here; the compare view
    // never asks, since the adventure has no back scan.
    expect(referenceBackColorIdentity(beanstalkGiant)).toEqual(["colorless"]);
  });
});
