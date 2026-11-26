import { describe, expect, it } from "vitest";
import printingsData from "./fixtures/ub-extended-art-printings.json";
import referencePrintings from "../cards/fixtures/reference-printings.json";
import type { CardPreviewData } from "@/components/cards/card-preview";
import { anatomyDefaults, frameAnatomyOf } from "@/lib/cards/anatomy";
import { cardFieldsFace, frameKindGateError, frameKindUpdateGateError } from "@/lib/cards/frame-kind-gate";
import { frameAssetPathsFor } from "@/lib/render/card-image";
import { resolveGeneratedFrame } from "@/lib/creator/frame-random";
import { colorlessFrameFits, colorlessFrameReason, colorlessIsArtifactFrame } from "@/lib/creator/card-kinds";
import { ownCardRemixFrame } from "@/lib/ai/remix-mechanics";
import { crownReferenceFor } from "@/lib/cards/crown";
import { frameComboKey, FRAME_COLOR_KEYS } from "@/lib/cards/frame-reference-registry";
import { M15_FAMILY_TEMPLATES } from "@/lib/cards/m15-family";
import { PLATE_INK } from "@/lib/cards/plate-ink";
import { EXTENDED_ART_UB_CROWN, EXTENDED_ART_UB_HOLO_STAMP, EXTENDED_CROWN, M15UB_HOLO_STAMP, getFrameProfile } from "@/lib/cards/template-layout";
import { EDGE_CONTRACTS } from "@/lib/frames/edge-contract";
import { CARD_KIND_VALUES, extendedArtDressFor, isSubtypeDress, templateRefusesKind, templateSupportsKind } from "@/lib/creator/card-kinds";
import { eraForTemplate, isM15Treatment } from "@/lib/creator/frame-picker";
import { finalizeImportMatch, withVerification } from "@/lib/creator/frame-resolve";
import { scryfallRemixMechanics } from "@/lib/ai/remix-mechanics";
import { scryfallCardSchema } from "@/lib/scryfall/client";
import { FRAME_SIGNATURE_KEYS } from "@/lib/scryfall/frame-signatures";
import { frameMatchFromScryfall, mapScryfallToFormPatch } from "@/lib/scryfall/import-mapper";
import { ERA_TYPE_FRAME, FRAME_TEMPLATE_LABELS, FRAME_TEMPLATE_SET, FRAME_TEMPLATE_VALUES, TEMPLATE_SKIN_VARIANTS, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 4.25 — the Universes Beyond EXTENDED-ART frames (`extendedartub`,
// `extendedartubland`; owner approval 2026-11-25): the streaked Universes
// Beyond dress on the extended frame that WHO, PIP, FIN, FIC, LTR, LTC and
// ACR print (2023–25). Additions: no new card starts on them, no stored card
// moves, an import names them only once they are verified in the card's
// colour — and only for the printings they draw. (The recipe, the tones,
// the seams and the published masters: tests/unit/frames/
// ub-extended-art.test.ts.)
// ---------------------------------------------------------------------------

const UBX = ["extendedartub", "extendedartubland"] as const satisfies readonly FrameTemplate[];
const TWIN: Record<(typeof UBX)[number], FrameTemplate> = { extendedartub: "extendedart", extendedartubland: "extendedartland" };
const printings = printingsData as Record<string, unknown>;
const printing = (key: string) => {
  if (!printings[key]) throw new Error(`no captured printing ${key}`);
  return scryfallCardSchema.parse(printings[key]);
};
const EVERY = new Set(FRAME_TEMPLATE_VALUES.flatMap((t) => FRAME_COLOR_KEYS.map((k) => frameComboKey(t, k))));
const NO_UBX = new Set([...EVERY].filter((key) => !UBX.some((t) => key.startsWith(`${t}/`))));

describe("two templates of their own", () => {
  it("are M15-era extended-art treatments — never an era standard or a skin of one", () => {
    for (const t of UBX) {
      expect(FRAME_TEMPLATE_VALUES).toContain(t);
      expect(FRAME_TEMPLATE_SET[t]).toBe("extended");
      expect(eraForTemplate(t)).toBe("m15");
      expect(isM15Treatment(t)).toBe(true);
      expect(M15_FAMILY_TEMPLATES).toContain(t);
      expect(isSubtypeDress(t)).toBe(false);
      for (const era of Object.values(ERA_TYPE_FRAME)) expect(Object.values(era as Record<string, string>)).not.toContain(t);
      for (const skins of Object.values(TEMPLATE_SKIN_VARIANTS)) expect(skins ?? []).not.toContain(t);
    }
    expect(FRAME_TEMPLATE_LABELS.extendedartub).toBe("Extended Art Universes Beyond");
    expect(FRAME_TEMPLATE_LABELS.extendedartubland).toBe("Extended Art Universes Beyond Land");
  });

  it("split by kind as the extended frames do: the land frame for the land kind, the spell frame for the rest but the token", () => {
    for (const kind of CARD_KIND_VALUES) {
      expect(templateSupportsKind("extendedartub", kind), kind).toBe(["creature", "instant", "sorcery", "enchantment", "artifact"].includes(kind));
      expect(templateSupportsKind("extendedartubland", kind), kind).toBe(kind === "land");
      for (const t of UBX) expect(templateRefusesKind(t, kind), `${t}/${kind}`).toBe(!templateSupportsKind(t, kind));
    }
    expect(extendedArtDressFor("land", "extendedartub")).toBe("extendedartubland");
    expect(extendedArtDressFor("creature", "extendedartubland")).toBe("extendedartub");
    expect(extendedArtDressFor("artifact", "extendedartub")).toBe("extendedartub");
    // The extended frames' own split is untouched.
    expect(extendedArtDressFor("land", "extendedart")).toBe("extendedartland");
    expect(extendedArtDressFor("creature", "extendedartland")).toBe("extendedart");
  });

  it("the admin compare page's Legendary toggle has a crowned print where print has one", () => {
    for (const key of ["w", "u", "b", "r", "g", "m", "c"]) expect(crownReferenceFor("extendedartub", key), key).not.toBeNull();
    expect(crownReferenceFor("extendedartub", "c")).toMatchObject({ set: "ltr", collectorNumber: "793" });
    for (const key of ["u", "b", "m"]) expect(crownReferenceFor("extendedartubland", key), key).not.toBeNull();
    expect(crownReferenceFor("extendedartubland", "r")).toBeNull();
  });
});

describe("the profiles", () => {
  it("are their extended twins' slots, sizes and text with the Universes Beyond plates, crown band and triangle notch", () => {
    for (const t of UBX) {
      const { label, pt, overlays, underFrameArt, artifactMasterKeys, twoColorMasters, twoColorForLands, colorlessPlateKey, ...rest } = getFrameProfile(t);
      const {
        label: twinLabel,
        pt: twinPt,
        overlays: twinOverlays,
        underFrameArt: twinUnder,
        artifactMasterKeys: twinArtifact,
        twoColorMasters: twinPairs,
        twoColorForLands: twinPairsForLands,
        ...twinRest
      } = getFrameProfile(TWIN[t]);
      expect(rest, t).toEqual(twinRest);
      // (extendedart's see-through `c` and its type-dressed `a`; its land dress has neither.)
      expect(twinUnder === undefined, t).toBe(t === "extendedartubland");
      expect(twinArtifact === undefined, t).toBe(t === "extendedartubland");
      expect(label).not.toBe(twinLabel);
      // The plates are the pack's own UB plates, at the box and ink of the
      // twin's: m15ub's for the land frame; the spell frame's own set (the
      // same seven and the silver artifact plate under `a`, which its
      // colourless card paints).
      const plates = t === "extendedartub" ? "/frames/extendedartub/pt/{color}.png" : "/frames/m15ub/pt/{color}.png";
      expect(pt, t).toEqual({ ...twinPt, plateAssetPathTemplate: plates });
      expect(PLATE_INK[plates]).toEqual(PLATE_INK["/frames/m15ub/pt/{color}.png"]);
      expect(colorlessPlateKey, t).toBe(t === "extendedartub" ? "a" : undefined);
      // The colourless master is the pack's artifact frame: no art under the
      // frame, no type-dressed master.
      expect(underFrameArt, t).toBeUndefined();
      expect(artifactMasterKeys, t).toBeUndefined();
      expect(twoColorMasters, t).toEqual(twinPairs);
      expect(twoColorForLands, t).toEqual(twinPairsForLands);
      expect(twinOverlays?.map((o) => o.anatomy)).toEqual(["crown"]);
      expect(overlays?.map((o) => o.anatomy), t).toEqual(["crown", "holoStamp"]);
      expect(getFrameProfile(t).collector, t).toBeUndefined();
      expect(getFrameProfile(t).nickname, t).toBeUndefined();
      expect(EDGE_CONTRACTS[t], t).toBeDefined();
    }
    expect(getFrameProfile("extendedartub").overlays).toEqual([{ ...EXTENDED_ART_UB_CROWN, keyMap: { c: "a" } }, EXTENDED_ART_UB_HOLO_STAMP]);
    expect(getFrameProfile("extendedartubland").overlays).toEqual([
      { ...EXTENDED_ART_UB_CROWN, keyMap: { c: "l" } },
      { ...EXTENDED_ART_UB_HOLO_STAMP, keyMap: { c: "l" } },
    ]);
    // Their anatomy: the crown, the pairs and the stamp, as switches.
    expect(frameAnatomyOf("extendedartub")).toMatchObject({ crown: true, twoColor: ["split", "hybrid"] });
    expect(frameAnatomyOf("extendedartubland")).toMatchObject({ crown: true, twoColor: ["split"] });
    for (const t of UBX) expect(frameAnatomyOf(t).stamp, t).toBe(true);
    expect(anatomyDefaults("extendedartub")).toMatchObject({ crown: true, twoColor: true });
  });

  it("the crown is the extended crown's slot on the Universes Beyond band; the notch the triangle's, on the pack's own piece", () => {
    expect(EXTENDED_ART_UB_CROWN.rect).toEqual(EXTENDED_CROWN.rect);
    expect(EXTENDED_ART_UB_CROWN.assetPathTemplate).toBe("/frames/extendedartubcrown/{key}.png");
    // No `c`: the spell frame maps it to `a`, the land frame to `l`.
    expect(EXTENDED_ART_UB_CROWN.keys).toEqual(["w", "u", "b", "r", "g", "m", "a", "l", "wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"]);
    expect(EXTENDED_ART_UB_HOLO_STAMP.assetPathTemplate).toBe("/frames/extendedartubholostamp/{key}.png");
    expect(EXTENDED_ART_UB_HOLO_STAMP).toMatchObject({ stamp: (M15UB_HOLO_STAMP as { stamp?: unknown }).stamp });
    expect(EXTENDED_ART_UB_HOLO_STAMP.rect).toEqual({ leftPct: (638 / 1500) * 100, topPct: (1891 / 2100) * 100, widthPct: (224 / 1500) * 100, heightPct: (102 / 2100) * 100 });
    expect(EXTENDED_ART_UB_HOLO_STAMP.keys).toEqual(["w", "u", "b", "r", "g", "m", "c", "l", "wu", "wb", "ub", "ur", "br", "bg", "rg", "rw", "gw", "gu"]);
  });
});

describe("imports follow the printing (the registry's ub/extendedart rule)", () => {
  it("knows the rule; the extended-art rule keeps its Universes Beyond gap for the rest", () => {
    expect(FRAME_SIGNATURE_KEYS).toContain("ub/extendedart");
    expect(FRAME_SIGNATURE_KEYS).toContain("extendedart+universes-beyond");
    expect(FRAME_SIGNATURE_KEYS.indexOf("ub/extendedart")).toBeLessThan(FRAME_SIGNATURE_KEYS.indexOf("extendedart+universes-beyond"));
  });

  it.each([
    ["ltr-829", "extendedart", "extendedartub", "w"],
    ["acr-160", "extendedart", "extendedartub", "u"],
    ["pip-992", "extendedart", "extendedartub", "b"],
    ["ltr-832", "extendedart", "extendedartub", "r"],
    ["fic-126", "extendedart", "extendedartub", "g"],
    ["pip-1006", "extendedart", "extendedartub", "m"],
    ["fic-228", "extendedart", "extendedartub", "c"],
    ["who-1071", "extendedart", "extendedartub", "c"],
    ["who-1124", "extendedartland", "extendedartubland", "c"],
    ["pip-1054", "extendedartland", "extendedartubland", "c"],
    ["pip-1055", "extendedartland", "extendedartubland", "w"],
    ["who-1084", "extendedartland", "extendedartubland", "m"],
  ] as const)("%s: nearest on %s until %s is verified in its colour, then exact on it", (key, today, later, colour) => {
    const match = frameMatchFromScryfall(printing(key));
    expect(match).toMatchObject({
      signature: "ub/extendedart",
      status: "nearest",
      template: today,
      reason: "PipGlyph's Universes Beyond extended-art frame isn't verified yet",
      blockedBy: "4.25",
      onceVerified: later,
      onceVerifiedMatch: { status: "exact", reason: null },
    });
    // Before the tick: the landing it always had, filed as "not yet verified".
    expect(withVerification(match, colour, NO_UBX)).toMatchObject({ status: "nearest", template: today, unverified: true });
    expect(withVerification(match, colour, EVERY)).toMatchObject({ status: "exact", template: later });
    // Verified in ANOTHER colour only: nothing moves.
    const other = colour === "u" ? "r" : "u";
    expect(withVerification(match, colour, new Set([...NO_UBX, frameComboKey(later, other)]))).toMatchObject({ template: today });
    // The patch: the frame follows the finalized match, every other field stays.
    const patch = mapScryfallToFormPatch(printing(key));
    const before = finalizeImportMatch(patch, NO_UBX);
    const after = finalizeImportMatch(patch, EVERY);
    expect(before.frame_template).toBe(today);
    expect(after.frame_template).toBe(later);
    expect({ ...after, frame_template: today, frame_match: null }).toEqual({ ...before, frame_match: null });
    expect(patch.printed_stamp).toBe("triangle");
  });

  it("a crowned, a gold-split, a hybrid and a two-colour land printing are exact too: the frames draw the crown and the pairs", () => {
    for (const [key, later] of [
      ["who-1041", "extendedartub"],
      ["fic-139", "extendedartub"],
      ["ltr-793", "extendedartub"],
      ["pip-1007", "extendedartub"],
      ["acr-166", "extendedartub"],
      ["pip-1003", "extendedartub"],
      ["who-1054", "extendedartubland"],
      ["ltc-160", "extendedartubland"],
      ["pip-1056", "extendedartubland"],
    ] as const) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.signature, key).toBe("ub/extendedart");
      expect(match.onceVerified, key).toBe(later);
      expect(match.onceVerifiedMatch, key).toEqual({ status: "exact", reason: null });
    }
    // The patch names the pieces the printing wears.
    expect(mapScryfallToFormPatch(printing("fic-139")).printed_crown).toBe(true);
    expect(mapScryfallToFormPatch(printing("pip-1007")).printed_two_color).toBe(true);
  });

  it("the printings the frames don't draw keep the extended-art rule and its Universes Beyond gap, whatever is ticked", () => {
    for (const key of [
      // A coloured artifact prints the artifact frame's silver field.
      "pip-921",
      "pip-955",
      // A colourless non-artifact card prints a see-through frame.
      "fin-421",
      "who-923",
      // The Nyx starfield.
      "fic-109",
    ]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.signature, key).toBe("extendedart+universes-beyond");
      expect(match.onceVerified, key).toBeUndefined();
      const patch = mapScryfallToFormPatch(printing(key));
      expect(finalizeImportMatch(patch, EVERY), key).toEqual(finalizeImportMatch(patch, NO_UBX));
    }
    // A Vehicle keeps the Vehicle rule's stand-in; a layout or a double-faced
    // card its own body.
    for (const key of ["pip-964", "who-1046", "fin-513", "fic-173"]) {
      const match = frameMatchFromScryfall(printing(key));
      expect(match.signature, key).not.toMatch(/^ub\/extendedart/);
      expect(match.onceVerified === "extendedartub" || match.onceVerified === "extendedartubland", key).toBe(false);
      const patch = mapScryfallToFormPatch(printing(key));
      expect(finalizeImportMatch(patch, EVERY).frame_template ?? "", key).not.toMatch(/^extendedartub/);
    }
  });

  it("an extended-art printing that isn't Universes Beyond is untouched", () => {
    // WOE #328 A Tale for the Ages, extendedart's white reference.
    const woe = scryfallCardSchema.parse((referencePrintings as Record<string, unknown>)["4fc7d7d8-0965-4097-98ee-e89cfa05fd05"]);
    const match = frameMatchFromScryfall(woe);
    expect(match.signature).toMatch(/^extendedart/);
    expect(match.template).toBe("extendedart");
    expect(match.onceVerified).toBeUndefined();
  });
});

describe("the AI deck remix lands where the import lands", () => {
  const remix = (key: string, verified: ReadonlySet<string>) => {
    const result = scryfallRemixMechanics(mapScryfallToFormPatch(printing(key)), "Entry", verified);
    if (!result.ok) throw new Error(`${key}: ${result.error}`);
    return result.mechanics;
  };

  it.each([
    ["ltr-829", "extendedart", "extendedartub"],
    ["fic-228", "extendedart", "extendedartub"],
    ["who-1124", "extendedartland", "extendedartubland"],
  ] as const)("%s: on %s until the Universes Beyond extended-art frame is ticked, then on %s — nothing else changes", (key, today, later) => {
    const before = remix(key, NO_UBX);
    const after = remix(key, EVERY);
    expect(before.frame_template).toBe(today);
    expect(after.frame_template).toBe(later);
    expect({ ...after, frame_template: today }).toEqual(before);
  });

  it("a printing the frames don't draw never moves with the ticks", () => {
    for (const key of ["pip-921", "fin-421", "fic-109"]) expect(remix(key, EVERY), key).toEqual(remix(key, NO_UBX));
  });
});

// The spell frame's colourless `c` is the pack's ARTIFACT frame (it has no
// see-through master): print puts a colourless artifact there (WHO #1071
// Solemn Simulacrum, LTR #793 Phial of Galadriel) and never a colourless
// creature, instant, sorcery or enchantment (FIN #421, WHO #923 / #332 print
// a see-through frame, not built).
const card = (over: Partial<CardPreviewData>): CardPreviewData =>
  ({
    title: "Solemn Simulacrum",
    cost: "{4}",
    cardType: "creature",
    supertype: "Artifact",
    subtypes: ["Golem"],
    rarity: "rare",
    colorIdentity: [],
    rulesText: "When this creature enters, you may search your library for a basic land card.",
    flavorText: "",
    power: "2",
    toughness: "2",
    artUrl: null,
    frameStyle: { template: "extendedartub" },
    ...over,
  }) as unknown as CardPreviewData;

describe("a colourless card on the spell frame paints the silver artifact plate", () => {
  it("a colourless artifact creature warms (and draws) pt/a — the hybrid dress keeps the grey pt/c, every colour its own", () => {
    const plates = (c: CardPreviewData) => frameAssetPathsFor(c).filter((p) => p.includes("/pt/"));
    expect(plates(card({}))).toEqual(["/frames/extendedartub/pt/a.png"]);
    expect(plates(card({ colorIdentity: ["white"] }))).toEqual(["/frames/extendedartub/pt/w.png"]);
    expect(plates(card({ colorIdentity: ["white", "blue"], cost: "{2}{W}{U}" }))).toEqual(["/frames/extendedartub/pt/m.png"]);
    expect(plates(card({ colorIdentity: ["white", "blue"], cost: "{2}{W}{U}", frameStyle: { template: "extendedartub", twoColor: true } as CardPreviewData["frameStyle"] }))).toEqual([
      "/frames/extendedartub/pt/m.png",
    ]);
    expect(
      plates(card({ colorIdentity: ["green", "blue"], cost: "{G/U}{G/U}", supertype: null, frameStyle: { template: "extendedartub", twoColor: true } as CardPreviewData["frameStyle"] })),
    ).toEqual(["/frames/extendedartub/pt/c.png"]);
    // The land frame's colourless land creature keeps the grey land plate.
    expect(plates(card({ cardType: "land", supertype: "Creature", frameStyle: { template: "extendedartubland" } as CardPreviewData["frameStyle"] }))).toEqual([
      "/frames/m15ub/pt/c.png",
    ]);
  });
});

describe("a colourless card wears the spell frame only as an artifact (its `c` is the artifact frame)", () => {
  it("the rule: colourless + no Artifact word is refused on extendedartub alone — never on a coloured card, the land frame or extended art", () => {
    expect(FRAME_TEMPLATE_VALUES.filter(colorlessIsArtifactFrame)).toEqual(["extendedartub"]);
    for (const key of ["w", "u", "b", "r", "g", "m"]) expect(colorlessFrameFits("extendedartub", key, { cardType: "creature" }), key).toBe(true);
    expect(colorlessFrameFits("extendedartub", "c", { cardType: "artifact" })).toBe(true);
    expect(colorlessFrameFits("extendedartub", "c", { cardType: "creature", supertype: "Artifact" })).toBe(true);
    expect(colorlessFrameFits("extendedartub", "c", { cardType: "creature", supertype: "Legendary Artifact" })).toBe(true);
    for (const cardType of ["creature", "instant", "sorcery", "enchantment"]) {
      expect(colorlessFrameFits("extendedartub", "c", { cardType }), cardType).toBe(false);
      expect(colorlessFrameFits("extendedartub", "c", { cardType, supertype: "Legendary" }), cardType).toBe(false);
    }
    expect(colorlessFrameFits("extendedartubland", "c", { cardType: "land" })).toBe(true);
    expect(colorlessFrameFits("extendedart", "c", { cardType: "creature" })).toBe(true);
    expect(colorlessFrameReason("extendedartub")).toMatch(/only as an artifact/);
    expect(colorlessFrameReason("extendedart")).toBeNull();
  });

  it("the server's kind gate refuses it (create and update), and reads nothing without the colours", () => {
    const face = (over: Record<string, unknown>) => cardFieldsFace({ card_type: "creature", supertype: null, subtypes: ["Eldrazi"], title: "Ultima", rules_text: "", ...over });
    expect(frameKindGateError("extendedartub", face({ color_identity: [] }))).toMatch(/only as an artifact.*pick another frame or a colour/);
    expect(frameKindGateError("extendedartub", face({ color_identity: ["colorless"] }))).toMatch(/only as an artifact/);
    expect(frameKindGateError("extendedartub", face({ color_identity: [], supertype: "Artifact" }))).toBeNull();
    expect(frameKindGateError("extendedartub", face({ color_identity: ["white"] }))).toBeNull();
    expect(frameKindGateError("extendedartub", face({}))).toBeNull();
    expect(frameKindGateError("extendedart", face({ color_identity: [] }))).toBeNull();
    // An edit that takes the Artifact word off a colourless card there, or
    // makes a creature there colourless, is refused.
    const artifact = face({ color_identity: [], supertype: "Artifact" });
    expect(frameKindUpdateGateError({ existingTemplate: "extendedartub", nextTemplate: undefined, existing: artifact, next: face({ color_identity: [] }) })).toMatch(/only as an artifact/);
    expect(
      frameKindUpdateGateError({ existingTemplate: "extendedartub", nextTemplate: undefined, existing: face({ color_identity: ["white"] }), next: face({ color_identity: [] }) }),
    ).toMatch(/only as an artifact/);
    expect(frameKindUpdateGateError({ existingTemplate: "extendedartub", nextTemplate: undefined, existing: artifact, next: artifact })).toBeNull();
  });

  it("resolveGeneratedFrame never puts a colourless non-artifact there, asked for by name or at random", () => {
    const pick = (cardType: "creature" | "instant" | "artifact", supertype: string | null, colorIdentity: string[], fallback: "random" | "none") =>
      resolveGeneratedFrame({
        cardType,
        requested: "extendedartub",
        colorIdentity: colorIdentity as never,
        verifiedKeys: EVERY,
        face: { cardType, supertype, subtypes: [], title: "X", rulesText: "" },
        random: () => 0,
        fallback,
      });
    expect(pick("creature", "Artifact", [], "none")).toBe("extendedartub");
    expect(pick("artifact", null, [], "none")).toBe("extendedartub");
    expect(pick("creature", null, ["white"], "none")).toBe("extendedartub");
    expect(pick("creature", null, [], "none")).toBeNull();
    expect(pick("instant", null, [], "none")).toBeNull();
    expect(pick("creature", null, [], "random")).not.toBe("extendedartub");
    for (let i = 0; i < 40; i += 1) {
      const at = resolveGeneratedFrame({
        cardType: "creature",
        requested: "random",
        colorIdentity: [],
        verifiedKeys: EVERY,
        face: { cardType: "creature", supertype: null, subtypes: [], title: "X", rulesText: "" },
        random: () => i / 40,
      });
      expect(at, String(i)).not.toBe("extendedartub");
    }
  });

  it("an own-card remix keeps the frame for a colourless artifact and falls back for anything else colourless", () => {
    const source = (over: Record<string, unknown>) =>
      ({ frame_style: { template: "extendedartub" }, color_identity: [], card_type: "creature", supertype: "Artifact", subtypes: ["Golem"], title: "Solemn Simulacrum", rules_text: "", ...over }) as never;
    expect(ownCardRemixFrame(source({}), EVERY).frame_template).toBe("extendedartub");
    expect(ownCardRemixFrame(source({ supertype: null }), EVERY).frame_template).toBeUndefined();
    expect(ownCardRemixFrame(source({ supertype: null, color_identity: ["white"] }), EVERY).frame_template).toBe("extendedartub");
  });
});

describe("the rule names gaps after the swap only where the printing has them", () => {
  it("ub/extendedart is no gap rule: its listed gaps are read from the printing, never assumed (every captured printing it names is exact once ticked)", () => {
    expect(FRAME_SIGNATURE_KEYS).toContain("ub/extendedart");
    let named = 0;
    for (const key of Object.keys(printings)) {
      const match = frameMatchFromScryfall(printing(key));
      if (match.signature !== "ub/extendedart") continue;
      named += 1;
      expect(match.onceVerifiedMatch, key).toEqual({ status: "exact", reason: null });
    }
    expect(named).toBeGreaterThan(10);
  });
});
