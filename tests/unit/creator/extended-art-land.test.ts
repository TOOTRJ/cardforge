import { describe, expect, it } from "vitest";
import referencesData from "@/lib/cards/frame-references.json";
import printingsData from "../cards/fixtures/reference-printings.json";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { crownReferenceFor } from "@/lib/cards/crown";
import {
  CARD_KIND_VALUES,
  extendedArtDressFor,
  skinVariantsFor,
  templateRefusesKind,
  templateSupportsKind,
} from "@/lib/creator/card-kinds";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { finalizeImportMatch } from "@/lib/creator/frame-resolve";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { ownCardRemixFrame } from "@/lib/ai/remix-mechanics";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET, FRAME_TEMPLATE_VALUES, type Card, type FrameTemplate, type GameSystem } from "@/types/card";
import { remixValuesFrom } from "@/lib/creator/card-fields";

// ---------------------------------------------------------------------------
// Extended art's LAND dress (TODO 4.7, owner Round 63, 2026-10-14): a land
// on extended art prints Card Conjurer's extended LAND frames (FDN #487 the
// grey `l`, NEO #501–505 `l<k>`, CMR #705 the gold `lm`), so `extendedart`
// split by kind as m15 / m15land do: `extendedartland` dresses the land
// kind alone and `extendedart` every other kind its body draws. Every path
// that puts a land on extended art — the picker, the import, an AI request
// by name, the remix of an own land stored on `extendedart` — puts it on the
// land dress. (The masters and the profile: tests/unit/frames/
// extended-art-importer.test.ts.)
// ---------------------------------------------------------------------------

const ALL = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const printings = printingsData as Record<string, unknown>;
type Ref = { name: string; set: string; scryfallId: string };
const references = (referencesData as unknown as Record<string, { colors: Record<string, Ref[]> }>).extendedartland.colors;

describe("the template", () => {
  it("is an M15-era extended-art frame, labelled for the land", () => {
    expect(FRAME_TEMPLATE_LABELS.extendedartland).toBe("Extended Art Land");
    expect(FRAME_TEMPLATE_SET.extendedartland).toBe("extended");
    expect(eraForTemplate("extendedartland")).toBe("m15");
    expect(M15_FAMILY_TEMPLATES).toContain("extendedartland");
  });

  it("the admin compare page's Legendary toggle has a crowned land print in every colour", () => {
    for (const key of FRAME_COLOR_KEYS) {
      const ref = crownReferenceFor("extendedartland", key);
      expect(ref, key).not.toBeNull();
    }
    expect(crownReferenceFor("extendedartland", "u")).toMatchObject({ set: "neo", collectorNumber: "503" });
  });
});

describe("the kind gate: the land kind wears the land dress, every other kind the spell frame", () => {
  it("refuses / supports", () => {
    for (const kind of CARD_KIND_VALUES) {
      expect(templateSupportsKind("extendedartland", kind), kind).toBe(kind === "land");
      expect(templateRefusesKind("extendedartland", kind), kind).toBe(kind !== "land");
    }
    expect(templateRefusesKind("extendedart", "land")).toBe(true);
    for (const kind of ["creature", "instant", "sorcery", "enchantment", "artifact", "token"] as const) {
      expect(templateSupportsKind("extendedart", kind), kind).toBe(true);
    }
  });

  it("the land's variations under m15land offer the land dress, never the spell frame", () => {
    const skins = skinVariantsFor("land", "m15land");
    expect(skins).toContain("extendedartland");
    expect(skins).not.toContain("extendedart");
    expect(skinVariantsFor("creature", "m15")).toContain("extendedart");
    expect(skinVariantsFor("creature", "m15")).not.toContain("extendedartland");
  });

  it("a land stored on extendedart before the split stays editable; a NEW one, or a frame change onto it, is refused", () => {
    const land = { cardType: "land", title: "Test Tower", rulesText: "{T}: Add {C}.", subtypes: [] };
    expect(frameKindGateError("extendedart", land)).toMatch(/doesn't dress Land cards/);
    expect(frameKindGateError("extendedartland", land)).toBeNull();
    expect(frameKindUpdateGateError({ existingTemplate: "extendedart", nextTemplate: undefined, existing: land, next: { ...land, title: "Renamed" } })).toBeNull();
    expect(frameKindUpdateGateError({ existingTemplate: "m15land", nextTemplate: "extendedart", existing: land, next: land })).toMatch(/doesn't dress Land cards/);
  });

  it("extendedArtDressFor: the land on the land dress, every other kind on the spell frame, anything else itself", () => {
    expect(extendedArtDressFor("land", "extendedart")).toBe("extendedartland");
    expect(extendedArtDressFor("creature", "extendedartland")).toBe("extendedart");
    expect(extendedArtDressFor("land", "extendedartland")).toBe("extendedartland");
    expect(extendedArtDressFor("artifact", "extendedart")).toBe("extendedart");
    expect(extendedArtDressFor("land", "m15land")).toBe("m15land");
  });
});

describe("imports: an extended-art land printing lands on the land dress", () => {
  const rows = Object.entries(references).flatMap(([colour, list]) => list.map((ref) => ({ colour, ref })));

  it.each(rows)("$ref.name ($ref.set, $colour)", ({ colour, ref }) => {
    const card = scryfallCardSchema.parse(printings[ref.scryfallId]);
    const match = frameMatchFromScryfall(card);
    expect(match.template).toBe("extendedartland");
    expect(match.status).toBe("exact");
    const patch = finalizeImportMatch(mapScryfallToFormPatch(card), ALL);
    expect(patch.frame_template).toBe("extendedartland");
    expect(patch.frame_match?.status).toBe("exact");
    // The colour the frame paints: the land's mana (the grey `l` for {C},
    // the gold `lm` for any colour).
    const KEY: Record<string, string> = { white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c", multicolor: "m" };
    expect((patch.color_identity ?? []).map((c) => KEY[c]), ref.name).toEqual([colour]);
  });

  it("a two-colour land: the land dress's pair master, exact once verified (TODO 4.7 follow-up: no two-colour gap)", () => {
    const soulstone = printings[references.c[0].scryfallId] as Record<string, unknown>;
    const dual = scryfallCardSchema.parse({ ...soulstone, name: "Test Dual", produced_mana: ["B", "R"], color_identity: ["B", "R"], oracle_text: "{T}: Add {B} or {R}." });
    const match = frameMatchFromScryfall(dual);
    expect(match.template).toBe("extendedartland");
    expect(match.status).toBe("exact");
    expect(match.gaps ?? []).not.toContain("two-colour");
    // The import names the two-colour frame (the 2015 frame always prints
    // it), so the save keeps the switch on this land frame.
    const patch = finalizeImportMatch(mapScryfallToFormPatch(dual), ALL);
    expect(patch.frame_template).toBe("extendedartland");
    expect(patch.frame_match?.status).toBe("exact");
    expect(patch.printed_two_color).toBe(true);
    expect(finalizeImportMatch(mapScryfallToFormPatch(dual), new Set<string>()).frame_match?.status).toBe("nearest");
  });

  it("a non-land extended-art printing stays on extendedart", () => {
    const ref = (referencesData as unknown as Record<string, { colors: Record<string, Ref[]> }>).extendedart.colors.u[0];
    const card = scryfallCardSchema.parse((printingsData as Record<string, unknown>)[ref.scryfallId]);
    expect(frameMatchFromScryfall(card).template).toBe("extendedart");
  });
});

describe("the AI: a land asked onto the extended-art frame by name lands on the land dress", () => {
  it.each(["extendedart", "extendedartland"] as FrameTemplate[])("asked for %s", (requested) => {
    for (const colour of ["colorless", "blue"] as const) {
      expect(
        resolveGeneratedFrame({ cardType: "land", requested, colorIdentity: [colour], verifiedKeys: ALL, random: () => 0 }),
        colour,
      ).toBe("extendedartland");
    }
    expect(resolveGeneratedFrame({ cardType: "creature", requested, colorIdentity: ["blue"], verifiedKeys: ALL, random: () => 0 })).toBe("extendedart");
  });
});

describe("the remix of an own card keeps the extended look", () => {
  const land = { card_type: "land" as const, supertype: "", subtypes: [], title: "Test Tower", rules_text: "{T}: Add {C}.", back_face: null };
  it("a land stored on extendedart before the split: onto the land dress, where it is verified", () => {
    expect(ownCardRemixFrame({ ...land, frame_style: { template: "extendedart" }, color_identity: ["colorless"] }, ALL).frame_template).toBe("extendedartland");
    expect(ownCardRemixFrame({ ...land, frame_style: { template: "extendedartland" }, color_identity: ["blue"] }, ALL).frame_template).toBe("extendedartland");
    // Unverified: the default landing, as any unpublished frame.
    expect(ownCardRemixFrame({ ...land, frame_style: { template: "extendedart" }, color_identity: ["colorless"] }, new Set()).frame_template).toBeUndefined();
  });

  it("the creator's Remix of a land stored on extendedart opens on the land dress — the remix can't change its frame, and the kind gate refuses a NEW land on extendedart", () => {
    const GAME = "33333333-3333-4333-8333-333333333333";
    const parent = {
      ...land, id: "22222222-2222-4222-8222-222222222222", owner_id: "11111111-1111-4111-8111-111111111111", slug: "test-tower",
      game_system_id: GAME, cost: null, color_identity: ["colorless"], tags: [], rarity: "rare", flavor_text: null, power: null,
      toughness: null, loyalty: null, defense: null, artist_credit: null, art_url: null, art_position: null, visibility: "public",
      back_card_id: null, source_scryfall_id: null, set_icon_url: null, set_icon_code: null, face_content: null, watermark: null,
      footer_text: null, frame_style: { finish: "regular", template: "extendedart" },
    } as unknown as Card;
    const values = remixValuesFrom(parent, [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem]);
    expect(values.frame_style.template).toBe("extendedartland");
    expect(frameKindGateError(values.frame_style.template, { cardType: "land", title: values.title, rulesText: land.rules_text, subtypes: [] })).toBeNull();
    // A creature's remix keeps the spell frame.
    const creature = remixValuesFrom({ ...parent, card_type: "creature", subtypes: ["Elf"], rules_text: "Flying" } as unknown as Card, [{ id: GAME, slug: "mtg", name: "Magic" } as unknown as GameSystem]);
    expect(creature.frame_style.template).toBe("extendedart");
  });

  it("a creature on extendedart keeps it", () => {
    const creature = { card_type: "creature" as const, supertype: "", subtypes: ["Elf"], title: "Test", rules_text: "Flying", back_face: null };
    expect(ownCardRemixFrame({ ...creature, frame_style: { template: "extendedart" }, color_identity: ["green"] }, ALL).frame_template).toBe("extendedart");
  });
});
