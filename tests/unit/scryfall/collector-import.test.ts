import { describe, expect, it } from "vitest";
import printings from "./fixtures/collector-printings.json";
import sets from "./fixtures/collector-sets.json";
import { scryfallCardSchema, scryfallSetSchema, type ScryfallCard, type ScryfallSet } from "@/lib/scryfall/client";
import {
  COLLECTOR_2023_FROM,
  DECK_SET_COUNT_PRINTED_BEFORE,
  OVERSIZE_NUMBER_ALONE_FROM,
  PRINTED_SET_CODE_EXCEPTIONS,
  collectorFieldsFromPrinting,
  isCollector2023Style,
  mapScryfallToFormPatch,
  needsScryfallSet,
} from "@/lib/scryfall/import-mapper";
import { FRAME_ANATOMY_KEYS } from "@/lib/cards/anatomy";
import { cardCollectorNumberSchema, cardLangSchema, cardSetCodeSchema } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// The collector fields an import fills (TODO 4.9a; owner 2026-09-29: imports
// follow the printing) — the 4.9 design's §4.3 table, held to real
// printings. Fixtures: real Scryfall payloads (/cards/search by set, number
// and language, and /sets/:code, captured 2026-09-30 through the real
// client — searchCardsWithOutcome and getScryfallSet), trimmed to identity
// + the fields the mapper reads, oracle text stripped, and parsed through
// the same zod schemas the routes use — no network in tests. Keys are
// "set-collector_number" (+ "-lang" off English). The 2026-09-30 skeptic
// additions (mh1-255, znr-281, dmu-282, c20-1, znc-1, c21-1, onc-1, onc-29
// and their sets) came from /cards/:set/:number and /sets/:code directly,
// trimmed the same way; every expectation below was read off the printed
// card's bottom line (Scryfall's scan), not off the design's table.
// ---------------------------------------------------------------------------

type PrintingKey = keyof typeof printings;
type SetKey = keyof typeof sets;

const printing = (key: PrintingKey): ScryfallCard => scryfallCardSchema.parse(printings[key]);
const set = (key: SetKey): ScryfallSet => scryfallSetSchema.parse(sets[key]);
const setOf = (card: ScryfallCard): ScryfallSet => set(card.set as SetKey);

describe("collectorFieldsFromPrinting — the design's table, on real printings", () => {
  it.each([
    // [fixture, printed set code, stored number, language, why]
    ["dmu-107", "DMU", "107/281", "en", "2015 era, expansion: N/printed_size"],
    ["dmu-107-es", "DMU", "107/281", "es", "the Spanish printing: the same line, lang es"],
    ["kld-265", "KLD", "265/264", "en", "before ELD a number past the printed size keeps it (prints 265/264)"],
    ["mh1-255", "MH1", "255/254", "en", "the last months before ELD (2019-06): still 255/254"],
    ["znr-281", "ZNR", "281", "en", "from ELD on a number past the printed size prints alone (281 M)"],
    ["dmu-282", "DMU", "282", "en", "a 2022 showcase past the 281: prints 282, no size"],
    ["tdom-1", "DOM", "1/16", "en", "a token set prints its PARENT; 2015 era: N/card_count"],
    ["tfdn-24", "FDN", "24", "en", "an emblem in a 2024 token set: the parent, the number alone"],
    ["c17-1", "C17", "1/309", "en", "a 2017 Commander deck prints the whole deck set's count (001/309)"],
    ["c20-1", "C20", "1/322", "en", "the last deck set printing its whole count (001/322, 2020-04)"],
    ["znc-1", "ZNC", "1", "en", "ZNC (2020-09) prints the number alone; Scryfall has no printed_size"],
    ["c21-1", "C21", "1/81", "en", "from C21 the NEW-card count (001/081), Scryfall's printed_size"],
    ["onc-1", "ONC", "1/28", "en", "ONC's new cards print 001/028"],
    ["onc-29", "ONC", "29", "en", "an ONC reprint past the 28 prints 029, no size"],
    ["onc-114", "ONC", "114", "en", "the same: 114 R, no size (printed_size 28 is the new-card count)"],
    ["pw23-3", "PRM", "3", "ph", "PRINTED_SET_CODE_EXCEPTIONS: PW23 prints PRM; a promo's number alone"],
    ["fdn-1", "FDN", "1", "en", "2023 era, core: the number as-is"],
    ["pjud-11-he", "JUD", "11", "he", "a Hebrew printing: lang he (stored, prints nothing); a promo set's parent"],
    ["sld-134", "SLD", "134", "en", "a 2020 Secret Lair (box): the number alone (prints 134 R)"],
  ] as const)("%s → %s · %s · %s (%s)", (key, setCode, number, lang, _why) => {
    void _why;
    const card = printing(key);
    expect(collectorFieldsFromPrinting(card, setOf(card))).toEqual({
      set_code: setCode,
      collector_number: number,
      lang,
    });
  });

  it("every stored value passes the column's zod schema (and so its CHECK)", () => {
    for (const key of Object.keys(printings) as PrintingKey[]) {
      const card = printing(key);
      const fields = collectorFieldsFromPrinting(card, setOf(card));
      expect(fields, key).toBeDefined();
      expect(cardSetCodeSchema.safeParse(fields!.set_code).success, key).toBe(true);
      expect(cardCollectorNumberSchema.safeParse(fields!.collector_number).success, key).toBe(true);
      expect(cardLangSchema.safeParse(fields!.lang).success, key).toBe(true);
    }
  });

  it("fills nothing when the set data it needs is missing — never a guessed parent or size", () => {
    // A 2015-era expansion needs the printed size; a token set its parent;
    // a 2015-era commander deck its count.
    expect(collectorFieldsFromPrinting(printing("dmu-107"), null)).toBeUndefined();
    expect(collectorFieldsFromPrinting(printing("dmu-107"), undefined)).toBeUndefined();
    expect(collectorFieldsFromPrinting(printing("tfdn-24"), null)).toBeUndefined();
    expect(collectorFieldsFromPrinting(printing("c17-1"), null)).toBeUndefined();
    expect(collectorFieldsFromPrinting(printing("onc-114"), null)).toBeUndefined();
    // A 2023-era core set, a box set and the PW23 exception need no set at
    // all.
    expect(collectorFieldsFromPrinting(printing("fdn-1"), null)).toEqual({ set_code: "FDN", collector_number: "1", lang: "en" });
    expect(collectorFieldsFromPrinting(printing("sld-134"), null)).toEqual({ set_code: "SLD", collector_number: "134", lang: "en" });
    expect(collectorFieldsFromPrinting(printing("pw23-3"), null)).toEqual({ set_code: "PRM", collector_number: "3", lang: "ph" });
  });

  it("needsScryfallSet: at most one extra call, only where the line reads the set", () => {
    const needs = Object.fromEntries(
      (Object.keys(printings) as PrintingKey[]).map((key) => [key, needsScryfallSet(printing(key))]),
    );
    expect(needs).toEqual({
      "dmu-107": true, // the printed size
      "dmu-107-es": true,
      "kld-265": true,
      "mh1-255": true,
      "znr-281": true,
      "dmu-282": true,
      "tdom-1": true, // the parent and the token count
      "tfdn-24": true, // the parent
      "c17-1": true, // the deck set's count
      "c20-1": true,
      "znc-1": true, // asked (the set decides); nothing to print
      "c21-1": true,
      "onc-1": true,
      "onc-29": true,
      "onc-114": true,
      "pw23-3": false, // the exception names the code; a promo's number is alone
      "fdn-1": false,
      "pjud-11-he": true, // the parent
      "sld-134": false,
    });
  });

  it("the over-size rule turns at ELD (2019-10-04): the size stays before, the number is alone from then on", () => {
    expect(OVERSIZE_NUMBER_ALONE_FROM).toBe("2019-10-04");
    const znr = printing("znr-281"); // 281 > printed_size 280
    expect(collectorFieldsFromPrinting({ ...znr, released_at: "2019-10-03" }, set("znr"))?.collector_number).toBe("281/280");
    expect(collectorFieldsFromPrinting({ ...znr, released_at: "2019-10-04" }, set("znr"))?.collector_number).toBe("281");
    // A number AT the size keeps it on both sides (KLD #264 prints 264/264).
    expect(collectorFieldsFromPrinting({ ...znr, collector_number: "280" }, set("znr"))?.collector_number).toBe("280/280");
  });

  it("a commander deck set prints its whole count before ZNC (2020-09-25) and Scryfall's printed_size from C21", () => {
    expect(DECK_SET_COUNT_PRINTED_BEFORE).toBe("2020-09-25");
    const c20 = printing("c20-1"); // card_count 322, no printed_size
    expect(collectorFieldsFromPrinting({ ...c20, released_at: "2020-09-24" }, set("c20"))?.collector_number).toBe("1/322");
    expect(collectorFieldsFromPrinting({ ...c20, released_at: "2020-09-25" }, set("c20"))?.collector_number).toBe("1");
    // With a printed_size the date doesn't matter (C21: the new-card count).
    expect(collectorFieldsFromPrinting(printing("c21-1"), set("c21"))?.collector_number).toBe("1/81");
    expect(collectorFieldsFromPrinting({ ...printing("c21-1"), collector_number: "82" }, set("c21"))?.collector_number).toBe("82");
    // DMC (2022-09) prints 001/048 but Scryfall has no count for it: alone.
    const dmcLike: ScryfallSet = { ...set("c21"), code: "dmc", printed_size: null, card_count: 240 };
    expect(collectorFieldsFromPrinting({ ...printing("c21-1"), set: "dmc", released_at: "2022-09-09" }, dmcLike)?.collector_number).toBe("1");
  });

  it("a 2015-era non-numeric number is stored as printed, without a size", () => {
    const card = { ...printing("dmu-107"), collector_number: "237a" };
    expect(collectorFieldsFromPrinting(card, set("dmu"))?.collector_number).toBe("237a");
    const promoStar = { ...printing("kld-265"), collector_number: "265★" };
    expect(collectorFieldsFromPrinting(promoStar, set("kld"))?.collector_number).toBe("265★");
  });

  it("a 2015-era expansion whose set prints no size stores the number alone", () => {
    const card = printing("dmu-107");
    const sizeless: ScryfallSet = { ...set("dmu"), printed_size: null };
    expect(collectorFieldsFromPrinting(card, sizeless)?.collector_number).toBe("107");
  });

  it("clamps to the columns: a code or number that fits no CHECK is null, an unknown language is English", () => {
    const odd = { ...printing("fdn-1"), set: "a", collector_number: "1".repeat(13), lang: "xx" };
    expect(collectorFieldsFromPrinting(odd, null)).toEqual({ set_code: null, collector_number: null, lang: "en" });
    const spaced = { ...printing("fdn-1"), collector_number: "1 2" };
    expect(collectorFieldsFromPrinting(spaced, null)?.collector_number).toBeNull();
    const none = { ...printing("fdn-1"), set: undefined, collector_number: undefined };
    expect(collectorFieldsFromPrinting(none, null)).toEqual({ set_code: null, collector_number: null, lang: "en" });
  });

  it("the 2023 style starts at SLD #1242 (2023-03-26); a printing with no date stores the number alone", () => {
    expect(COLLECTOR_2023_FROM).toBe("2023-03-26");
    expect(isCollector2023Style("2023-03-25")).toBe(false);
    expect(isCollector2023Style("2023-03-26")).toBe(true);
    expect(isCollector2023Style("2023-02-10")).toBe(false); // ONC
    expect(isCollector2023Style(null)).toBe(true);
    expect(isCollector2023Style("")).toBe(true);
    const undated = { ...printing("dmu-107"), released_at: null };
    expect(needsScryfallSet(undated)).toBe(false);
    expect(collectorFieldsFromPrinting(undated, null)?.collector_number).toBe("107");
  });

  it("the exception table is keyed by Scryfall's lower-case code", () => {
    expect(PRINTED_SET_CODE_EXCEPTIONS).toEqual({ pw23: "PRM" });
  });
});

describe("mapScryfallToFormPatch — the collector fields ride the patch (data only)", () => {
  it("carries `collector` from the printing and its set, and writes no frame_style key", () => {
    const card = printing("tdom-1");
    const patch = mapScryfallToFormPatch(card, { set: setOf(card) });
    expect(patch.collector).toEqual({ set_code: "DOM", collector_number: "1/16", lang: "en" });
    // 4.9a writes no switch: no `collector` / `star` / `stamp` and no
    // anatomy key beyond the ones the printing's crown / two-colour read.
    const keys = Object.keys(patch);
    expect(keys).not.toContain("frame_style");
    for (const key of ["star", "stamp", "printed_collector"]) expect(keys).not.toContain(key);
    for (const key of FRAME_ANATOMY_KEYS) expect(keys).not.toContain(key);
  });

  it("leaves `collector` absent when the printing needs set data the caller had none of", () => {
    expect(mapScryfallToFormPatch(printing("dmu-107")).collector).toBeUndefined();
    expect(mapScryfallToFormPatch(printing("dmu-107"), { set: null }).collector).toBeUndefined();
    expect(mapScryfallToFormPatch(printing("fdn-1")).collector).toEqual({ set_code: "FDN", collector_number: "1", lang: "en" });
  });

  it("the Spanish printing imports as the same card with lang es", () => {
    const patch = mapScryfallToFormPatch(printing("dmu-107-es"), { set: set("dmu") });
    expect(patch.title).toBe("Sheoldred, the Apocalypse");
    expect(patch.collector).toEqual({ set_code: "DMU", collector_number: "107/281", lang: "es" });
  });
});

describe("scryfallSetSchema", () => {
  it("types the set fields the import reads", () => {
    expect(set("dmu")).toMatchObject({ code: "dmu", set_type: "expansion", card_count: 436, printed_size: 281 });
    expect(set("tdom")).toMatchObject({ code: "tdom", set_type: "token", card_count: 16, parent_set_code: "dom" });
    expect(set("fdn").printed_size).toBeUndefined();
    // Unknown fields pass through; a new Scryfall value never fails the parse.
    expect(scryfallSetSchema.parse({ code: "zzz", set_type: "whatever", icon_svg_uri: "x" }).code).toBe("zzz");
  });
});
