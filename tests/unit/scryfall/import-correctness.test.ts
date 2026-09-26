import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printings from "./fixtures/import-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  frameTemplateFromScryfall,
  kindFromScryfall,
  mapScryfallToFormPatch,
  parseTypeLine,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import { KIND_DEFS, type FrameColorKey } from "@/lib/creator/card-kinds";
import {
  importFrameCandidates,
  resolvePublishedFrame,
} from "@/lib/creator/frame-resolve";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import { getFrameProfile } from "@/lib/cards/template-layout";
import {
  frameMasterKey,
  pickFrameColorKey,
} from "@/components/cards/frame-layer";
import { DEFAULT_FRAME_TEMPLATE, type CardType, type FrameTemplate } from "@/types/card";

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

// ---------------------------------------------------------------------------
// Where an import LANDS in the creator: the form applies the kind, then asks
// resolvePublishedFrame for importFrameCandidates(…) in the imported colour
// (components/creator/card-creator-form.tsx, handleScryfallImport). Run
// against the frames production has verified — supabase/seed.sql mirrors
// them — so these say what a user gets today.
// ---------------------------------------------------------------------------

function productionVerifiedKeys(): Set<string> {
  const sql = readFileSync(join(process.cwd(), "supabase/seed.sql"), "utf8");
  const block = /-- frame_reviews:begin\n([\s\S]*?)-- frame_reviews:end/
    .exec(sql)?.[1]
    .replace(/--.*$/gm, "");
  if (!block) throw new Error("frame_reviews block missing from seed.sql");
  const everyColour = /unnest\(array\[([^\]]*)\]\)\s+as t/.exec(block)?.[1] ?? "";
  const keys = new Set<string>();
  for (const [, template] of everyColour.matchAll(/'([^']+)'/g)) {
    for (const colour of ["w", "u", "b", "r", "g", "c", "m"]) {
      keys.add(frameComboKey(template as FrameTemplate, colour));
    }
  }
  for (const [, template, colour] of block.matchAll(/\('([^']+)',\s*'([wubrgcm])',\s*true/g)) {
    keys.add(frameComboKey(template as FrameTemplate, colour));
  }
  return keys;
}
const PROD_VERIFIED = productionVerifiedKeys();

function landing(patch: ScryfallImportPatch): { template: FrameTemplate; colorKey: string } {
  const kind = patch.kind!;
  const def = KIND_DEFS[kind];
  // applyKindProgrammatic lands a layout kind on its template first.
  const wanted = patch.frame_template ?? def.layoutTemplates?.[0] ?? DEFAULT_FRAME_TEMPLATE;
  const cardType = (patch.card_type ?? def.cardType) as CardType;
  const colorKey = pickFrameColorKey(patch.color_identity);
  const resolution = resolvePublishedFrame({
    kind,
    candidates: importFrameCandidates({ wanted, cardType, supertype: patch.supertype }),
    colorKey: colorKey as FrameColorKey,
    verifiedKeys: PROD_VERIFIED,
    prefer: "frame",
  });
  if (resolution.status === "unavailable" || resolution.status === "colour-switched") {
    throw new Error(`${patch.title}: ${resolution.status}`);
  }
  return { template: resolution.template, colorKey };
}

describe("type-line + layout precedence (TODO 1.3)", () => {
  // [fixture, kind, card_type, supertype, subtypes, the printing's frame]
  const cases: Array<
    [PrintingKey, string, CardType, string | undefined, string | undefined, FrameTemplate | undefined]
  > = [
    // Controls: an ordinary mono creature and a gold creature.
    ["dom-168", "creature", "creature", undefined, "Elf, Druid", "m15"],
    ["iko-211", "creature", "creature", undefined, "Faerie, Dragon", "m15"],
    // Land beats creature: Dryad Arbor DSC #273 is dressed as a land, and
    // "Creature" stays a word in front.
    ["dsc-273", "land", "land", "Creature", "Forest, Dryad", "m15land"],
    // Creature beats the rest and keeps "Artifact" (TODO 1.7): Solemn
    // Simulacrum M21 #239 and Baleful Strix 2XM #191 land on the M15
    // artifact frame, Juggernaut LEA #255 on Alpha.
    ["m21-239", "creature", "creature", "Artifact", "Golem", "m15artifact"],
    ["2xm-191", "creature", "creature", "Artifact", "Bird", "m15artifact"],
    ["lea-255", "creature", "creature", "Artifact", "Juggernaut", "agclassic"],
    // An Artifact Land stays a land: Seat of the Synod MRD #283 / EOC #176.
    ["mrd-283", "land", "land", "Artifact", undefined, "modernland"],
    ["eoc-176", "land", "land", "Artifact", undefined, "m15land"],
    // Artifact tokens: Treasure TMSH #27, Thopter TKLD #7.
    ["tmsh-27", "token", "token", "Artifact", "Treasure", "m15tokenartifact"],
    ["tkld-7", "token", "token", "Artifact Creature", "Thopter", "m15tokenartifact"],
    // A transforming Saga (layout "transform") is a saga by its front face.
    ["neo-141", "saga", "enchantment", undefined, "Saga", undefined],
    // A Room (layout "split") is not a split card: its first door is an
    // enchantment (m15), the second door rides as the back face.
    ["dsk-43", "enchantment", "enchantment", undefined, "Room", "m15"],
    ["dsk-227", "enchantment", "enchantment", undefined, "Room", "m15"],
    // Class and Case take their front face's standard kind.
    ["afr-180", "enchantment", "enchantment", undefined, "Class", "m15"],
    ["mkm-155", "enchantment", "enchantment", undefined, "Case", "m15"],
    // An Omen (layout "adventure" on Scryfall) is the adventure layout.
    ["tdm-40", "adventure", "creature", undefined, "Dragon", undefined],
    // Real split / adventure / flip cards keep their layouts.
    ["dmr-215", "split", "instant", undefined, undefined, undefined],
    ["eld-115", "adventure", "creature", undefined, "Giant", undefined],
    ["chk-202", "flip", "creature", undefined, "Human, Monk", undefined],
    // Double-faced fronts.
    ["isd-51", "creature", "creature", undefined, "Human, Wizard", "modern"],
    ["mh3-237", "creature", "creature", "Legendary", "Cat, Warrior", "m15"],
    ["khm-114", "creature", "creature", "Legendary", "God", "m15"],
    ["znr-259", "land", "land", undefined, undefined, "m15land"],
    ["soi-281", "land", "land", undefined, undefined, "m15land"],
    // Devoid re-dresses; a colourless Eldrazi without devoid doesn't.
    ["ogw-13", "creature", "creature", undefined, "Eldrazi", "m15devoid"],
    ["ogw-9", "creature", "creature", undefined, "Eldrazi", "m15"],
  ];

  it.each(cases)("%s → %s (%s, supertype %s, subtypes %s) on %s", (key, kind, cardType, supertype, subtypes, frame) => {
    const patch = mapScryfallToFormPatch(printing(key));
    expect(patch.kind).toBe(kind);
    expect(patch.card_type).toBe(cardType);
    expect(patch.supertype).toBe(supertype);
    expect(patch.subtypes_text).toBe(subtypes);
    expect(patch.frame_template).toBe(frame);
    // The kind's own card type is what the form writes; the patch agrees.
    expect(KIND_DEFS[patch.kind!].cardType).toBe(cardType);
  });

  it("the second door / face / spell page rides as the back face", () => {
    const room = mapScryfallToFormPatch(printing("dsk-227"));
    expect(room.title).toBe("Restricted Office");
    expect(room.back_face).toMatchObject({
      title: "Lecture Hall",
      card_type: "enchantment",
      subtypes_text: "Room",
    });
    const fable = mapScryfallToFormPatch(printing("neo-141"));
    expect(fable.back_face).toMatchObject({
      title: "Reflection of Kiki-Jiki",
      card_type: "creature",
      supertype: "Enchantment",
      subtypes_text: "Goblin, Shaman",
    });
    const omen = mapScryfallToFormPatch(printing("tdm-40"));
    expect(omen.back_face).toMatchObject({
      title: "Skimming Strike",
      card_type: "instant",
      subtypes_text: "Omen",
    });
  });

  it("reads the type line against a layout kind's card type (Urza's Saga)", () => {
    // Urza's Saga is layout "saga" and an "Enchantment Land": it lands on
    // the saga frame as an enchantment with "Land" in front — never
    // "Enchantment Enchantment".
    const urza = scryfallCardSchema.parse({
      id: "x",
      name: "Urza's Saga",
      layout: "saga",
      frame: "2015",
      type_line: "Enchantment Land — Urza's Saga",
      colors: [],
      color_identity: [],
    });
    const patch = mapScryfallToFormPatch(urza);
    expect(patch.kind).toBe("saga");
    expect(patch.card_type).toBe("enchantment");
    expect(patch.supertype).toBe("Land");
    expect(patch.subtypes_text).toBe("Urza's, Saga");
    // Without a card type to prefer, land still outranks enchantment.
    expect(parseTypeLine("Enchantment Land — Urza's Saga").card_type).toBe("land");
    // A preferred type the line doesn't carry is ignored.
    expect(parseTypeLine("Sorcery", { cardType: "instant" }).card_type).toBe("sorcery");
  });

  it("artifact outranks enchantment, keeping the printed order in front", () => {
    expect(parseTypeLine("Legendary Enchantment Artifact")).toEqual({
      supertype: "Legendary Enchantment",
      card_type: "artifact",
    });
    expect(parseTypeLine("Legendary Artifact Creature — Golem")).toEqual({
      supertype: "Legendary Artifact",
      card_type: "creature",
      subtypes_text: "Golem",
    });
  });

  it("a frame effect wins over the type words (a snow Artifact Creature is snow)", () => {
    const icehide = scryfallCardSchema.parse({
      id: "x",
      name: "Icehide Golem",
      layout: "normal",
      frame: "2015",
      frame_effects: ["snow"],
      type_line: "Snow Artifact Creature — Golem",
    });
    expect(frameTemplateFromScryfall(icehide)).toBe("m15snow");
    expect(mapScryfallToFormPatch(icehide).supertype).toBe("Snow Artifact");
  });

  it("a future Omen layout value is the adventure layout too", () => {
    expect(kindFromScryfall(scryfallCardSchema.parse({ id: "x", name: "Omen", layout: "omen", type_line: "Creature — Dragon // Instant — Omen" }))).toBe("adventure");
  });
});

describe("where an import lands in the creator (production's verified frames)", () => {
  it("an Artifact Creature lands on the M15 artifact frame, even from Alpha", () => {
    // M21 Solemn: the printing's own frame.
    expect(landing(mapScryfallToFormPatch(printing("m21-239")))).toEqual({ template: "m15artifact", colorKey: "c" });
    // LEA Juggernaut: agclassic isn't published, so it falls forward to the
    // artifact frame it is — never the grey M15 spell frame.
    expect(landing(mapScryfallToFormPatch(printing("lea-255")))).toEqual({ template: "m15artifact", colorKey: "c" });
  });

  it("on the Alpha frame an imported Artifact Creature paints the brown artifact card (4.31)", () => {
    const patch = mapScryfallToFormPatch(printing("lea-255"));
    expect(
      frameMasterKey(getFrameProfile("agclassic"), patch.color_identity, {
        cardType: patch.card_type,
        supertype: patch.supertype,
      }),
    ).toBe("a");
  });

  it("artifact tokens, lands and transforming Sagas land on their own frames", () => {
    expect(landing(mapScryfallToFormPatch(printing("tmsh-27"))).template).toBe("m15tokenartifact");
    expect(landing(mapScryfallToFormPatch(printing("tkld-7"))).template).toBe("m15tokenartifact");
    expect(landing(mapScryfallToFormPatch(printing("dsc-273"))).template).toBe("m15land");
    expect(landing(mapScryfallToFormPatch(printing("eoc-176"))).template).toBe("m15land");
    expect(landing(mapScryfallToFormPatch(printing("neo-141"))).template).toBe("saga");
    // A Room is no longer a split card.
    expect(landing(mapScryfallToFormPatch(printing("dsk-43"))).template).toBe("m15");
  });
});
