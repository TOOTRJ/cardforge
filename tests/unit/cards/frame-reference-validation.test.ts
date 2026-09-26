import { describe, expect, it } from "vitest";
import {
  referenceKindFor,
  validateReferenceForCombo,
} from "@/lib/cards/frame-reference-validation";
import type { ScryfallCard } from "@/lib/scryfall/client";

// A pinned reference is rendered with the printing's OWN colour and kind but
// the verify checkbox publishes the row's colour — so a mismatch means the
// admin scores one frame and publishes another. Colour/kind mismatches are
// refused; era is only a warning.

function card(overrides: Partial<Record<string, unknown>>): ScryfallCard {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Test Card",
    layout: "normal",
    frame: "2015",
    type_line: "Creature — Test",
    color_identity: ["W"],
    colors: ["W"],
    ...overrides,
  } as unknown as ScryfallCard;
}

describe("validateReferenceForCombo", () => {
  it("accepts a matching colour, kind and era", () => {
    const result = validateReferenceForCombo(card({}), "m15", "w");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("refuses a printing of another colour", () => {
    const result = validateReferenceForCombo(
      card({ name: "Frost Lynx", color_identity: ["U"], colors: ["U"] }),
      "m15",
      "w",
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Frost Lynx is a blue card/);
    expect(result.errors[0]).toMatch(/white/);
  });

  it("treats two or more colours as the multicolor frame", () => {
    const gold = card({ color_identity: ["W", "U"], colors: ["W", "U"] });
    expect(validateReferenceForCombo(gold, "m15", "m").errors).toEqual([]);
    expect(validateReferenceForCombo(gold, "m15", "w").errors).toHaveLength(1);
  });

  it("refuses a kind the frame cannot render", () => {
    const creature = card({ type_line: "Creature — Bear" });
    const result = validateReferenceForCombo(creature, "saga", "w");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/is a creature; the Saga frame/);
    // …and a real saga is fine.
    const saga = card({
      layout: "saga",
      type_line: "Enchantment — Saga",
    });
    expect(validateReferenceForCombo(saga, "saga", "w").errors).toEqual([]);
  });

  it("recognises a transforming Saga from its front face type line", () => {
    const kamiWar = card({
      name: "The Kami War // O-Kagachi Made Manifest",
      layout: "transform",
      type_line: "Legendary Enchantment — Saga // Legendary Enchantment Creature — Dragon Spirit",
      color_identity: ["W", "U", "B", "R", "G"],
      colors: ["W", "U", "B", "R", "G"],
      card_faces: [
        { name: "The Kami War", type_line: "Legendary Enchantment — Saga" },
        { name: "O-Kagachi Made Manifest", type_line: "Legendary Enchantment Creature — Dragon Spirit" },
      ],
    });
    expect(referenceKindFor(kamiWar)).toBe("saga");
    expect(validateReferenceForCombo(kamiWar, "saga", "m").errors).toEqual([]);
  });

  it("lets a planeswalker onto the planeswalker frame and nothing else", () => {
    const walker = card({
      type_line: "Legendary Planeswalker — Jace",
      color_identity: ["U"],
      colors: ["U"],
    });
    expect(validateReferenceForCombo(walker, "m15pw", "u").errors).toEqual([]);
    expect(validateReferenceForCombo(walker, "m15", "u").errors).toHaveLength(1);
  });

  it("keeps planeswalkers off the frames with no loyalty slot (TODO 0.26)", () => {
    const walker = card({
      name: "Nahiri, Heir of the Ancients",
      type_line: "Legendary Planeswalker — Nahiri",
      color_identity: ["R", "W"],
      colors: ["R", "W"],
    });
    const result = validateReferenceForCombo(walker, "fullart", "m");
    expect(result.errors).toHaveLength(1);
    // Showcase frames are named with their set, as on the admin checklist.
    expect(result.errors[0]).toMatch(/is a planeswalker; the Zendikar Rising — Hedron frame/);
  });

  it("verifies the full-art basic frame against basic lands only (TODO 0.26)", () => {
    const plains = card({ name: "Plains", type_line: "Basic Land — Plains", color_identity: ["W"], colors: [] });
    expect(validateReferenceForCombo(plains, "fullartland", "w").errors).toEqual([]);
    const wastes = card({ name: "Wastes", type_line: "Basic Land", color_identity: [], colors: [] });
    expect(validateReferenceForCombo(wastes, "fullartland", "c").errors).toEqual([]);

    const fountain = card({
      name: "Hallowed Fountain",
      type_line: "Land — Plains Island",
      oracle_text: "({T}: Add {W} or {U}.)",
      color_identity: ["W", "U"],
      colors: [],
    });
    const result = validateReferenceForCombo(fountain, "fullartland", "m");
    expect(result.errors).toEqual([
      "Hallowed Fountain isn't a basic land; the Full Art — Basic Land frame dresses basic lands only.",
    ]);
    // Any other land frame still takes it.
    expect(validateReferenceForCombo(fountain, "m15land", "m").errors).toEqual([]);
  });

  it("judges a two-faced printing's basic-ness by its FRONT face", () => {
    const faces = (front: Record<string, unknown>, back: Record<string, unknown>) =>
      card({
        name: `${front.name} // ${back.name}`,
        layout: "modal_dfc",
        type_line: `${front.type_line} // ${back.type_line}`,
        color_identity: ["W"],
        colors: [],
        card_faces: [front, back],
      });
    const plains = { name: "Plains", type_line: "Basic Land — Plains" };
    const bear = { name: "Bear", type_line: "Creature — Bear", oracle_text: "Vigilance" };
    expect(validateReferenceForCombo(faces(plains, bear), "fullartland", "w").errors).toEqual([]);
    const tower = { name: "Watchtower", type_line: "Land", oracle_text: "{T}: Add {W}." };
    expect(validateReferenceForCombo(faces(tower, plains), "fullartland", "w").errors).toEqual([
      "Watchtower // Plains isn't a basic land; the Full Art — Basic Land frame dresses basic lands only.",
    ]);
  });

  it("warns (does not refuse) on an era mismatch", () => {
    const result = validateReferenceForCombo(card({ frame: "2003" }), "m15", "w");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/2003 frame/);
  });

  it("warns when the kind cannot be derived", () => {
    const result = validateReferenceForCombo(
      card({ type_line: "Emblem", layout: "emblem", color_identity: [], colors: [] }),
      "m15",
      "c",
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => /kind of card/.test(w))).toBe(true);
  });
});
