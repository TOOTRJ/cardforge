import { describe, expect, it } from "vitest";
import {
  CARD_KIND_VALUES,
  EMBLEM_ENTRY_VALUES,
  KIND_DEFS,
  frameColorKeyForKind,
  KIND_PICKER_KINDS,
  framesForKind,
  kindFromCard,
  kindHasAvailableFrame,
  kindHidesRarity,
  kindPickerChip,
  planKindChange,
  templateRefusesKind,
  templateSupportsKind,
  titleEnteringEmblem,
} from "@/lib/creator/card-kinds";
import { frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { frameComboKey, sampleFramePreview } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { buildTypeLine, printsPowerToughness, showsPowerToughness } from "@/lib/cards/card-display";
import { statVisibility, hidesCost } from "@/lib/creator/steps";
import { withEmblemShape, withEmblemUpdateShape } from "@/lib/cards/emblem";
import { ERA_TYPE_FRAME, FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 6.23 — the emblem card type and kind. CR 114: an emblem has no
// colour, cost, supertype, P/T or rarity, and every printed one sits on the
// emblem frame (4.52). The creator reaches it from the token kind's picker
// (owner decision 2026-09-29), never as a kind chip of its own; it is still
// stored as its own card type.
// ---------------------------------------------------------------------------

const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => ["w", "u", "b", "r", "g", "c", "m"].map((k) => frameComboKey(t, k))));

describe("the emblem kind", () => {
  it("is a kind that stores card_type emblem and previews the emblem frame", () => {
    expect(CARD_KIND_VALUES).toContain("emblem");
    expect(KIND_DEFS.emblem).toMatchObject({
      label: "Emblem",
      cardType: "emblem",
      layoutTemplates: null,
      previewTemplate: "emblem",
      inlineSecondFace: false,
    });
    expect(ERA_TYPE_FRAME.m15?.emblem).toBe("emblem");
    expect(kindFromCard("emblem", "emblem")).toBe("emblem");
    // The card type decides it, as for every standard kind.
    expect(kindFromCard("emblem", undefined)).toBe("emblem");
  });

  it("is not a chip of the kind picker: the Token chip stands for it", () => {
    expect(KIND_PICKER_KINDS).not.toContain("emblem");
    // The two double-faced kinds ARE chips since their editor (TODO 5.2) —
    // dark until their bodies are verified.
    expect(KIND_PICKER_KINDS).toContain("transform");
    expect(KIND_PICKER_KINDS).toContain("mdfc");
    expect(KIND_PICKER_KINDS).toEqual(CARD_KIND_VALUES.filter((k) => k !== "emblem"));
    expect(kindPickerChip("emblem")).toBe("token");
    expect(kindPickerChip("token")).toBe("token");
    expect(kindPickerChip("creature")).toBe("creature");
  });

  it("wears the emblem frame and nothing else — no other era, skin or showcase", () => {
    expect(framesForKind("emblem", ALL).map((f) => f.template)).toEqual(["emblem"]);
    expect(framesForKind("emblem", ALL)[0]).toMatchObject({ era: "m15", group: "standard" });
    expect(templateSupportsKind("emblem", "emblem")).toBe(true);
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (t === "emblem") continue;
      expect(templateRefusesKind(t, "emblem"), t).toBe(true);
      expect(framesForKind("token", ALL).some((f) => f.template === "emblem"), t).toBe(false);
    }
  });

  it("the emblem frame dresses no other kind", () => {
    for (const kind of CARD_KIND_VALUES) {
      if (kind === "emblem") continue;
      expect(templateRefusesKind("emblem", kind), kind).toBe(true);
      expect(templateSupportsKind("emblem", kind), kind).toBe(false);
    }
    // …and no showcase restriction changed for the others.
    expect(templateRefusesKind("m15borderless", "creature")).toBe(false);
    expect(templateRefusesKind("nyx", "artifact")).toBe(true);
  });

  it("the server's kind gate refuses an emblem on another frame and a creature on the emblem frame", () => {
    expect(frameKindGateError("emblem", { cardType: "emblem", title: "Kaito, Cunning Infiltrator" })).toBeNull();
    expect(frameKindGateError("m15token", { cardType: "emblem", title: "Kaito" })).toMatch(
      /doesn't dress Emblem cards/,
    );
    expect(frameKindGateError("m15", { cardType: "emblem", title: "Kaito" })).toMatch(/doesn't dress Emblem cards/);
    expect(frameKindGateError("emblem", { cardType: "creature", title: "Bear" })).toMatch(
      /Emblem frame doesn't dress Creature cards/,
    );
    // An update that moves a token onto the emblem frame without the type.
    expect(
      frameKindUpdateGateError({
        existingTemplate: "m15token",
        nextTemplate: "emblem",
        existing: { cardType: "token" },
        next: { cardType: "token" },
      }),
    ).toMatch(/doesn't dress Token cards/);
  });

  it("is published only once emblem/c is verified", () => {
    expect(kindHasAvailableFrame("emblem", new Set())).toBe(false);
    expect(kindHasAvailableFrame("emblem", new Set([frameComboKey("emblem", "c")]))).toBe(true);
    // Another colour of the one silver master publishes nothing an emblem wears.
    expect(framesForKind("emblem", new Set([frameComboKey("emblem", "c")]))[0].availableColorKeys).toEqual(["c"]);
  });

  it("a token turns into an emblem on the emblem frame, and back onto the token frame", () => {
    expect(planKindChange("emblem", { cardType: "token", template: "m15token" })).toEqual({
      action: "apply",
      patch: { card_type: "emblem", template: "emblem" },
    });
    expect(planKindChange("token", { cardType: "emblem", template: "emblem" })).toEqual({
      action: "apply",
      patch: { card_type: "token", template: "m15token" },
    });
    // From another era (a showcase treatment): no emblem there, so it asks.
    expect(planKindChange("emblem", { cardType: "token", template: "fullart" })).toMatchObject({
      action: "confirm",
      patch: { card_type: "emblem", template: "emblem" },
    });
  });

  it("resolves its frame in colourless whatever the card's colour (the frame is silver in every key)", () => {
    expect(frameColorKeyForKind("emblem", "r")).toBe("c");
    expect(frameColorKeyForKind("emblem", "m")).toBe("c");
    expect(frameColorKeyForKind("token", "r")).toBe("r");
    expect(frameColorKeyForKind("creature", "g")).toBe("g");
  });

  it("hides the rarity chips like the token kind, and clears colour, cost, supertype and stats on entry", () => {
    expect(kindHidesRarity("emblem")).toBe(true);
    expect(kindHidesRarity("token")).toBe(true);
    expect(kindHidesRarity("creature")).toBe(false);
    expect(EMBLEM_ENTRY_VALUES).toEqual({
      color_identity: ["colorless"],
      cost: "",
      supertype: "",
      // The optional subtype starts off (a token's "Soldier" stays behind).
      subtypes_text: "",
      power: "",
      toughness: "",
      loyalty: "",
      defense: "",
      rarity: "common",
    });
  });
});

describe("the name on entering the emblem (owner evidence 2026-09-29: a stale \"Soldier\")", () => {
  it("drops a token name that only restates the token's subtypes — the walker's name is asked for", () => {
    // The name-follow's own ("Soldier" from the Subtypes field).
    expect(titleEnteringEmblem({ title: "Soldier", subtypes: ["Soldier"], lastAuto: "Soldier" })).toBe("");
    expect(titleEnteringEmblem({ title: "Rabbit Knight", subtypes: [], lastAuto: "Rabbit Knight" })).toBe("");
    // An import's or a typed one that equals the subtypes, case and spacing aside.
    expect(titleEnteringEmblem({ title: "Soldier", subtypes: ["Soldier"], lastAuto: null })).toBe("");
    expect(titleEnteringEmblem({ title: " rabbit  knight ", subtypes: ["Rabbit", "Knight"], lastAuto: null })).toBe("");
  });

  it("keeps any other name — a proper token name, a walker's, an empty one", () => {
    expect(titleEnteringEmblem({ title: "Voja Fenstalker", subtypes: ["Wolf"], lastAuto: null })).toBe("Voja Fenstalker");
    expect(titleEnteringEmblem({ title: "Kaito, Cunning Infiltrator", subtypes: ["Kaito"], lastAuto: "Kaito" })).toBe(
      "Kaito, Cunning Infiltrator",
    );
    expect(titleEnteringEmblem({ title: "", subtypes: ["Soldier"], lastAuto: "Soldier" })).toBe("");
    expect(titleEnteringEmblem({ title: "Soldier", subtypes: [], lastAuto: null })).toBe("Soldier");
  });
});

describe("the walk-through's sample for the emblem frame", () => {
  it("is an emblem — no cost, types or stats, one rules line — not a 3/3 creature", () => {
    expect(sampleFramePreview("emblem", "c")).toMatchObject({
      cardType: "emblem",
      cost: null,
      supertype: null,
      subtypes: [],
      power: null,
      toughness: null,
      rulesText: "Creatures you control get +1/+1.",
      frameStyle: { template: "emblem" },
    });
  });
});

describe("what an emblem prints", () => {
  it("prints 'Emblem', or 'Emblem — Kaito' with its optional subtype, never a supertype", () => {
    expect(buildTypeLine({ cardType: "emblem" })).toBe("Emblem");
    expect(buildTypeLine({ cardType: "emblem", subtypes: ["Kaito"] })).toBe("Emblem — Kaito");
    expect(buildTypeLine({ cardType: "emblem", supertype: "Legendary Creature" })).toBe("Emblem");
  });

  it("has no P/T, loyalty or defense input and prints none, whatever is stored", () => {
    expect(showsPowerToughness("emblem", [], "Creature")).toBe(false);
    expect(printsPowerToughness({ cardType: "emblem", power: "2", toughness: "2" })).toBe(false);
    expect(statVisibility("emblem")).toEqual({ pt: false, loyalty: false, defense: false });
  });

  it("the emblem frame paints no cost and has no stat slot", () => {
    const p = getFrameProfile("emblem");
    expect(hidesCost("emblem")).toBe(true);
    expect(p.pt).toBeUndefined();
    expect(p.loyalty).toBeUndefined();
    expect(p.defense).toBeUndefined();
  });
});

describe("the stored shape (the card actions enforce it)", () => {
  it("a new emblem stores no colour, cost, supertype or stats, whoever sent them", () => {
    const shaped = withEmblemShape({
      card_type: "emblem" as const,
      title: "Kaito, Cunning Infiltrator",
      cost: "{2}{U}",
      color_identity: ["blue" as const],
      supertype: "Legendary",
      power: "2",
      toughness: "1",
      loyalty: "4",
      defense: "3",
      rules_text: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
      subtypes: ["Kaito"],
    });
    expect(shaped).toEqual({
      card_type: "emblem",
      title: "Kaito, Cunning Infiltrator",
      cost: undefined,
      color_identity: ["colorless"],
      supertype: undefined,
      power: undefined,
      toughness: undefined,
      loyalty: undefined,
      defense: undefined,
      rules_text: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
      subtypes: ["Kaito"],
    });
    // Any other card type is untouched (the same object).
    const token = { card_type: "token" as const, cost: "{1}", color_identity: ["red" as const] };
    expect(withEmblemShape(token)).toBe(token);
  });

  it("an update turning a card into an emblem clears them; a patch to an emblem can't set them", () => {
    expect(withEmblemUpdateShape({ card_type: "emblem" as const }, "token")).toEqual({
      card_type: "emblem",
      cost: null,
      color_identity: ["colorless"],
      supertype: null,
      power: null,
      toughness: null,
      loyalty: null,
      defense: null,
    });
    // A patch naming none of them stays as it is.
    expect(withEmblemUpdateShape({ rules_text: "Renamed", cost: undefined }, "emblem")).toEqual({
      rules_text: "Renamed",
    });
    expect(withEmblemUpdateShape({ cost: "{1}", color_identity: ["red" as const] }, "emblem")).toEqual({
      cost: null,
      color_identity: ["colorless"],
    });
    const creature = { cost: "{1}" };
    expect(withEmblemUpdateShape(creature, "creature")).toBe(creature);
  });
});
