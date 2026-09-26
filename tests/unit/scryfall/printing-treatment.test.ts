import { describe, expect, it } from "vitest";
import printings from "./fixtures/treatment-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  frameTemplateFromScryfall,
  mapScryfallToFormPatch,
  printingTreatmentFromScryfall,
  printingTreatmentHint,
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
  // [fixture, treatment the import must name, frame the import lands on].
  // The frame column pins "the stopgap never changes which frame is chosen".
  const cases: Array<[PrintingKey, PrintingTreatment | undefined, FrameTemplate]> = [
    // Plain M15 printing of the same card → no notice.
    ["dmu-107", undefined, "m15"],
    // Sheoldred DMU #435: borderless (legendary + inverted, no showcase).
    ["dmu-435", "borderless", "m15"],
    // Clarion Conqueror TDM #400: black-bordered ghostfire showcase.
    ["tdm-400", "showcase", "m15"],
    // Festival of Embers BLB #316: borderless AND showcase → borderless.
    ["blb-316", "borderless", "m15"],
    // Archangel of Wrath DMU #384: extended art.
    ["dmu-384", "extendedart", "m15"],
    // Overlord of the Floodpits DSK #389: Japan showcase (showcase + full art).
    ["dsk-389", "showcase", "m15"],
    // Full-art basics: ONE #262, FDN #282, BFZ #250, ZNR #266, SPM #189 and
    // FIN #309 (a Wastes) land on m15land.
    ["one-262", "fullart", "m15land"],
    ["fdn-282", "fullart", "m15land"],
    ["bfz-250", "fullart", "m15land"],
    ["znr-266", "fullart", "m15land"],
    ["spm-189", "fullart", "m15land"],
    ["fin-309", "fullart", "m15land"],
    // Borderless basics: FRA #382 (bars) and UNF #235 (textless).
    ["fra-382", "borderless", "m15land"],
    ["unf-235", "borderless", "m15land"],
    // Dark Confidant SCH #3: textless (and full art) → textless, lands on m15.
    ["sch-3", "textless", "m15"],
    // Cat T2XM #4: a full-art 2015 token already lands on its own family.
    ["t2xm-4", undefined, "m15token"],
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

  it("full art / textless / showcase / extended art name the landed frame", () => {
    expect(printingTreatmentNotice("fullart", "m15land")).toBe(
      "This printing is full art — PipGlyph used the M15 (2015) Land frame.",
    );
    expect(printingTreatmentNotice("fullart", "m15token")).toBe(
      "This printing is full art — PipGlyph used the M15 (2015) Token frame.",
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

describe("printingTreatmentHint — the import dialog, before committing", () => {
  it("says the treatment isn't drawn and which kind of frame the import uses", () => {
    expect(printingTreatmentHint("borderless")).toBe(
      "This printing is borderless, which PipGlyph doesn't offer yet — the import uses a bordered frame instead.",
    );
    expect(printingTreatmentHint("textless")).toBe(
      "This printing is textless, which PipGlyph doesn't offer yet — the import uses the regular frame instead.",
    );
  });
});

// Frames plan 4.32 / 4.39: the borderless M15 frame and the full-art basic
// exist now, but the import never picks them — it lands on the plain frame
// (the frame choice above is unchanged) and the creator OFFERS PipGlyph's
// frame, only once the owner has verified it in the card's colour.
describe("printingTreatmentOffer — PipGlyph's frame for the treatment, once verified", () => {
  const patchOf = (key: PrintingKey) => mapScryfallToFormPatch(printing(key));
  const verified = (...keys: [string, string][]) => new Set(keys.map(([t, k]) => frameComboKey(t, k)));

  it("offers nothing while the frame is unverified (today), so the import stays on the plain frame", () => {
    for (const key of Object.keys(printings) as PrintingKey[]) {
      expect(printingTreatmentOffer(patchOf(key), new Set()), key).toBeNull();
    }
    expect(patchOf("dmu-435").frame_template).toBe("m15");
    expect(patchOf("one-262").frame_template).toBe("m15land");
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

  it("offers the black-bordered full-art basic for a 2022-design full-art basic only", () => {
    // ONE #262 and FDN #282 print the 2022 design (title bar + left disc).
    // The mapper colours a Plains white.
    const keys = verified(["m15fullartland", "w"]);
    for (const key of ["one-262", "fdn-282"] as const) {
      expect(patchOf(key).color_identity, key).toEqual(["white"]);
      expect(patchOf(key).printing_detail?.set, key).toBe(key.slice(0, 3));
      expect(printingTreatmentOffer(patchOf(key), keys), key).toEqual({
        template: "m15fullartland",
        frameLabel: "Full-Art Basic",
        actionLabel: "Use Full-Art Basic",
      });
    }
    // Other designs get no offer — it would promise a look the printing
    // doesn't have: BFZ #250 / ZNR #266 (Zendikar's split bar, 4.40) and
    // SPM #189 (the plain bar, 4.41; pinned by set, not date).
    for (const key of ["bfz-250", "znr-266", "spm-189"] as const) {
      expect(patchOf(key).printing_treatment, key).toBe("fullart");
      expect(printingTreatmentOffer(patchOf(key), keys), key).toBeNull();
    }
    expect([...FULL_ART_BASIC_2022_SETS]).not.toContain("spm");
    expect([...FULL_ART_BASIC_2022_SETS]).not.toContain("sos");
    // A patch from an older payload (no printing_detail): nothing.
    expect(printingTreatmentOffer({ ...patchOf("one-262"), printing_detail: undefined }, keys)).toBeNull();
    // FIN #309, the one printed left-disc Wastes: colourless, once c is verified.
    expect(patchOf("fin-309").color_identity).toEqual(["colorless"]);
    expect(printingTreatmentOffer(patchOf("fin-309"), keys)).toBeNull();
    expect(printingTreatmentOffer(patchOf("fin-309"), verified(["m15fullartland", "c"]))?.template).toBe(
      "m15fullartland",
    );
    // A full-art token or a full-art creature: nothing.
    expect(printingTreatmentOffer(patchOf("sch-3"), verified(["m15fullartland", "b"]))).toBeNull();
  });

  it("offers the borderless full-art basic for a borderless basic that prints text, never a textless one", () => {
    // FRA #382: borderless, full art, the title bar + left disc (dark bars:
    // the nearest look, owner decision 4.39).
    const fra = patchOf("fra-382");
    expect(fra.printing_treatment).toBe("borderless");
    expect(fra.printing_detail).toEqual({ set: "fra", fullArt: true, textless: false });
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
    expect(printingTreatmentOffer(unf, verified(["fullartland", "w"], ["m15borderless", "w"]))).toBeNull();
    // The dialog names the offer before the import.
    expect(printingTreatmentHint("borderless", printingTreatmentOffer(fra, verified(["fullartland", "w"])))).toBe(
      "This printing is borderless — the import uses a bordered frame, then offers PipGlyph's Borderless Full-Art Basic frame.",
    );
  });

  it("the dialog's heads-up names the offered frame, or keeps today's copy", () => {
    expect(
      printingTreatmentHint("borderless", { template: "m15borderless", frameLabel: "Borderless", actionLabel: "Use Borderless" }),
    ).toBe("This printing is borderless — the import uses a bordered frame, then offers PipGlyph's Borderless frame.");
    expect(printingTreatmentHint("borderless", null)).toBe(
      "This printing is borderless, which PipGlyph doesn't offer yet — the import uses a bordered frame instead.",
    );
  });
});
