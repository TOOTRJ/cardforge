import { describe, expect, it } from "vitest";
import { ownCardRemixFrame, type OwnCardRemixSource } from "@/lib/ai/remix-mechanics";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.26, M1 — the AI deck remix of the user's OWN adventure keeps its
// frame with the spell's page in its own colour only where the spell's
// colour is verified on the adventure frame; else the look goes OFF
// (`part_color_off`) and the frame is judged in the creature's colour, as
// before 4.26 — never a save the gate refuses after the art. The creature's
// colour IS the card's: no first part's colour is read.
// ---------------------------------------------------------------------------

const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "m", "c"].map((k) => `${t}/${k}`)));
const without = (...keys: string[]) => new Set([...ALL].filter((k) => !keys.includes(k)));

/** Callous Sell-Sword // Burn Together (WOE #221): a black creature, a red spell. */
const sellSword = (frameStyle: Record<string, unknown>, backColors: string[] | null = ["red"]): OwnCardRemixSource =>
  ({
    title: "Callous Sell-Sword",
    card_type: "creature",
    supertype: null,
    subtypes: ["Human", "Soldier"],
    rules_text: "Callous Sell-Sword enters with a +1/+1 counter on it for each creature that died under your control this turn.",
    power: "2",
    toughness: "2",
    color_identity: ["black"],
    frame_style: { template: "adventure", finish: "regular", ...frameStyle },
    back_face: { title: "Burn Together", cost: "{R}", card_type: "sorcery", subtypes: ["Adventure"], ...(backColors ? { color_identity: backColors } : {}) },
  }) as unknown as OwnCardRemixSource;

describe("an own adventure's remix", () => {
  it("keeps the frame and the spell's colour where both are verified", () => {
    const kept = ownCardRemixFrame(sellSword({ partColor: true }), ALL);
    expect(kept.frame_template).toBe("adventure");
    expect(kept.part_color_off).toBeUndefined();
  });

  it("the spell's colour not verified: the look OFF, the frame judged in the creature's colour", () => {
    expect(ownCardRemixFrame(sellSword({ partColor: true }), without("adventure/r"))).toMatchObject({ frame_template: "adventure", part_color_off: true });
    // …and the creature's own colour unticked: no template, the default
    // landing (as before 4.26).
    expect(ownCardRemixFrame(sellSword({ partColor: true }), without("adventure/r", "adventure/b"))).toEqual({});
  });

  it("a card stored before 4.26 (no switch) is judged as the new-card default; off stays off", () => {
    // Absent = the new-card default (on): gated on the spell's colour too.
    expect(ownCardRemixFrame(sellSword({}), without("adventure/r")).part_color_off).toBe(true);
    expect(ownCardRemixFrame(sellSword({ partColor: false }), without("adventure/r"))).toEqual(expect.objectContaining({ frame_template: "adventure" }));
    expect(ownCardRemixFrame(sellSword({ partColor: false }), without("adventure/r")).part_color_off).toBeUndefined();
    // A spell with no colour of its own (every adventure stored before 4.26):
    // nothing to gate, as main.
    expect(ownCardRemixFrame(sellSword({}, null), without("adventure/r"))).toEqual(expect.objectContaining({ frame_template: "adventure" }));
    expect(ownCardRemixFrame(sellSword({}, null), without("adventure/r")).part_color_off).toBeUndefined();
  });
});
