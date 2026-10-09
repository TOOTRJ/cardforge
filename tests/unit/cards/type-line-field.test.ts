import { describe, expect, it } from "vitest";
import {
  buildTypeLine,
  printsPowerToughness,
  showsPowerToughness,
  typeLineWords,
  withSupertypeWord,
} from "@/lib/cards/card-display";
import {
  PRINTED_TYPES_MAX,
  baseTypeWord,
  capitalizeTypeWords,
  derivedTypesText,
  resolvePrintedTypes,
  supertypeFromTypes,
  typesAfterSupertypeChange,
  typesFieldText,
  withPrintedTypes,
  withPrintedTypesUpdate,
} from "@/lib/cards/type-line-field";
import { qualifiesForCrown } from "@/lib/cards/anatomy";
import { typeWordOf } from "@/lib/cards/faces";
import { typeWordFrameFor } from "@/lib/creator/card-kinds";
import { colorlessFaceAllowed } from "@/lib/cards/dfc";
import { withEmblemShape } from "@/lib/cards/emblem";
import { cardPrintedTypesSchema, createCardSchema, updateCardSchema, backFaceSchema } from "@/lib/validation/card";
import { printTypography, typographyFieldOf, withPrintTypography, withPrintTypographyUpdate } from "@/lib/validation/print-typography";
import { REVISABLE_FIELDS, REVISABLE_PAYLOAD_KEYS, pickRevisablePayload } from "@/lib/creator/revise";
import { CARD_TYPE_VALUES, type CardType } from "@/types/card";

// ---------------------------------------------------------------------------
// The Types field (TODO 3b.16, owner 2026-10-09): the words left of the dash
// are ONE text, pre-filled with the card type's word; the maker's order
// prints; what the card IS keeps reading `card_type` + `supertype`.
// ---------------------------------------------------------------------------

describe("a card nobody typed a line for prints exactly what it printed (layout v50)", () => {
  const stored: Array<[CardType, string | null, string[], string]> = [
    ["creature", null, ["Goblin"], "Creature — Goblin"],
    ["creature", "Legendary Enchantment", ["God"], "Legendary Enchantment Creature — God"],
    ["creature", "goblin", ["wizard"], "goblin Creature — wizard"],
    ["land", "Creature", ["Forest", "Dryad"], "Land Creature — Forest Dryad"],
    ["instant", "Kindred", ["Faerie"], "Kindred Instant — Faerie"],
    ["token", "Artifact Creature", ["Thopter"], "Token Artifact Creature — Thopter"],
    ["token", null, [], "Token"],
    ["emblem", null, ["Kaito"], "Emblem — Kaito"],
  ];
  it.each(stored)("%s / %s", (cardType, supertype, subtypes, line) => {
    // No key, undefined and null are all "not typed".
    expect(buildTypeLine({ cardType, supertype, subtypes })).toBe(line);
    expect(buildTypeLine({ cardType, supertype, subtypes, printedTypes: undefined })).toBe(line);
    expect(buildTypeLine({ cardType, supertype, subtypes, printedTypes: null })).toBe(line);
  });

  it("the field starts as that line's left half (a token's without its fixed “Token”)", () => {
    expect(derivedTypesText({ cardType: "creature", supertype: null })).toBe("Creature");
    expect(derivedTypesText({ cardType: "creature", supertype: "goblin" })).toBe("goblin Creature");
    expect(derivedTypesText({ cardType: "creature", supertype: "Artifact Legendary" })).toBe("Legendary Artifact Creature");
    expect(derivedTypesText({ cardType: "land", supertype: "Creature" })).toBe("Land Creature");
    expect(derivedTypesText({ cardType: "token", supertype: "Creature Artifact" })).toBe("Artifact Creature");
    expect(derivedTypesText({ cardType: "token", supertype: null })).toBe("");
    expect(derivedTypesText({ cardType: "emblem", supertype: null })).toBe("");
    expect(typesFieldText({ cardType: "creature", supertype: "Legendary", printedTypes: null })).toBe("Legendary Creature");
    expect(typesFieldText({ cardType: "creature", supertype: "Legendary", printedTypes: "Goblin" })).toBe("Goblin");
    expect(typesFieldText({ cardType: "creature", supertype: "Legendary", printedTypes: "" })).toBe("");
  });

  it("every card type but token and emblem has a word of its own", () => {
    for (const cardType of CARD_TYPE_VALUES) {
      const word = baseTypeWord(cardType);
      if (cardType === "token" || cardType === "emblem") expect(word).toBeNull();
      else expect(derivedTypesText({ cardType, supertype: null })).toBe(word);
    }
    expect(baseTypeWord("")).toBeNull();
    expect(baseTypeWord(null)).toBeNull();
  });
});

describe("a typed line prints as typed (the maker's order wins)", () => {
  it("the owner's case: “goblin Creature — wizard” with “Creature” removed", () => {
    expect(buildTypeLine({ cardType: "creature", supertype: "Goblin", subtypes: ["Wizard"], printedTypes: "Goblin" })).toBe(
      "Goblin — Wizard",
    );
  });

  it("words before and after the card type's word, in any order — never re-ordered", () => {
    expect(typeLineWords({ cardType: "creature", supertype: "Legendary Snow", printedTypes: "Creature Snow Legendary" })).toEqual([
      "Creature",
      "Snow",
      "Legendary",
    ]);
    expect(buildTypeLine({ cardType: "land", supertype: "Creature", subtypes: ["Dryad"], printedTypes: "Creature Land" })).toBe(
      "Creature Land — Dryad",
    );
  });

  it("a token keeps its fixed “Token” first; an emblem its fixed line", () => {
    expect(buildTypeLine({ cardType: "token", supertype: "Creature Artifact", subtypes: ["Golem"], printedTypes: "Creature Artifact" })).toBe(
      "Token Creature Artifact — Golem",
    );
    expect(buildTypeLine({ cardType: "token", supertype: null, printedTypes: "" })).toBe("Token");
    expect(buildTypeLine({ cardType: "emblem", supertype: null, subtypes: ["Kaito"], printedTypes: "Legendary" })).toBe("Emblem — Kaito");
  });

  it("an emptied field prints the subtypes alone, with no dash — or nothing; never the “Type” placeholder", () => {
    expect(buildTypeLine({ cardType: "creature", supertype: null, subtypes: ["Goblin", "Wizard"], printedTypes: "" })).toBe("Goblin Wizard");
    expect(buildTypeLine({ cardType: "creature", supertype: null, subtypes: [], printedTypes: "" })).toBe("");
    expect(buildTypeLine({ cardType: "creature", supertype: null, subtypes: [], printedTypes: "   " })).toBe("");
    // The placeholder is a face with no type at all (the creator's first paint).
    expect(buildTypeLine({ cardType: null, supertype: null, subtypes: [] })).toBe("Type");
    // A double-faced card's strip names the other face's LAST printed word.
    expect(typeWordOf({ cardType: "creature", supertype: "Goblin", printedTypes: "Goblin" })).toBe("Goblin");
    expect(typeWordOf({ cardType: "creature", supertype: null, subtypes: [], printedTypes: "" })).toBeNull();
    expect(typeWordOf({ cardType: "creature", supertype: null })).toBe("Creature");
  });
});

describe("the supertype a typed line stands for — where every behaviour reader looks", () => {
  it("every word but the card type's own (its first occurrence, any case)", () => {
    expect(supertypeFromTypes("Legendary Goblin Creature", "creature")).toBe("Legendary Goblin");
    expect(supertypeFromTypes("goblin creature", "creature")).toBe("goblin");
    expect(supertypeFromTypes("Goblin", "creature")).toBe("Goblin");
    expect(supertypeFromTypes("", "creature")).toBe("");
    expect(supertypeFromTypes("Creature Creature", "creature")).toBe("Creature");
    expect(supertypeFromTypes("Land Creature", "land")).toBe("Creature");
    expect(supertypeFromTypes("Kindred Instant", "instant")).toBe("Kindred");
    // A token's field IS its supertype; "Token" is outside it.
    expect(supertypeFromTypes("Legendary Artifact Creature", "token")).toBe("Legendary Artifact Creature");
  });

  it("removing “Creature” from a creature's line keeps it a creature: the P/T shows and prints", () => {
    const supertype = supertypeFromTypes("Goblin", "creature");
    expect(showsPowerToughness("creature", [], supertype)).toBe(true);
    expect(printsPowerToughness({ cardType: "creature", supertype, subtypes: [], power: "2", toughness: "2" })).toBe(true);
  });

  it("typing “Creature” on a land shows a P/T (Dryad Arbor's rule, TODO 1.20); removing it takes the P/T away", () => {
    expect(showsPowerToughness("land", [], supertypeFromTypes("Land Creature", "land"))).toBe(true);
    expect(showsPowerToughness("land", [], supertypeFromTypes("Creature", "land"))).toBe(true);
    expect(showsPowerToughness("land", [], supertypeFromTypes("Land", "land"))).toBe(false);
    expect(showsPowerToughness("land", [], supertypeFromTypes("", "land"))).toBe(false);
    // Subtypes are their own field and keep their rule.
    expect(showsPowerToughness("artifact", ["Vehicle"], supertypeFromTypes("", "artifact"))).toBe(true);
  });

  it("a token's words: Creature → P/T, Artifact → the artifact frame, none → a bare “Token”", () => {
    const words = supertypeFromTypes("Legendary Artifact Creature", "token");
    expect(showsPowerToughness("token", [], words)).toBe(true);
    expect(typeWordFrameFor("token", "m15token", words)).toBe("m15tokenartifact");
    expect(typeWordFrameFor("token", "m15tokenartifact", supertypeFromTypes("Creature", "token"))).toBe("m15token");
    expect(showsPowerToughness("token", [], supertypeFromTypes("Artifact", "token"))).toBe(false);
  });

  it("“Legendary” typed anywhere offers the crown; “Artifact” lets a double-faced face be colourless", () => {
    expect(qualifiesForCrown({ cardType: "creature", supertype: supertypeFromTypes("Creature legendary", "creature") })).toBe(true);
    expect(qualifiesForCrown({ cardType: "creature", supertype: supertypeFromTypes("Goblin", "creature") })).toBe(false);
    expect(colorlessFaceAllowed("m15dfcfront", { cardType: "creature", supertype: supertypeFromTypes("Artifact Creature", "creature") })).toBe(true);
    expect(colorlessFaceAllowed("m15dfcfront", { cardType: "creature", supertype: supertypeFromTypes("Creature", "creature") })).toBe(false);
  });
});

describe("what a save stores (cards.printed_types, migration 0137)", () => {
  it("null when the typed line IS the built line — the maker who types what prints anyway stores nothing new", () => {
    expect(resolvePrintedTypes({ cardType: "creature", supertype: null, printedTypes: "Creature" })).toBeNull();
    expect(resolvePrintedTypes({ cardType: "creature", supertype: "Legendary", printedTypes: "  Legendary   Creature " })).toBeNull();
    expect(resolvePrintedTypes({ cardType: "token", supertype: "Artifact Creature", printedTypes: "Artifact Creature" })).toBeNull();
    expect(resolvePrintedTypes({ cardType: "creature", supertype: "Legendary", printedTypes: null })).toBeNull();
    expect(resolvePrintedTypes({ cardType: "creature", supertype: "Legendary" })).toBeNull();
  });

  it("the text, single-spaced, when it differs: another order, the word removed, emptied", () => {
    expect(resolvePrintedTypes({ cardType: "creature", supertype: "Legendary", printedTypes: "Creature  Legendary" })).toBe("Creature Legendary");
    expect(resolvePrintedTypes({ cardType: "creature", supertype: "Goblin", printedTypes: "Goblin" })).toBe("Goblin");
    expect(resolvePrintedTypes({ cardType: "creature", supertype: null, printedTypes: "" })).toBe("");
    // A token with no words builds "" — an emptied field is nothing to keep.
    expect(resolvePrintedTypes({ cardType: "token", supertype: null, printedTypes: "" })).toBeNull();
  });

  it("an emblem never stores one, whoever sent it", () => {
    expect(resolvePrintedTypes({ cardType: "emblem", supertype: null, printedTypes: "Legendary" })).toBeNull();
    const shaped = withPrintedTypes(withEmblemShape({ card_type: "emblem" as const, printed_types: "Legendary" as string | null }));
    expect(shaped.printed_types).toBeNull();
  });

  it("a new card: the front's column and a second face's key, each only where the line differs", () => {
    const saved = withPrintedTypes({
      card_type: "creature" as CardType,
      supertype: "Goblin",
      printed_types: "Goblin" as string | null,
      back_face: { card_type: "sorcery" as CardType, supertype: undefined, printed_types: "Sorcery", title: "Back" },
    });
    expect(saved.printed_types).toBe("Goblin");
    // The payload's supertype is never rewritten (a remix carries its
    // parent's beside a line re-worded on an edit).
    expect(saved.supertype).toBe("Goblin");
    expect(saved.back_face).toEqual({ card_type: "sorcery", supertype: undefined, title: "Back" });
    expect("printed_types" in (saved.back_face ?? {})).toBe(false);
    const typedBack = withPrintedTypes({
      card_type: "creature" as CardType,
      back_face: { card_type: "land" as CardType, supertype: "Creature", printed_types: "Creature Land" },
    });
    expect((typedBack as { printed_types?: unknown }).printed_types).toBeNull();
    expect(typedBack.back_face?.printed_types).toBe("Creature Land");
  });

  it("an edit: judged on the STORED type words; a patch that does not name the field leaves it alone", () => {
    const stored = { card_type: "creature", supertype: "goblin" };
    expect(withPrintedTypesUpdate({ title: "x" } as { title: string; printed_types?: string | null }, stored).printed_types).toBeUndefined();
    expect(withPrintedTypesUpdate({ printed_types: null }, stored).printed_types).toBeNull();
    // Resent as it prints today: nothing to store.
    expect(withPrintedTypesUpdate({ printed_types: "goblin Creature" }, stored).printed_types).toBeNull();
    expect(withPrintedTypesUpdate({ printed_types: "Goblin" }, stored).printed_types).toBe("Goblin");
    expect(withPrintedTypesUpdate({ printed_types: "" }, stored).printed_types).toBe("");
  });

  it("the schemas: '' is a value (never emptied to undefined), 80 characters at most, the key optional everywhere", () => {
    expect(PRINTED_TYPES_MAX).toBe(80);
    expect(cardPrintedTypesSchema.parse("  Goblin  ")).toBe("Goblin");
    expect(cardPrintedTypesSchema.parse("")).toBe("");
    expect(cardPrintedTypesSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(updateCardSchema.parse({ printed_types: "" }).printed_types).toBe("");
    expect(updateCardSchema.parse({ printed_types: null }).printed_types).toBeNull();
    expect(updateCardSchema.parse({ title: "T" }).printed_types).toBeUndefined();
    expect(backFaceSchema.parse({ title: "B", printed_types: "" }).printed_types).toBe("");
    expect(backFaceSchema.parse({ title: "B" }).printed_types).toBeUndefined();
    expect(createCardSchema.shape.printed_types.safeParse(undefined).success).toBe(true);
  });

  it("an edit may send the printed line and nothing else of the type", () => {
    expect(REVISABLE_FIELDS).toContain("printed_types");
    expect(REVISABLE_PAYLOAD_KEYS).toContain("printed_types");
    for (const locked of ["supertype", "card_type", "subtypes"]) expect(REVISABLE_PAYLOAD_KEYS as readonly string[]).not.toContain(locked);
    expect(pickRevisablePayload({ printed_types: "Goblin", supertype: "x", card_type: "creature", subtypes: [] })).toEqual({
      printed_types: "Goblin",
    });
  });
});

describe("another control changes a face's type words while a line is typed", () => {
  const sync = (typed: string, before: string, after: string) => typesAfterSupertypeChange(typed, before, after, withSupertypeWord);
  it("an added word goes in where the printed order sets it; the maker's words stay where they are", () => {
    expect(sync("Snow Legendary Creature", "Snow Legendary Creature", "Snow Legendary Creature Artifact")).toBe(
      "Snow Legendary Artifact Creature",
    );
    expect(sync("Goblin", "Goblin", "Goblin Artifact")).toBe("Goblin Artifact");
  });
  it("a removed word comes out; a word both lists hold is untouched", () => {
    expect(sync("Snow Legendary Creature", "Snow Legendary Creature", "Snow Legendary")).toBe("Snow Legendary");
    expect(sync("Creature Legendary", "Legendary", "")).toBe("Creature");
    expect(sync("Creature Legendary", "Legendary", "legendary")).toBe("Creature Legendary");
  });
});

describe("capitals (owner's answer 3): each word capitalised as prints do", () => {
  it.each([
    ["goblin creature", "Goblin Creature"],
    ["goblin", "Goblin"],
    ["legendary enchantment creature", "Legendary Enchantment Creature"],
    ["urza's power-plant", "Urza's Power-Plant"],
    ["urza’s", "Urza’s"],
    ["dragon, elder", "Dragon, Elder"],
    ["dragon,elder", "Dragon,Elder"],
    ["time lord", "Time Lord"],
    ["McDonald", "McDonald"],
    ["mcDonald", "McDonald"],
    ["B.O.B.", "B.O.B."],
    ["GOBLIN CREATURE", "Goblin Creature"],
    ["GOBLIN", "Goblin"],
    ["Legendary UFO", "Legendary UFO"],
    ["90s kid", "90s Kid"],
    ["land — artifact", "Land — Artifact"],
    ["élan", "Élan"],
    ["straße", "Straße"],
    ["A", "A"],
    ["", ""],
    ["  goblin  ", "  Goblin  "],
  ])("%j → %j", (typed, printed) => {
    expect(capitalizeTypeWords(typed)).toBe(printed);
    // Idempotent, and never a different length.
    expect(capitalizeTypeWords(printed)).toBe(printed);
    expect(capitalizeTypeWords(typed)).toHaveLength(typed.length);
  });

  it("runs wherever a type-line part is set: the Types field, the supertype, the subtypes — never a name or rules text", () => {
    expect(typographyFieldOf("printed_types")).toBe("type");
    expect(typographyFieldOf("back_face.printed_types")).toBe("type");
    expect(typographyFieldOf("supertype")).toBe("type");
    expect(typographyFieldOf("subtypes_text")).toBe("type");
    expect(printTypography("goblin wizard", "type")).toBe("Goblin Wizard");
    expect(printTypography("urza's saga", "type")).toBe("Urza’s Saga");
    expect(printTypography("goblin wizard", "name")).toBe("goblin wizard");
    expect(printTypography("goblin wizard", "rules")).toBe("goblin wizard");
    // Never inside a symbol token.
    expect(printTypography("{t} goblin", "type")).toBe("{t} Goblin");
  });

  it("a new card is capitalised whole — front and second face", () => {
    const saved = withPrintTypography({
      title: "kesh",
      supertype: "legendary",
      printed_types: "goblin creature legendary" as string | null,
      subtypes: ["goblin", "wizard"],
      back_face: { title: "b", supertype: "snow", printed_types: "snow sorcery", subtypes: ["arcane"] },
    });
    expect(saved.title).toBe("kesh");
    expect(saved.supertype).toBe("Legendary");
    expect(saved.printed_types).toBe("Goblin Creature Legendary");
    expect(saved.subtypes).toEqual(["Goblin", "Wizard"]);
    expect(saved.back_face).toMatchObject({ supertype: "Snow", printed_types: "Snow Sorcery", subtypes: ["Arcane"] });
  });

  it("an edit: a line resent as the card prints it today keeps its typed case; a changed one is capitalised", () => {
    const stored = { card_type: "creature", supertype: "goblin", printed_types: null, subtypes: ["wizard"] };
    // Untouched: the field's own text (the built line), lower case and all.
    expect(withPrintTypographyUpdate({ printed_types: "goblin Creature" as string | null, subtypes: ["wizard"] }, stored)).toEqual({
      printed_types: "goblin Creature",
      subtypes: ["wizard"],
    });
    expect(withPrintTypographyUpdate({ printed_types: null as string | null }, stored).printed_types).toBeNull();
    expect(withPrintTypographyUpdate({ printed_types: "goblin" as string | null }, stored).printed_types).toBe("Goblin");
    // A stored typed line resent as it is stored is left alone too.
    const typed = { card_type: "creature", supertype: "x", printed_types: "goblin KING" };
    expect(withPrintTypographyUpdate({ printed_types: "goblin KING" as string | null }, typed).printed_types).toBe("goblin KING");
    expect(withPrintTypographyUpdate({ printed_types: "goblin KINGS" as string | null }, typed).printed_types).toBe("Goblin KINGS");
    // The same on a second face.
    const withBack = { back_face: { card_type: "sorcery", supertype: "arcane", title: "b" } };
    expect(
      withPrintTypographyUpdate({ back_face: { title: "b", supertype: "arcane", printed_types: "arcane Sorcery" } }, withBack).back_face,
    ).toMatchObject({ printed_types: "arcane Sorcery" });
    expect(
      withPrintTypographyUpdate({ back_face: { title: "b", supertype: "arcane", printed_types: "sorcery" } }, withBack).back_face,
    ).toMatchObject({ printed_types: "Sorcery" });
  });
});
