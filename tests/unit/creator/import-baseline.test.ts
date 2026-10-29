import { describe, expect, it } from "vitest";
import { defaultValuesFor } from "@/lib/creator/card-fields";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";
import {
  IMPORT_BASELINE_BACK_KEYS,
  IMPORT_BASELINE_KEYS,
  importBaselineOf,
  importUnchangedPayload,
  matchesBaseline,
  NOT_COMPARED_FORM_KEYS,
} from "@/lib/creator/import-baseline";

// ---------------------------------------------------------------------------
// The creator's half of the import fingerprint (TODO DK2.5): a NEW card's
// save says `import_unchanged` by comparing every value a maker can set with
// the ones the last import settled on. "Edited" = ANY change to the card
// (owner 2026-10-29) — its frame, colour, rarity or crop alone too.
// ---------------------------------------------------------------------------

const SOURCE = "581b7327-3215-4a4f-b4ae-d9d4002ba882";

function imported(): FormValues {
  return {
    ...defaultValuesFor(null, [{ id: "g" } as never]),
    title: "Llanowar Elves",
    cost: "{G}",
    color_identity: ["green"],
    card_type: "creature",
    subtypes_text: "Elf Druid",
    rarity: "common",
    rules_text: "{T}: Add {G}.",
    power: "1",
    toughness: "1",
    artist_credit: "Chris Rahn",
    art_url: "https://example.supabase.co/storage/v1/object/public/card-art/u/elves.png",
    frame_style: { finish: "regular", template: "m15", crown: true, twoColor: true },
    source_scryfall_id: SOURCE,
  };
}

describe("every form key is a decision", () => {
  it("the front: compared or not, never both, none forgotten", () => {
    const keys = Object.keys(defaultValuesFor(null, [{ id: "g" } as never])).sort();
    const classified = [...IMPORT_BASELINE_KEYS, ...NOT_COMPARED_FORM_KEYS];
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual(keys);
  });

  it("the back face is compared whole", () => {
    expect([...IMPORT_BASELINE_BACK_KEYS].sort()).toEqual(Object.keys(EMPTY_BACK_FACE).sort());
  });

  it("what isn't compared is what isn't the card (and the source, compared on its own)", () => {
    expect([...NOT_COMPARED_FORM_KEYS].sort()).toEqual(
      ["deck_id", "game_system_id", "save_as_draft", "slug", "source_scryfall_id", "tags_text", "visibility"].sort(),
    );
  });
});

describe("importUnchangedPayload", () => {
  it("says nothing without an import this session", () => {
    expect(importBaselineOf(defaultValuesFor(null, [{ id: "g" } as never]))).toBeNull();
    expect(importUnchangedPayload(null, imported())).toEqual({});
  });

  it("unchanged while the card is the import's — visibility, decks, tags and the draft box aside", () => {
    const baseline = importBaselineOf(imported());
    expect(baseline?.scryfallId).toBe(SOURCE);
    expect(importUnchangedPayload(baseline, imported())).toEqual({ import_unchanged: true });
    expect(
      importUnchangedPayload(baseline, {
        ...imported(),
        visibility: "private",
        save_as_draft: true,
        deck_id: "deck-1",
        tags_text: "elves",
        slug: "my-elves",
        // Spaces round a value are what the save trims.
        title: "  Llanowar Elves ",
        // Key order inside an object is no change.
        frame_style: { twoColor: true, crown: true, template: "m15", finish: "regular" },
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
    ["the Types field emptied", { printed_types: "" }],
    ["a walker row", { loyalty_abilities: [{ cost: "+1", text: "Draw." }] }],
    ["a second face", { has_back_face: true }],
    // "Edited" = ANY change (owner 2026-10-29).
    ["frame alone", { frame_style: { finish: "regular", template: "m15nyx", crown: true, twoColor: true } }],
    ["finish alone", { frame_style: { finish: "foil", template: "m15", crown: true, twoColor: true } }],
    ["a frame switch alone", { frame_style: { finish: "regular", template: "m15", crown: false, twoColor: true } }],
    ["colour alone", { color_identity: ["blue"] }],
    ["rarity alone", { rarity: "mythic" }],
    ["the art's crop alone", { art_position: { ...imported().art_position, scale: 1.4 } }],
    ["the nickname", { nickname: "Elfie" }],
    ["the collector line", { collector_number: "168" }],
    ["the set icon", { set_icon_code: "dom" }],
    ["the watermark", { watermark: { kind: "mana", key: "g" } }],
    ["the footer", { footer_text: "Mine" }],
    ["the station's P/T tier", { station_pt_tier: 2 }],
  ] as const)("edited once the %s moves", (_what, change) => {
    const baseline = importBaselineOf(imported());
    expect(importUnchangedPayload(baseline, { ...imported(), ...change } as FormValues)).toEqual({ import_unchanged: false });
  });

  it("an emptied footer is a change of its own (a paid maker's prefilled footer, cleared)", () => {
    const paid = { ...imported(), footer_text: "Made by tester" };
    expect(importUnchangedPayload(importBaselineOf(paid), { ...paid, footer_text: "" })).toEqual({ import_unchanged: false });
  });

  it("a back face counts whole, and only while the card has one", () => {
    const withBack = { ...imported(), has_back_face: true, back_face: { ...EMPTY_BACK_FACE, title: "Back", color_identity: ["blue"] } };
    const baseline = importBaselineOf(withBack as FormValues);
    expect(importUnchangedPayload(baseline, withBack as FormValues)).toEqual({ import_unchanged: true });
    for (const change of [
      { rules_text: "New." },
      { color_identity: ["red"] },
      { art_position: { ...EMPTY_BACK_FACE.art_position, scale: 2 } },
    ]) {
      expect(
        importUnchangedPayload(baseline, { ...withBack, back_face: { ...withBack.back_face, ...change } } as FormValues),
      ).toEqual({ import_unchanged: false });
    }
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

describe("matchesBaseline (the creator re-takes the baseline only when it moved)", () => {
  it("true for the same values, false for a change or no baseline", () => {
    const baseline = importBaselineOf(imported());
    expect(matchesBaseline(baseline, imported())).toBe(true);
    expect(matchesBaseline(baseline, { ...imported(), rarity: "rare" })).toBe(false);
    expect(matchesBaseline(null, imported())).toBe(false);
  });
});
