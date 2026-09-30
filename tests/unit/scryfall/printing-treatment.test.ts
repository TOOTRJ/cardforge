import { describe, expect, it } from "vitest";
import printings from "./fixtures/treatment-printings.json";
import signaturePrintings from "./fixtures/signature-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  frameTemplateFromScryfall,
  mapScryfallToFormPatch,
  printingTreatmentFromScryfall,
  printingTreatmentNotice,
  printingTreatmentOffer,
  FULL_ART_BASIC_2022_SETS,
  type PrintingTreatment,
} from "@/lib/scryfall/import-mapper";
import { frameComboKey } from "@/lib/cards/frame-reference-registry";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO 1.16 stopgap (+ its full-art amendment): the importer lands every
// borderless / showcase / extended-art / full-art / textless printing on the
// plain frame of its era, and m15 is verified, so the creator used to report
// nothing — a silent "exact". The mapper now names the treatment it drops
// (the frame choice is unchanged) and the creator toasts it.
//
// Fixtures are real Scryfall payloads (/cards/:set/:number, captured once on
// 2026-09-25; FRA #382, UNF #235, FDN #282, FIN #309, ZNR #266 and SPM #189
// on 2026-09-26), trimmed to identity + the fields the mapper reads, and parsed
// through the same zod schema the routes use — no network in tests.
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printings;

const printing = (key: PrintingKey): ScryfallCard =>
  scryfallCardSchema.parse(printings[key]);

describe("scryfallCardSchema — printing treatment fields", () => {
  it("types border_color, full_art, textless and promo_types", () => {
    const sheoldred = printing("dmu-435");
    expect(sheoldred.border_color).toBe("borderless");
    expect(sheoldred.full_art).toBe(false);
    expect(sheoldred.textless).toBe(false);
    expect(sheoldred.promo_types).toEqual([
      "concept",
      "boosterfun",
      "setextension",
    ]);
    const confidant = printing("sch-3");
    expect(confidant.full_art).toBe(true);
    expect(confidant.textless).toBe(true);
  });

  it("keeps parsing a payload without them (older cached shapes)", () => {
    const parsed = scryfallCardSchema.parse({ id: "x", name: "Bare" });
    expect(parsed.border_color).toBeUndefined();
    expect(printingTreatmentFromScryfall(parsed)).toBeUndefined();
  });
});

describe("printingTreatmentFromScryfall — fixtures from 1.16 / 1.19", () => {
  // [fixture, treatment the import must name, frame the import asks for].
  // The stopgap never changed the frame; the signature registry (TODO 1.4 /
  // 1.17 / 1.19) now does, on purpose: a showcase, extended-art, full-art
  // or textless printing asks for its own (or nearest) PipGlyph frame, and a
  // borderless one still lands on the bordered frame (1.18). The creator
  // falls back while that frame is unverified in the card's colour.
  const cases: Array<[PrintingKey, PrintingTreatment | undefined, FrameTemplate]> = [
    // Plain M15 printing of the same card → no notice.
    ["dmu-107", undefined, "m15"],
    // Sheoldred DMU #435: borderless (legendary + inverted, no showcase).
    ["dmu-435", "borderless", "m15"],
    // Clarion Conqueror TDM #400: black-bordered ghostfire showcase.
    ["tdm-400", "showcase", "tarkirghostfire"],
    // Festival of Embers BLB #316: borderless AND showcase → borderless; the
    // Bloomburrow woodland frame is its own.
    ["blb-316", "borderless", "bloomburrow"],
    // Archangel of Wrath DMU #384: extended art.
    ["dmu-384", "extendedart", "extendedart"],
    // Overlord of the Floodpits DSK #389: Japan showcase (showcase + full art).
    ["dsk-389", "showcase", "m15"],
    // Full-art basics: ONE #262, FDN #282, BFZ #250, ZNR #266, SPM #189 and
    // FIN #309 (a Wastes) ask for the black-bordered full-art basic (exact
    // for the 2022 design, nearest for the others).
    ["one-262", "fullart", "m15fullartland"],
    ["fdn-282", "fullart", "m15fullartland"],
    ["bfz-250", "fullart", "m15fullartland"],
    ["znr-266", "fullart", "m15fullartland"],
    ["spm-189", "fullart", "m15fullartland"],
    ["fin-309", "fullart", "m15fullartland"],
    // Borderless basics: FRA #382 (bars) is the borderless full-art basic
    // but lands on the land frame (the window-cropped art, 1.18); UNF #235
    // (textless) → the textless land.
    ["fra-382", "borderless", "m15land"],
    ["unf-235", "borderless", "m15textlessland"],
    // Dark Confidant SCH #3: textless (and full art) → the textless frame.
    ["sch-3", "textless", "m15textless"],
    // Cat T2XM #4: a full-art token of the M20 design lands on the 2014–19
    // arch, which isn't its look, so it is named like any nearest (TODO 1.23;
    // it was skipped as "its own family" before).
    ["t2xm-4", "fullart", "m15token"],
    // Kithkin Soldier TLRW #3: a 2003-frame full-art token is NOT m15token's
    // look, so it still gets the notice.
    ["tlrw-3", "fullart", "m15token"],
  ];

  it.each(cases)("%s → %s on %s", (key, treatment, frame) => {
    const card = printing(key);
    expect(printingTreatmentFromScryfall(card)).toBe(treatment);
    expect(frameTemplateFromScryfall(card)).toBe(frame);
  });

  it("rides along on the import patch and survives the route's JSON hop", () => {
    const patch = mapScryfallToFormPatch(printing("dmu-435"));
    expect(patch.printing_treatment).toBe("borderless");
    expect(patch.frame_template).toBe("m15");
    const overTheWire = JSON.parse(JSON.stringify(patch)) as typeof patch;
    expect(overTheWire.printing_treatment).toBe("borderless");
    // A plain printing carries no key at all once serialized.
    const plain = JSON.parse(
      JSON.stringify(mapScryfallToFormPatch(printing("dmu-107"))),
    ) as Record<string, unknown>;
    expect("printing_treatment" in plain).toBe(false);
  });

  it("reads the `fullart` frame effect even when the full_art flag is off", () => {
    const card = scryfallCardSchema.parse({
      ...printings["dmu-107"],
      frame_effects: ["fullart"],
      full_art: false,
    });
    expect(printingTreatmentFromScryfall(card)).toBe("fullart");
  });

  it("a frame change outranks an art change (showcase over extended art)", () => {
    const card = scryfallCardSchema.parse({
      ...printings["dmu-384"],
      frame_effects: ["extendedart", "showcase"],
    });
    expect(printingTreatmentFromScryfall(card)).toBe("showcase");
  });

  it("skips a full-art 2014–19 token on the 2015 frame: m15token IS that design (TODO 1.23)", () => {
    // T2XM #4 as if printed before M20 (released 2019-07-12).
    const arch = scryfallCardSchema.parse({ ...printings["t2xm-4"], released_at: "2018-04-27" });
    expect(printingTreatmentFromScryfall(arch)).toBeUndefined();
    const m20 = scryfallCardSchema.parse({ ...printings["t2xm-4"], released_at: "2019-07-12" });
    expect(printingTreatmentFromScryfall(m20)).toBe("fullart");
  });

  it("still names a borderless 2015 token (only full-art/textless tokens are skipped)", () => {
    const card = scryfallCardSchema.parse({
      ...printings["t2xm-4"],
      border_color: "borderless",
    });
    expect(printingTreatmentFromScryfall(card)).toBe("borderless");
  });
});

describe("printingTreatmentNotice — the creator's toast after the frame lands", () => {
  it("borderless names the bordered frame the card actually got", () => {
    expect(printingTreatmentNotice("borderless", "m15")).toBe(
      "This printing is borderless — PipGlyph used the bordered M15 (2015) Standard frame.",
    );
    expect(printingTreatmentNotice("borderless", "m15pw")).toBe(
      "This printing is borderless — PipGlyph used the bordered M15 (2015) Planeswalker frame.",
    );
  });

  it("never calls a borderless or showcase frame 'bordered' (the signature registry lands some there)", () => {
    // FRA #382–396 land on the borderless full-art basic; a full-art poster
    // or source-material printing on Borderless; BLB woodland on its showcase.
    expect(printingTreatmentNotice("borderless", "fullartland")).toBe(
      "This printing is borderless — PipGlyph used the Full Art Borderless Basic Land frame.",
    );
    expect(printingTreatmentNotice("borderless", "m15borderless")).toBe(
      "This printing is borderless — PipGlyph used the M15 (2015) Borderless frame.",
    );
    expect(printingTreatmentNotice("borderless", "bloomburrow")).not.toMatch(/bordered/);
    // A layout frame is still an ordinary bordered frame.
    expect(printingTreatmentNotice("borderless", "saga")).toBe(
      "This printing is borderless — PipGlyph used the bordered M15 (2015) Saga frame.",
    );
  });

  it("full art / textless / showcase / extended art name the landed frame", () => {
    expect(printingTreatmentNotice("fullart", "m15land")).toBe(
      "This printing is full art — PipGlyph used the M15 (2015) Land frame.",
    );
    expect(printingTreatmentNotice("fullart", "m15token")).toBe(
      "This printing is full art — PipGlyph used the M15 (2015) Token (2014–2019) frame.",
    );
    expect(printingTreatmentNotice("textless", "m15")).toBe(
      "This printing is textless — PipGlyph used the M15 (2015) Standard frame.",
    );
    expect(printingTreatmentNotice("showcase", "m15")).toBe(
      "This printing has a showcase frame — PipGlyph used the M15 (2015) Standard frame.",
    );
    expect(printingTreatmentNotice("extendedart", "modern")).toBe(
      "This printing has extended art — PipGlyph used the Modern border (2003) Standard frame.",
    );
  });
});

// Frames plan 4.32 / 4.39: the borderless M15 frame and the full-art basic.
// A borderless card still lands on the bordered frame (1.18) and the
// creator OFFERS Borderless, once the owner has verified it in the card's
// colour. A full-art or borderless basic lands on its full-art frame itself
// (the signature registry), so it needs no offer.
describe("printingTreatmentOffer — PipGlyph's frame for the treatment, once verified", () => {
  const patchOf = (key: PrintingKey) => mapScryfallToFormPatch(printing(key));
  const verified = (...keys: [string, string][]) => new Set(keys.map(([t, k]) => frameComboKey(t, k)));

  it("offers nothing while the frame is unverified (today)", () => {
    for (const key of Object.keys(printings) as PrintingKey[]) {
      expect(printingTreatmentOffer(patchOf(key), new Set()), key).toBeNull();
    }
    expect(patchOf("dmu-435").frame_template).toBe("m15");
    expect(patchOf("one-262").frame_template).toBe("m15fullartland");
  });

  it("offers Borderless for a borderless creature or enchantment once verified in its colour", () => {
    // Sheoldred DMU #435 (black) — the crown is 4.6's, so this is `nearest`.
    expect(printingTreatmentOffer(patchOf("dmu-435"), verified(["m15borderless", "b"]))).toEqual({
      template: "m15borderless",
      frameLabel: "Borderless",
      actionLabel: "Use Borderless",
    });
    // Verified in another colour only: nothing.
    expect(printingTreatmentOffer(patchOf("dmu-435"), verified(["m15borderless", "w"]))).toBeNull();
    // BLB #316 (a borderless red showcase enchantment): the nearest look.
    expect(printingTreatmentOffer(patchOf("blb-316"), verified(["m15borderless", "r"]))?.template).toBe(
      "m15borderless",
    );
    // A black-bordered showcase or extended-art printing has no offer.
    expect(printingTreatmentOffer(patchOf("tdm-400"), verified(["m15borderless", "w"]))).toBeNull();
    expect(printingTreatmentOffer(patchOf("dmu-384"), verified(["m15borderless", "w"]))).toBeNull();
  });

  it("offers the artifact dress for an artifact or an Artifact Creature, and nothing for kinds the pack can't draw", () => {
    const base = { printing_treatment: "borderless" as const, color_identity: ["colorless" as const] };
    const keys = verified(["m15borderless", "c"], ["m15borderlessartifact", "c"]);
    expect(printingTreatmentOffer({ ...base, kind: "artifact", card_type: "artifact" }, keys)?.template).toBe(
      "m15borderlessartifact",
    );
    expect(
      printingTreatmentOffer({ ...base, kind: "creature", card_type: "creature", supertype: "Artifact" }, keys)
        ?.template,
    ).toBe("m15borderlessartifact");
    expect(printingTreatmentOffer({ ...base, kind: "creature", card_type: "creature" }, keys)?.template).toBe(
      "m15borderless",
    );
    for (const kind of ["planeswalker", "land", "token", "saga", "battle"] as const) {
      expect(printingTreatmentOffer({ ...base, kind }, keys), kind).toBeNull();
    }
  });

  it("offers Borderless Land for a borderless nonbasic land once verified in its colour (4.34)", () => {
    // Arena of Glory MH3 #351: the registry's exact borderless land, landing
    // on the bordered land frame (1.18) — the creator offers the rest.
    const mh3 = patchOf("mh3-351");
    expect(mh3.printing_treatment).toBe("borderless");
    expect(mh3.color_identity).toEqual(["red"]);
    expect(mh3.frame_match).toMatchObject({ status: "exact", template: "m15borderlessland", landOn: "m15land" });
    expect(mh3.frame_template).toBe("m15land");
    expect(printingTreatmentOffer(mh3, verified(["m15borderlessland", "r"]))).toEqual({
      template: "m15borderlessland",
      frameLabel: "Borderless Land",
      actionLabel: "Use Borderless Land",
    });
    // Unverified, verified in another colour, or only the spells' frame: nothing.
    expect(printingTreatmentOffer(mh3, new Set())).toBeNull();
    expect(printingTreatmentOffer(mh3, verified(["m15borderlessland", "u"]))).toBeNull();
    expect(printingTreatmentOffer(mh3, verified(["m15borderless", "r"], ["fullartland", "r"]))).toBeNull();
    // Deserted Beach MID #281, two colours: the gold land, nearest until
    // 4.6's split pinline — offered like a two-colour spell's gold frame.
    const mid = patchOf("mid-281");
    expect(mid.frame_match).toMatchObject({ status: "nearest", template: "m15borderlessland", blockedBy: "4.6" });
    expect(printingTreatmentOffer(mid, verified(["m15borderlessland", "m"]))?.template).toBe("m15borderlessland");
    // A basic keeps its full-art offers, never the nonbasic land's.
    const keys = verified(["m15borderlessland", "w"], ["fullartland", "w"]);
    expect(printingTreatmentOffer(patchOf("fra-382"), keys)?.template).toBe("fullartland");
    expect(printingTreatmentOffer(patchOf("unf-235"), keys)).toBeNull();
  });

  it("offers the borderless planeswalker (4.33) — the tall box for four printed rows — once verified in its colour", () => {
    // Basri Ket M21 #280 (three rows) and Teferi, Master of Time M21 #281
    // (a static + three abilities) land on the bordered m15pw (1.18).
    const walkerOf = (key: "m21-280" | "m21-281") =>
      mapScryfallToFormPatch(scryfallCardSchema.parse(signaturePrintings[key]));
    expect(walkerOf("m21-280").frame_template).toBe("m15pw");
    expect(printingTreatmentOffer(walkerOf("m21-280"), verified(["m15borderlesspw", "w"]))).toEqual({
      template: "m15borderlesspw",
      frameLabel: "Borderless Planeswalker",
      actionLabel: "Use Borderless Planeswalker",
    });
    expect(printingTreatmentOffer(walkerOf("m21-281"), verified(["m15borderlesspwtall", "u"]))?.template).toBe(
      "m15borderlesspwtall",
    );
    // Only the box the rows pick, and only verified in the card's colour.
    expect(printingTreatmentOffer(walkerOf("m21-281"), verified(["m15borderlesspw", "u"]))).toBeNull();
    expect(printingTreatmentOffer(walkerOf("m21-280"), verified(["m15borderlesspw", "u"]))).toBeNull();
  });

  it("lands a full-art basic on the black-bordered full-art basic itself, once verified (no offer)", () => {
    // ONE #262 and FDN #282 print the 2022 design (title bar + left disc):
    // FDN exact, ONE nearest (its 2023 bars). The mapper colours a Plains
    // white.
    const keys = verified(["m15fullartland", "w"]);
    for (const key of ["one-262", "fdn-282"] as const) {
      expect(patchOf(key).color_identity, key).toEqual(["white"]);
      expect(patchOf(key).printing_detail?.set, key).toBe(key.slice(0, 3));
      expect(patchOf(key).frame_template, key).toBe("m15fullartland");
      expect(printingTreatmentOffer(patchOf(key), keys), key).toBeNull();
    }
    expect(patchOf("fdn-282").frame_match?.status).toBe("exact");
    expect(patchOf("one-262").frame_match?.status).toBe("nearest");
    // The other designs are the registry's `nearest` full-art basic: BFZ
    // #250 / ZNR #266 (Zendikar's split bar, 4.40) and SPM #189 (the plain
    // bar, 4.41; pinned by set, not date) land on it too, named nearest.
    for (const key of ["bfz-250", "znr-266", "spm-189"] as const) {
      expect(patchOf(key).printing_treatment, key).toBe("fullart");
      expect(patchOf(key).frame_match?.status, key).toBe("nearest");
      expect(patchOf(key).frame_template, key).toBe("m15fullartland");
      expect(printingTreatmentOffer(patchOf(key), keys), key).toBeNull();
    }
    expect([...FULL_ART_BASIC_2022_SETS]).not.toContain("spm");
    expect([...FULL_ART_BASIC_2022_SETS]).not.toContain("sos");
    // FIN #309, the one printed left-disc Wastes: colourless, once c is verified.
    expect(patchOf("fin-309").color_identity).toEqual(["colorless"]);
    expect(patchOf("fin-309").frame_template).toBe("m15fullartland");
    // A full-art creature: nothing.
    expect(printingTreatmentOffer(patchOf("sch-3"), verified(["m15fullartland", "b"]))).toBeNull();
  });

  it("an older patch without the registry's frame still gets the 2022-design offer", () => {
    const keys = verified(["m15fullartland", "w"]);
    const old = { ...patchOf("fdn-282"), frame_template: "m15land" as const, frame_match: undefined };
    expect(printingTreatmentOffer(old, keys)).toEqual({
      template: "m15fullartland",
      frameLabel: "Full-Art Basic",
      actionLabel: "Use Full-Art Basic",
    });
    // …and a payload without printing_detail: nothing.
    expect(printingTreatmentOffer({ ...old, printing_detail: undefined }, keys)).toBeNull();
    // BFZ's split bar was never offered the 2022 frame.
    const bfz = { ...patchOf("bfz-250"), frame_template: "m15land" as const };
    expect(printingTreatmentOffer(bfz, keys)).toBeNull();
  });

  it("offers the borderless full-art basic for a borderless basic that prints text, never a textless one", () => {
    // FRA #382: borderless, full art, the title bar + left disc (dark bars:
    // the nearest look, owner decision 4.39). The registry names
    // fullartland, but the import lands on the land frame (1.18: its
    // art_crop is the 626×457 window) and the creator OFFERS it.
    const fra = patchOf("fra-382");
    expect(fra.printing_treatment).toBe("borderless");
    expect(fra.printing_detail).toEqual({ set: "fra", fullArt: true, textless: false });
    expect(fra.frame_match).toMatchObject({ status: "nearest", template: "fullartland", landOn: "m15land" });
    expect(fra.frame_template).toBe("m15land");
    expect(printingTreatmentOffer(fra, verified(["fullartland", "w"]))).toEqual({
      template: "fullartland",
      frameLabel: "Borderless Full-Art Basic",
      actionLabel: "Use Borderless Full-Art Basic",
    });
    // Unverified, or only the borderless M15 frame verified: nothing.
    expect(printingTreatmentOffer(fra, verified(["m15borderless", "w"], ["m15fullartland", "w"]))).toBeNull();
    // UNF #235 is textless: m15textlessland's (4.35), no offer.
    const unf = patchOf("unf-235");
    expect(unf.printing_detail?.textless).toBe(true);
    expect(unf.frame_template).toBe("m15textlessland");
    expect(printingTreatmentOffer(unf, verified(["fullartland", "w"], ["m15borderless", "w"]))).toBeNull();
  });
});
