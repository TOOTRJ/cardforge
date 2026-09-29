import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import printings from "./fixtures/import-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  frameColorsFromScryfall,
  frameTemplateFromScryfall,
  frontFaceColors,
  kindFromScryfall,
  mapScryfallToFormPatch,
  parseTypeLine,
  referenceColorIdentity,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import { toResolvedCardData } from "@/lib/decks/import-resolution";
import { KIND_DEFS, importedCardTypeForKind } from "@/lib/creator/card-kinds";
import { finalizeImportMatch, resolveImportFrame } from "@/lib/creator/frame-resolve";
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
// Where an import LANDS in the creator: the form applies the kind, then calls
// resolveImportFrame — the same helper this runs — with the patch and the
// form after the kind change (components/creator/card-creator-form.tsx,
// handleScryfallImport). Run against the frames production has verified —
// supabase/seed.sql mirrors them — so these say what a user gets today.
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

function landing(
  patch: ScryfallImportPatch,
  verifiedKeys: ReadonlySet<string> = PROD_VERIFIED,
): { template: FrameTemplate; colorKey: string; status: string } {
  const kind = patch.kind!;
  const def = KIND_DEFS[kind];
  const { colorKey, resolution } = resolveImportFrame({
    patch,
    kind,
    // applyKindProgrammatic lands a layout kind on its template first and
    // writes the kind's card type.
    current: {
      template: def.layoutTemplates?.[0] ?? DEFAULT_FRAME_TEMPLATE,
      cardType: def.cardType,
      colors: [],
    },
    verifiedKeys,
  });
  if (resolution.status === "unavailable" || resolution.status === "colour-switched") {
    throw new Error(`${patch.title}: ${resolution.status}`);
  }
  return { template: resolution.template, colorKey, status: resolution.status };
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
    // Snow lands print the snow LAND frame (KHM, frame_effects ∋ snow).
    ["khm-278", "land", "land", "Basic Snow", "Island", "m15snowland"],
    ["khm-249", "land", "land", "Snow", "Forest, Plains", "m15snowland"],
    // Enchantment beats artifact: Bident of Thassa THS #42 prints the Nyx
    // ENCHANTMENT frame and keeps "Artifact" as a word in front. The
    // signature registry (1.4) asks for Nyx, the nearest PipGlyph frame to
    // THS's 2003 Nyx (it was the plain 2003 frame before).
    ["ths-42", "enchantment", "enchantment", "Legendary Artifact", undefined, "nyx"],
    // Layout kinds read the type line against their own card type: Urza's
    // Saga keeps "Land", a FIN Summon keeps "Creature" (the renderers print
    // them BEFORE the card type — a TODO 1.3 renderer leftover).
    ["mh2-259", "saga", "enchantment", "Land", "Urza's, Saga", undefined],
    ["fin-1", "saga", "enchantment", "Creature", "Saga, Dragon", undefined],
    // A reversible card is its front: one land. SLD #2794 is a black-bordered
    // TEXTLESS promo, so the registry (1.19) asks for the textless land frame
    // (nearest, 4.42); unverified, it still lands on m15land (below).
    ["sld-2794", "land", "land", undefined, undefined, "m15textlessland"],
    // A layout kind keeps the printed card type its template can draw (TODO
    // 1.21): an Enchantment adventurer, an Instant aftermath, a Sorcery
    // split card.
    ["woe-38", "adventure", "enchantment", undefined, undefined, undefined],
    ["akh-211", "aftermath", "instant", undefined, undefined, undefined],
    ["dgm-123", "split", "sorcery", undefined, undefined, undefined],
    // The longest printed name (TODO 1.12), a silver-bordered 2003 frame.
    ["unh-107", "creature", "creature", undefined, "Elemental", "modern"],
  ];

  it.each(cases)("%s → %s (%s, supertype %s, subtypes %s) on %s", (key, kind, cardType, supertype, subtypes, frame) => {
    const patch = mapScryfallToFormPatch(printing(key));
    expect(patch.kind).toBe(kind);
    expect(patch.card_type).toBe(cardType);
    expect(patch.supertype).toBe(supertype);
    expect(patch.subtypes_text).toBe(subtypes);
    expect(patch.frame_template).toBe(frame);
    // The card type the form writes for the kind is the patch's (TODO 1.21:
    // a layout kind no longer writes its own over the printed one).
    expect(importedCardTypeForKind(patch.kind!, patch.card_type)).toBe(cardType);
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
    // Urza's Saga MH2 #259 is layout "saga" and an "Enchantment Land": it
    // lands on the saga frame as an enchantment that keeps "Land" — never
    // "Enchantment Enchantment", never losing the word. (The renderers print
    // it "Land Enchantment — Urza's Saga", supertype first: a renderer
    // leftover, TODO 1.3.)
    const patch = mapScryfallToFormPatch(printing("mh2-259"));
    expect(patch.kind).toBe("saga");
    expect(patch.card_type).toBe("enchantment");
    expect(patch.supertype).toBe("Land");
    expect(patch.subtypes_text).toBe("Urza's, Saga");
    // Without a card type to prefer, land still outranks enchantment.
    expect(parseTypeLine("Enchantment Land — Urza's Saga").card_type).toBe("land");
    // A preferred type the line doesn't carry is ignored.
    expect(parseTypeLine("Sorcery", { cardType: "instant" }).card_type).toBe("sorcery");
  });

  it("enchantment outranks artifact, keeping the other words in front", () => {
    // Bident of Thassa THS #42 prints the (Nyx) enchantment frame.
    expect(parseTypeLine("Legendary Enchantment Artifact")).toEqual({
      supertype: "Legendary Artifact",
      card_type: "enchantment",
    });
    expect(parseTypeLine("Artifact Enchantment — Saga").card_type).toBe("enchantment");
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
    expect(landing(mapScryfallToFormPatch(printing("m21-239")))).toEqual({ template: "m15artifact", colorKey: "c", status: "exact" });
    // LEA Juggernaut: agclassic isn't published, so it falls forward to the
    // artifact frame it is — never the grey M15 spell frame (the form toasts
    // the switch).
    expect(landing(mapScryfallToFormPatch(printing("lea-255")))).toEqual({ template: "m15artifact", colorKey: "c", status: "frame-switched" });
    // Where agclassic IS verified (the local e2e seed adds it), the same
    // import lands on the Alpha frame itself.
    expect(
      landing(mapScryfallToFormPatch(printing("lea-255")), new Set([...PROD_VERIFIED, frameComboKey("agclassic", "c")])),
    ).toEqual({ template: "agclassic", colorKey: "c", status: "exact" });
  });

  it("an Artifact Creature keeps its Artifact word into the frame choice", () => {
    // Without the supertype the same import would fall to the grey spell
    // frame: the helper the form calls must read it.
    const patch = mapScryfallToFormPatch(printing("lea-255"));
    expect(landing({ ...patch, supertype: undefined }).template).toBe("m15");
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
    // KHM snow lands land on the verified snow land frame.
    expect(landing(mapScryfallToFormPatch(printing("khm-278")))).toEqual({ template: "m15snowland", colorKey: "u", status: "exact" });
    expect(landing(mapScryfallToFormPatch(printing("khm-249")))).toEqual({ template: "m15snowland", colorKey: "m", status: "exact" });
    // Bident of Thassa is an enchantment: it asks for Nyx (the signature
    // registry), which isn't verified in blue, so it falls forward to M15 —
    // never the artifact frame — and the creator's toast names the switch.
    const bident = resolveImportFrame({
      patch: mapScryfallToFormPatch(printing("ths-42")),
      kind: "enchantment",
      current: { template: DEFAULT_FRAME_TEMPLATE, cardType: "enchantment", colors: [] },
      verifiedKeys: PROD_VERIFIED,
    });
    expect(bident.resolution).toEqual({ status: "frame-switched", template: "m15", colorKey: "u", fromTemplate: "nyx" });
    // Once nyx/u is verified, Bident lands on it.
    expect(
      landing(mapScryfallToFormPatch(printing("ths-42")), new Set([...PROD_VERIFIED, frameComboKey("nyx", "u")])),
    ).toEqual({ template: "nyx", colorKey: "u", status: "exact" });
  });
});

describe("colour from the front face (TODO 1.2)", () => {
  // [fixture, front-face letters, frame colour key, Scryfall's Commander
  // identity (for contrast: the old import read it first)]
  const cases: Array<[PrintingKey, string[], string, string[]]> = [
    // Controls: mono and gold single-faced cards are unchanged.
    ["dom-168", ["G"], "g", ["G"]],
    ["iko-211", ["R", "U"], "m", ["R", "U"]],
    ["2xm-191", ["B", "U"], "m", ["B", "U"]],
    // Transform DFCs: the front's colours. Ajani's R/W identity comes from
    // its back face; the front is white.
    ["isd-51", ["U"], "u", ["U"]],
    ["ori-23", ["W"], "w", ["W"]],
    ["mh3-237", ["W"], "w", ["R", "W"]],
    ["neo-141", ["R"], "r", ["R"]],
    // Modal DFCs: Valki is black (Tibalt is the red half); Brightclimb
    // Pathway's front taps for {W} only.
    ["khm-114", ["B"], "b", ["B", "R"]],
    ["znr-259", ["W"], "w", ["B", "W"]],
    // Westvale Abbey: a colourless land. Its black identity is Ormendahl's.
    ["soi-281", [], "c", ["B"]],
    // Colourless cards stay colourless, artifacts and tokens included — a
    // Treasure produces every colour but isn't a land.
    ["ogw-9", [], "c", []],
    ["lea-255", [], "c", []],
    ["m21-239", [], "c", []],
    ["tmsh-27", [], "c", []],
    ["tkld-7", [], "c", []],
    // Devoid: dressed by its mana (Eldrazi Displacer {2}{W}).
    ["ogw-13", ["W"], "w", ["W"]],
    // Lands (every verdict below checked on the printing's Scryfall scan).
    // A colour indicator wins (Dryad Arbor); otherwise the land frame follows
    // the mana the land PRODUCES.
    ["dsc-273", ["G"], "g", ["G"]],
    ["mrd-283", ["U"], "u", ["U"]],
    ["eoc-176", ["U"], "u", ["U"]],
    ["m10-227", ["G", "R"], "m", ["G", "R"]],
    ["shm-275", ["W"], "w", ["W"]],
    // A utility land that taps for {C} prints colourless, although its
    // activation costs are coloured: Kessig Wolf Run ISD #243, Gavony
    // Township ISD #239, Hanweir Battlements EMN #204.
    ["isd-243", [], "c", ["G", "R"]],
    ["isd-239", [], "c", ["G", "W"]],
    ["emn-204", [], "c", ["R"]],
    // Command Tower MSC #233 (the curated m15land/m reference) taps for any
    // colour: gold, although its identity is empty. So does every such land
    // from the 2003 frame on (Command Tower C13 #281, the Cavern of Souls
    // Expedition ZNE #22, Nykthos THS #223; the reversible Command Tower
    // SLD #2794 too) — but not on the 1997 frame, where Path of Ancestry
    // BRC #192 prints the plain land frame.
    ["msc-233", ["B", "G", "R", "U", "W"], "m", []],
    ["c13-281", ["B", "G", "R", "U", "W"], "m", []],
    ["zne-22", ["B", "G", "R", "U", "W"], "m", []],
    ["ths-223", ["B", "G", "R", "U", "W"], "m", []],
    ["sld-2794", ["B", "G", "R", "U", "W"], "m", []],
    ["brc-192", [], "c", []],
    // A mono land that also taps for the chosen colour prints gold (Thriving
    // Bluff JMP #33, Cliffgate CLB #350)…
    ["jmp-33", ["B", "G", "R", "U", "W"], "m", ["R"]],
    ["clb-350", ["B", "G", "R", "U", "W"], "m", ["R"]],
    // …but the Vivid lands print their own colour (LAND_FRAME_OVERRIDES).
    ["lrw-275", ["R"], "r", ["R"]],
    ["c17-289", ["R"], "r", ["R"]],
    ["ncc-446", ["W"], "w", ["W"]],
    // Grey although produced_mana lists colours (LAND_FRAME_OVERRIDES): a
    // one-shot or conditional any-colour ability beside a {C} tap, and
    // Urborg's Swamp-granting text. Yavimaya, its Forest twin, prints green.
    ["ogw-170", [], "c", []],
    ["tsp-274", [], "c", []],
    ["one-254", [], "c", []],
    ["c13-326", [], "c", []],
    ["uma-254", [], "c", []],
    ["mh2-261", ["G"], "g", []],
    // Snow lands are dressed like any other land.
    ["khm-278", ["U"], "u", ["U"]],
    ["khm-249", ["G", "W"], "m", ["G", "W"]],
    // Urza's Saga taps for {C}: colourless. Bident and a colourless FIN
    // Summon are their printed colours.
    ["mh2-259", [], "c", []],
    ["ths-42", ["U"], "u", ["U"]],
    ["fin-1", [], "c", []],
    // An adventurer is its creature's colour (Burn Together is red).
    ["woe-221", ["B"], "b", ["B", "R"]],
    ["eld-115", ["R"], "r", ["R"]],
    ["tdm-40", ["U"], "u", ["U"]],
    // A split card is both halves' (one frame paints both until 4.26).
    ["dmr-215", ["R", "U"], "m", ["R", "U"]],
    ["chk-202", ["G"], "g", ["G"]],
    // A Room imports its first door: Restricted Office is white.
    ["dsk-227", ["W"], "w", ["U", "W"]],
    ["dsk-43", ["U"], "u", ["U"]],
    ["afr-180", ["G"], "g", ["G"]],
    ["mkm-155", ["G"], "g", ["G"]],
    ["mor-58", ["B"], "b", ["B"]],
    ["lrw-11", ["W"], "w", ["W"]],
    ["c17-11", ["U"], "u", ["U"]],
    // TODO 1.21's layout cards: the adventurer's colour, both halves'.
    ["woe-38", ["W"], "w", ["W"]],
    ["akh-211", ["U"], "u", ["U"]],
    ["dgm-123", ["G", "U", "W"], "m", ["G", "U", "W"]],
    // TODO 1.12's longest name.
    ["unh-107", ["G"], "g", ["G"]],
  ];

  it("covers every fixture", () => {
    expect(cases.map(([key]) => key).sort()).toEqual(Object.keys(printings).sort());
  });

  it.each(cases)("%s → %j (frame %s; identity %j)", (key, letters, colorKey, identity) => {
    const card = printing(key);
    expect(frontFaceColors(card)).toEqual(letters);
    const patch = mapScryfallToFormPatch(card);
    expect(pickFrameColorKey(patch.color_identity)).toBe(colorKey);
    expect(frameColorsFromScryfall(card)).toEqual(patch.color_identity);
    // Scryfall's identity is untouched on the card itself.
    expect(card.color_identity).toEqual(identity);
  });

  it("frame-compare keeps a two-colour front's two colours", () => {
    expect(referenceColorIdentity(printing("iko-211"))).toEqual(["red", "blue"]);
    // A gold identity behind a mono front is the front's one colour.
    expect(referenceColorIdentity(printing("khm-114"))).toEqual(["black"]);
    expect(referenceColorIdentity(printing("msc-233"))).toEqual(["multicolor"]);
  });

  it("lands on the front face's frame colour in the creator", () => {
    const lands = (key: PrintingKey) => {
      const { template, colorKey } = landing(mapScryfallToFormPatch(printing(key)));
      return { template, colorKey };
    };
    expect(lands("mh3-237")).toEqual({ template: "m15", colorKey: "w" });
    expect(lands("khm-114")).toEqual({ template: "m15", colorKey: "b" });
    expect(lands("soi-281")).toEqual({ template: "m15land", colorKey: "c" });
    expect(lands("msc-233")).toEqual({ template: "m15land", colorKey: "m" });
    expect(lands("ogw-13")).toEqual({ template: "m15devoid", colorKey: "w" });
    expect(lands("isd-243")).toEqual({ template: "m15land", colorKey: "c" });
    expect(lands("c17-289")).toEqual({ template: "m15land", colorKey: "r" });
    expect(lands("jmp-33")).toEqual({ template: "m15land", colorKey: "m" });
    expect(lands("ogw-170")).toEqual({ template: "m15land", colorKey: "c" });
    expect(lands("sld-2794")).toEqual({ template: "m15land", colorKey: "m" });
  });

  it("reads the land override table for colourless single-faced lands only", () => {
    // A card with printed colours never reaches the land rule, whatever its
    // name.
    const fake = scryfallCardSchema.parse({
      id: "x",
      name: "Mirrex",
      layout: "normal",
      frame: "2015",
      type_line: "Artifact",
      colors: ["U"],
      color_identity: ["U"],
    });
    expect(frontFaceColors(fake)).toEqual(["U"]);
  });

  it("reads a multi-face land front's own mana, including a basic land type's", () => {
    const faces = (front: Record<string, unknown>) =>
      scryfallCardSchema.parse({
        id: "x",
        name: "Front // Back",
        layout: "modal_dfc",
        color_identity: ["B", "G"],
        card_faces: [
          { name: "Front", colors: [], ...front },
          { name: "Back", colors: ["B"], type_line: "Creature — Horror", mana_cost: "{B}" },
        ],
      });
    // A Forest face taps for {G} with no rules text (rule 305.6).
    expect(frontFaceColors(faces({ type_line: "Land — Forest" }))).toEqual(["G"]);
    // Hybrid and Phyrexian symbols count their colours; {C} doesn't.
    expect(frontFaceColors(faces({ type_line: "Land", oracle_text: "{T}: Add {C}.\n{G/P}, {T}: Draw a card." }))).toEqual(["G"]);
    // A colourless non-land front stays colourless whatever the back is.
    expect(frontFaceColors(faces({ type_line: "Artifact", mana_cost: "{2}" }))).toEqual([]);
  });

  it("keeps Scryfall's identity where Commander identity lives (the deck importer)", () => {
    // The design check: the card's `color_identity` field is its frame
    // colour, never Commander identity. Deck entries keep the real identity
    // from Scryfall directly, so neither meaning is corrupted.
    for (const key of ["mh3-237", "soi-281", "khm-114", "msc-233"] as const) {
      expect(toResolvedCardData(printing(key)).color_identity).toEqual(
        [...printing(key).color_identity!].filter((c) => "WUBRG".includes(c)),
      );
    }
    expect(toResolvedCardData(printing("mh3-237")).color_identity).toEqual(["R", "W"]);
    expect(mapScryfallToFormPatch(printing("mh3-237")).color_identity).toEqual(["white"]);
  });

  it("an older cached shape without colours still imports its identity", () => {
    const legacy = scryfallCardSchema.parse({
      id: "x",
      name: "Old",
      type_line: "Creature — Bear",
      color_identity: ["G"],
    });
    expect(frameColorsFromScryfall(legacy)).toEqual(["green"]);
  });
});

// ---------------------------------------------------------------------------
// Where the signature registry's printings LAND (TODO 1.4): the creator runs
// resolveImportFrame with the patch's frame_match (`landOn ?? template`)
// against the frames production has verified (supabase/seed.sql).
// ---------------------------------------------------------------------------

describe("the signature registry's landings (TODO 1.4)", () => {
  const signature = (key: keyof typeof signaturePrintings) =>
    mapScryfallToFormPatch(scryfallCardSchema.parse(signaturePrintings[key]));

  it("Porcelain Legionnaire NPH #19 lands on the M15 artifact frame, white", () => {
    expect(landing(signature("nph-19"))).toEqual({ template: "m15artifact", colorKey: "w", status: "exact" });
  });

  it("Flooded Strand KTK #233 lands on the land frame, multicolour", () => {
    expect(landing(signature("ktk-233"))).toEqual({ template: "m15land", colorKey: "m", status: "exact" });
  });

  it("Sheoldred DMU #435 still lands on bordered M15 (landOn)", () => {
    expect(landing(signature("dmu-435"))).toEqual({ template: "m15", colorKey: "b", status: "exact" });
  });

  it("a Theros constellation god asks for Nyx, which an Enchantment Creature borrows (A3)", () => {
    const heliod = signature("thb-259");
    expect(heliod.supertype).toBe("Legendary Enchantment");
    // nyx/w isn't verified on production: M15, and the creator's toast
    // names the switch.
    expect(landing(heliod)).toEqual({ template: "m15", colorKey: "w", status: "frame-switched" });
    // Once it is, the god lands on Nyx — and the route calls it exact.
    const withNyx = new Set([...PROD_VERIFIED, frameComboKey("nyx", "w")]);
    expect(landing(heliod, withNyx)).toEqual({ template: "nyx", colorKey: "w", status: "exact" });
    expect(finalizeImportMatch(heliod, withNyx).frame_match?.status).toBe("exact");
    expect(finalizeImportMatch(heliod, PROD_VERIFIED).frame_match?.status).toBe("nearest");
  });

  it("a 2003-frame textless promo lands on the 2003 frame until the textless frame is verified (A9)", () => {
    // Wrath of God P07 #1: modern/w is verified on production, m15textless/w
    // isn't — the 2003 frame, as before the registry.
    const wrath = finalizeImportMatch(signature("p07-1"), PROD_VERIFIED);
    expect(wrath.frame_match).toMatchObject({ template: "modern", onceVerified: "m15textless" });
    expect(wrath.frame_template).toBe("modern");
    expect(landing(wrath)).toEqual({ template: "modern", colorKey: "w", status: "exact" });
    // Once m15textless/w is verified, the route names it and the import
    // lands on it; frame_template follows.
    const withTextless = new Set([...PROD_VERIFIED, frameComboKey("m15textless", "w")]);
    const later = finalizeImportMatch(signature("p07-1"), withTextless);
    expect(later.frame_match).toMatchObject({ status: "nearest", template: "m15textless" });
    expect(later.frame_match?.onceVerified).toBeUndefined();
    expect(later.frame_template).toBe("m15textless");
    expect(landing(later, withTextless)).toEqual({ template: "m15textless", colorKey: "w", status: "exact" });
    // Lightning Bolt P10 #1 is red: modern/r isn't verified, so it falls
    // forward to M15 while it waits, and the swap is per colour.
    const bolt = finalizeImportMatch(signature("p10-1"), withTextless);
    expect(bolt.frame_match?.template).toBe("modern");
    expect(landing(bolt, withTextless)).toEqual({ template: "m15", colorKey: "r", status: "frame-switched" });
  });

  it("a 2014–19 token with text asks for the text-box token frame; unverified, it lands on its textless dress (4.49 (b))", () => {
    // Knight TDOM #2 "Vigilance": m15tokentext, exact in the registry — a
    // nearest "not yet verified" answer until the owner verifies it, and the
    // import lands on the arch token it landed on before.
    const knight = finalizeImportMatch(signature("tdom-2"), PROD_VERIFIED);
    expect(knight.frame_match).toMatchObject({ status: "nearest", template: "m15tokentext", unverified: true });
    expect(landing(knight)).toEqual({ template: "m15token", colorKey: "w", status: "frame-switched" });
    // Treasure TXLN #7: the ARTIFACT token frame while it waits — never the
    // plain token frame (TEXT_BOX_TOKEN_FALLBACK).
    const treasure = finalizeImportMatch(signature("txln-7"), PROD_VERIFIED);
    expect(treasure.frame_match).toMatchObject({ status: "nearest", template: "m15tokenartifacttext", unverified: true });
    expect(landing(treasure)).toEqual({ template: "m15tokenartifact", colorKey: "c", status: "frame-switched" });
    // Once verified in the card's colour: exact, and the import lands on it.
    const verified = new Set([
      ...PROD_VERIFIED,
      frameComboKey("m15tokentext", "w"),
      frameComboKey("m15tokenartifacttext", "c"),
    ]);
    expect(finalizeImportMatch(signature("tdom-2"), verified).frame_match?.status).toBe("exact");
    expect(landing(signature("tdom-2"), verified)).toEqual({ template: "m15tokentext", colorKey: "w", status: "exact" });
    expect(landing(signature("txln-7"), verified)).toEqual({ template: "m15tokenartifacttext", colorKey: "c", status: "exact" });
    // A vanilla token keeps the textless frame (the 2015 full-art Cat T2XM #4).
    expect(signature("t2xm-4").frame_match?.template).toBe("m15token");
  });

  it("a verified full-art basic lands on it; an unverified one falls back to the land frame", () => {
    // Built explicitly both ways, so the test holds whether or not seed.sql
    // (which mirrors production) lists the full-art basics as verified yet.
    const fullArtKeys = ["m15fullartland", "fullartland"].flatMap((t) =>
      ["w", "u", "b", "r", "g", "c", "m"].map((c) => frameComboKey(t as FrameTemplate, c)),
    );
    const withFullArt = new Set([...PROD_VERIFIED, ...fullArtKeys]);
    const withoutFullArt = new Set([...PROD_VERIFIED].filter((k) => !fullArtKeys.includes(k)));
    expect(landing(signature("fdn-282"), withFullArt)).toEqual({ template: "m15fullartland", colorKey: "w", status: "exact" });
    // A borderless basic lands on the land frame (1.18: FRA #382's art_crop
    // is the 626×457 window, `full_art` or not); the creator offers the
    // borderless full-art basic.
    expect(landing(signature("fra-382"), withFullArt)).toEqual({ template: "m15land", colorKey: "w", status: "exact" });
    expect(landing(signature("fdn-282"), withoutFullArt)).toEqual({ template: "m15land", colorKey: "w", status: "frame-switched" });
    expect(landing(signature("unf-235"), withFullArt)).toEqual({ template: "m15land", colorKey: "w", status: "frame-switched" });
  });

  it("frame_match decides the wanted frame when both are present (landOn ?? template)", () => {
    // A patch whose frame_template disagrees with its match: the match wins,
    // so DMU #435 asks for its landOn (bordered M15), not the stale value.
    const patch: ScryfallImportPatch = { ...signature("dmu-435"), frame_template: "modern" };
    expect(landing(patch)).toEqual({ template: "m15", colorKey: "b", status: "exact" });
  });

  it("an older cached patch without frame_match keeps frame_template", () => {
    const old: ScryfallImportPatch = { ...signature("nph-19"), frame_match: undefined, frame_template: "modern" };
    expect(landing(old)).toEqual({ template: "modern", colorKey: "w", status: "exact" });
  });

  it("a rejected printing (a substitute card) wants no frame of its own", () => {
    const patch = signature("sznr-1");
    expect(patch.frame_match?.reject).toBe(true);
    const { wanted } = resolveImportFrame({
      patch,
      kind: null,
      current: { template: "m15land", cardType: "land", colors: [] },
      verifiedKeys: PROD_VERIFIED,
    });
    expect(wanted).toBe("m15land");
  });
});
