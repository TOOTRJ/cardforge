import { describe, expect, it } from "vitest";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";
import {
  IMPORT_BASELINE_BACK_KEYS,
  IMPORT_BASELINE_KEYS,
  importBaselineOf,
  importUnchangedPayload,
  NOT_PRINTED_BACK_FORM_KEYS,
  NOT_PRINTED_FORM_KEYS,
} from "@/lib/creator/import-baseline";

// ---------------------------------------------------------------------------
// The creator's half of the import fingerprint (TODO DK2.5): a NEW card's
// save says `import_unchanged` by comparing its printed form values with the
// ones the last import landed with.
// ---------------------------------------------------------------------------

const SOURCE = "581b7327-3215-4a4f-b4ae-d9d4002ba882";

function imported(): FormValues {
  return {
    ...defaultValuesFor(null, [{ id: "g" } as never]),
    title: "Llanowar Elves",
    cost: "{G}",
    card_type: "creature",
    subtypes_text: "Elf Druid",
    rules_text: "{T}: Add {G}.",
    power: "1",
    toughness: "1",
    artist_credit: "Chris Rahn",
    art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/elves.png",
    source_scryfall_id: SOURCE,
  };
}

describe("every form key is a decision", () => {
  it("the front: printed (compared) or not, never both, none forgotten", () => {
    const keys = Object.keys(defaultValuesFor(null, [{ id: "g" } as never])).sort();
    const classified = [...IMPORT_BASELINE_KEYS, ...NOT_PRINTED_FORM_KEYS];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(keys);
  });

  it("the back face, the same", () => {
    const keys = Object.keys(EMPTY_BACK_FACE).sort();
    const classified = [...IMPORT_BASELINE_BACK_KEYS, ...NOT_PRINTED_BACK_FORM_KEYS];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(keys);
  });
});

describe("importUnchangedPayload", () => {
  it("says nothing without an import this session", () => {
    expect(importBaselineOf(defaultValuesFor(null, [{ id: "g" } as never]))).toBeNull();
    expect(importUnchangedPayload(null, imported())).toEqual({});
  });

  it("unchanged while every printed field is the import's — frame, colour, rarity, visibility and decks aside", () => {
    const baseline = importBaselineOf(imported());
    expect(baseline?.scryfallId).toBe(SOURCE);
    expect(importUnchangedPayload(baseline, imported())).toEqual({ import_unchanged: true });
    expect(
      importUnchangedPayload(baseline, {
        ...imported(),
        frame_style: { finish: "foil", template: "m15nyx" },
        color_identity: ["blue"],
        rarity: "mythic",
        visibility: "private",
        save_as_draft: true,
        deck_id: "deck-1",
        tags_text: "elves",
        // Spaces round a value are what the save trims.
        title: "  Llanowar Elves ",
      } as FormValues),
    ).toEqual({ import_unchanged: true });
  });

  it.each([
    ["title", { title: "Llanowar Elder" }],
    ["rules text", { rules_text: "{T}: Add {G}{G}." }],
    ["art", { art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/mine.png" }],
    ["stats", { power: "2" }],
    ["subtypes", { subtypes_text: "Elf" }],
    ["the Types field", { printed_types: "Creature" }],
    ["a walker row", { loyalty_abilities: [{ cost: "+1", text: "Draw." }] }],
    ["a second face", { has_back_face: true }],
  ] as const)("changed once the %s moves", (_what, change) => {
    const baseline = importBaselineOf(imported());
    expect(importUnchangedPayload(baseline, { ...imported(), ...change } as FormValues)).toEqual({ import_unchanged: false });
  });

  it("a back face counts only while the card has one", () => {
    const withBack = { ...imported(), has_back_face: true, back_face: { ...EMPTY_BACK_FACE, title: "Back" } };
    const baseline = importBaselineOf(withBack);
    expect(importUnchangedPayload(baseline, withBack)).toEqual({ import_unchanged: true });
    expect(importUnchangedPayload(baseline, { ...withBack, back_face: { ...withBack.back_face, rules_text: "New." } })).toEqual({
      import_unchanged: false,
    });
    // Off, the hidden back's values don't count.
    const off = importBaselineOf({ ...imported(), back_face: { ...EMPTY_BACK_FACE, title: "Hidden" } });
    expect(importUnchangedPayload(off, { ...imported(), back_face: { ...EMPTY_BACK_FACE, title: "Changed" } })).toEqual({
      import_unchanged: true,
    });
  });

  it("says nothing once the source was changed or cleared (the server then stores no fingerprint)", () => {
    const baseline = importBaselineOf(imported());
    expect(importUnchangedPayload(baseline, { ...imported(), source_scryfall_id: "" })).toEqual({});
    expect(importUnchangedPayload(baseline, { ...imported(), source_scryfall_id: "7bbd2cab-538e-4932-a828-150e3e9d52ad" })).toEqual({});
  });
});
