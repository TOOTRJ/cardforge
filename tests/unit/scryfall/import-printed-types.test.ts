import { describe, expect, it } from "vitest";
import { buildTypeLine } from "@/lib/cards/card-display";
import { mapScryfallToFormPatch, parseTypeLine, printedTypesOfPrinting } from "@/lib/scryfall/import-mapper";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { importPatchTypeLine } from "@/components/creator/import/import-detail";
import prints from "../cards/fixtures/type-line-prints.json";
import importPrintings from "./fixtures/import-printings.json";

// ---------------------------------------------------------------------------
// Imports write the PRINTING's own word order into the Types field (TODO
// 3b.16, owner's answer 4) — which is the built line for every printing in
// today's order (TODO 1.20), so nothing is named beside the supertype; only
// a printing that reads differently carries a text.
// ---------------------------------------------------------------------------

function landing(typeLine: string) {
  const parts = parseTypeLine(typeLine);
  const printed = printedTypesOfPrinting(typeLine, { cardType: parts.card_type, supertype: parts.supertype });
  const subtypes = (parts.subtypes_text ?? "").split(", ").filter(Boolean);
  return {
    printed,
    line: buildTypeLine({ cardType: parts.card_type, supertype: parts.supertype, subtypes, printedTypes: printed }),
  };
}

describe("printedTypesOfPrinting", () => {
  it.each([
    "Legendary Enchantment Creature — God",
    "Kindred Instant — Faerie",
    "Land Creature — Forest Dryad",
    "Enchantment Land — Urza’s Saga",
    "Artifact Creature — Golem",
    "Basic Snow Land — Forest",
    "Token Legendary Artifact Creature — Construct",
    "Token Artifact — Treasure",
    "Legendary Planeswalker — Jace",
    "Instant",
  ])("%s: the built line is the printed one — no text to store, and it lands as printed", (typeLine) => {
    const { printed, line } = landing(typeLine);
    expect(printed).toBeUndefined();
    expect(line).toBe(typeLine.replace("’", "’"));
  });

  it.each([
    // Orders no black-bordered printing uses (the survey of TODO 1.20) —
    // what a future or odd printing would need: they land AS PRINTED.
    ["Creature Land — Dryad", "Creature Land"],
    ["Artifact Legendary Creature — Golem", "Artifact Legendary Creature"],
    ["Token Creature Artifact — Golem", "Creature Artifact"],
  ])("%s lands in its own order (%s)", (typeLine, text) => {
    const { printed, line } = landing(typeLine);
    expect(printed).toBe(text);
    expect(line).toBe(typeLine);
  });

  it("an emblem, a face with no type and an empty line name nothing", () => {
    expect(printedTypesOfPrinting("Emblem — Kaito", { cardType: "emblem" })).toBeUndefined();
    expect(printedTypesOfPrinting("Creature", {})).toBeUndefined();
    expect(printedTypesOfPrinting(null, { cardType: "creature" })).toBeUndefined();
  });
});

// The Scryfall survey of TODO 1.20 (one printing per distinct line left of
// the dash, captured 2026-10-08). Until the Types field two of them could
// not be printed back — the words of UNF #189 and a playtest card stand the
// other way round from Bident of Thassa's, and `supertype` alone holds no
// order (tests/unit/cards/type-line-order.test.ts NOT_REPRESENTABLE). They
// now land AS PRINTED; "Scheme" is still a word PipGlyph has no type for.
describe("the Scryfall survey: every printing lands as it is printed", () => {
  const DROPPED_WORD: Readonly<Record<string, string>> = { "Ongoing Scheme": "Ongoing" };

  it.each(prints.lines.map((line) => [line.type_line, `${line.name} ${line.set.toUpperCase()} #${line.number}`] as const))(
    "%s (%s)",
    (typeLine) => {
      expect(landing(typeLine).line).toBe(DROPPED_WORD[typeLine] ?? typeLine);
    },
  );

  it("names a Types text for exactly the printings whose order the built line cannot give", () => {
    const named = prints.lines.filter((line) => landing(line.type_line).printed !== undefined).map((line) => line.type_line);
    expect(named.sort()).toEqual(["Artifact Enchantment — Saga", "Legendary Instant Artifact Enchantment"]);
    expect(landing("Artifact Enchantment — Saga").printed).toBe("Artifact Enchantment");
    expect(landing("Legendary Instant Artifact Enchantment").printed).toBe("Legendary Instant Artifact Enchantment");
  });
});

describe("through the whole mapper", () => {
  const patchOf = (key: keyof typeof importPrintings) => mapScryfallToFormPatch(scryfallCardSchema.parse(importPrintings[key]));

  it.each([
    ["dsc-273", "Land Creature — Forest Dryad"],
    ["ths-42", "Legendary Enchantment Artifact"],
    ["tmsh-27", "Token Artifact — Treasure"],
  ] as const)("%s (%s): the built line is the printing's — the patch carries no key at all", (key, line) => {
    const patch = patchOf(key);
    expect("printed_types" in patch).toBe(false);
    expect(importPatchTypeLine(patch)).toBe(line);
  });

  it("a printing in another order carries its words, and the import's summary prints them", () => {
    const card = scryfallCardSchema.parse({ ...importPrintings["dsc-273"], type_line: "Creature Land — Forest Dryad" });
    const patch = mapScryfallToFormPatch(card);
    expect(patch.card_type).toBe("land");
    expect(patch.supertype).toBe("Creature");
    expect(patch.printed_types).toBe("Creature Land");
    expect(importPatchTypeLine(patch)).toBe("Creature Land — Forest Dryad");
  });
});
