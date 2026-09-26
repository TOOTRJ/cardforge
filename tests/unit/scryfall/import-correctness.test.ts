import { describe, expect, it } from "vitest";
import printings from "./fixtures/import-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  mapScryfallToFormPatch,
  parseTypeLine,
} from "@/lib/scryfall/import-mapper";

// ---------------------------------------------------------------------------
// Import correctness (TODO 1.1, 1.2, 1.3, 1.7, 1.14): what a NEW import of a
// real printing produces — the fields the schema keeps, the colour the frame
// is dressed in, the kind / card type / supertype words and the frame.
//
// Fixtures are real Scryfall payloads (/cards/named and /cards/:id, captured
// once on 2026-09-26), trimmed to identity + the fields the importer reads,
// and parsed through the same zod schema the routes use — no network in
// tests. Keys are "set-collector_number".
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printings;

const printing = (key: PrintingKey): ScryfallCard =>
  scryfallCardSchema.parse(printings[key]);

describe("scryfallCardSchema — the full frame vocabulary (TODO 1.1)", () => {
  it("keeps the per-face colours, colour indicator and artist (the face schema stripped them)", () => {
    // Ajani, Nacatl Pariah MH3 #237: a white front, a red-white back whose
    // colours come from its indicator.
    const ajani = printing("mh3-237");
    const [front, back] = ajani.card_faces ?? [];
    expect(front.colors).toEqual(["W"]);
    expect(front.color_indicator).toBeUndefined();
    expect(back.colors).toEqual(["R", "W"]);
    expect(back.color_indicator).toEqual(["R", "W"]);
    expect(front.artist).toBe("Chris Rallis");
    // Transform cards carry no card-level colours at all.
    expect(ajani.colors).toBeUndefined();
    // Fire // Ice DMR #215: split faces have no colours of their own, but
    // each half has its own artist.
    const fireIce = printing("dmr-215");
    expect(fireIce.card_faces?.map((f) => f.colors)).toEqual([undefined, undefined]);
    expect(fireIce.card_faces?.map((f) => f.artist)).toEqual(["David Martin", "Franz Vohwinkel"]);
  });

  it("types the printing-level fields", () => {
    const tower = printing("msc-233");
    expect(tower.produced_mana).toEqual(["B", "G", "R", "U", "W"]);
    expect(tower.set_type).toBe("commander");
    expect(tower.lang).toBe("en");
    expect(tower.finishes).toEqual(["nonfoil", "foil"]);
    const arbor = printing("dsc-273");
    expect(arbor.color_indicator).toEqual(["G"]);
    expect(printing("m21-239").security_stamp).toBe("oval");
    expect(printing("m21-239").collector_number).toBe("239");
  });

  it("parses every other 1.1 field from a payload that carries them", () => {
    const parsed = scryfallCardSchema.parse({
      id: "x",
      name: "Godzilla, King of the Monsters",
      flavor_name: "Godzilla, King of the Monsters",
      watermark: "orzhov",
      set_type: "masterpiece",
      security_stamp: "triangle",
      card_faces: [
        { name: "A", watermark: "set", layout: "reversible_card", colors: [] },
        { name: "B", layout: "reversible_card" },
      ],
    });
    expect(parsed.flavor_name).toBe("Godzilla, King of the Monsters");
    expect(parsed.watermark).toBe("orzhov");
    expect(parsed.set_type).toBe("masterpiece");
    expect(parsed.security_stamp).toBe("triangle");
    expect(parsed.card_faces?.[0]).toMatchObject({ watermark: "set", layout: "reversible_card", colors: [] });
  });

  it("keeps parsing an older cached shape without any of them", () => {
    const parsed = scryfallCardSchema.parse({
      id: "x",
      name: "Bare",
      card_faces: [{ name: "Front" }, { name: "Back" }],
    });
    expect(parsed.produced_mana).toBeUndefined();
    expect(parsed.card_faces?.[0].colors).toBeUndefined();
  });

  it("accepts a new enum value it has never seen (plain strings, never enums)", () => {
    const parsed = scryfallCardSchema.parse({
      id: "x",
      name: "Future",
      set_type: "some_new_type",
      security_stamp: "hexagon",
      lang: "qya",
    });
    expect(parsed.set_type).toBe("some_new_type");
  });
});

describe("Kindred stays a supertype word (TODO 1.14)", () => {
  // [fixture, supertype, card_type, subtypes, frame]
  const cases: Array<[PrintingKey, string | undefined, string, string | undefined, string]> = [
    // Bitterblossom MOR #58 — "Kindred Enchantment — Faerie" (2003 frame).
    ["mor-58", "Kindred", "enchantment", "Faerie", "modern"],
    // Crib Swap LRW #11 — "Kindred Instant — Shapeshifter".
    ["lrw-11", "Kindred", "instant", "Shapeshifter", "modern"],
    // Kindred Discovery C17 #11 — only the NAME says Kindred: a plain
    // Enchantment.
    ["c17-11", undefined, "enchantment", undefined, "m15"],
  ];

  it.each(cases)("%s imports as %s %s", (key, supertype, cardType, subtypes, frame) => {
    const patch = mapScryfallToFormPatch(printing(key));
    expect(patch.supertype).toBe(supertype);
    expect(patch.card_type).toBe(cardType);
    expect(patch.kind).toBe(cardType);
    expect(patch.subtypes_text).toBe(subtypes);
    expect(patch.frame_template).toBe(frame);
  });

  it("reads the old Tribal spelling the same way", () => {
    expect(parseTypeLine("Tribal Sorcery — Goblin")).toEqual({
      supertype: "Tribal",
      card_type: "sorcery",
      subtypes_text: "Goblin",
    });
  });

  it("never produces the legacy 'spell' card type", () => {
    // A bare Kindred/Tribal word is a supertype with no card type — never
    // the legacy "spell" the dead tribal mapping pointed at.
    expect(parseTypeLine("Tribal")).toEqual({ supertype: "Tribal" });
    expect(parseTypeLine("Kindred — Elf")).toEqual({ supertype: "Kindred", subtypes_text: "Elf" });
    for (const key of Object.keys(printings) as PrintingKey[]) {
      const patch = mapScryfallToFormPatch(printing(key));
      expect(patch.card_type).not.toBe("spell");
      expect(patch.back_face?.card_type).not.toBe("spell");
    }
  });
});
