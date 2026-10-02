import { describe, expect, it } from "vitest";
import {
  COLLECTOR_BRUSH_PATH,
  COLLECTOR_STAR_PATH,
  COLLECTOR_TEMPLATES,
  collectorContent,
  collectorLetter,
  collectorLine1Text2023,
  collectorNumberRuns,
  collectorStyleForNumber,
  collectorStyleOf,
  isCollectorStyle,
  isCollectorSwitch,
} from "@/lib/cards/collector-line";
import { PRINTED_LANGS } from "@/lib/cards/collector-fields";

// ---------------------------------------------------------------------------
// TODO 4.9b — the collector line's CONTENT rules (lib/cards/collector-line.ts),
// held to the prints of 2026-09-29/30 (scratchpad collector-line/prints):
// DMU #107 "107/281   M" / "DMU • EN", ONC #114 "114   R", TDOM #1
// "001/016   T" / "DOM • EN", KLD #265 "265/264 M" / "KLD★EN", SLD #1242
// "R 1242", FDN #1 "M 0001", FDN #280 "L 0280", TFDN #24 "E 0024", MOC #1
// "M 0001", the design's §2.2 rules and the owner's decisions (a token's T
// whatever its stored rarity; never a Wizards / ™ / licensor line).
// ---------------------------------------------------------------------------

describe("the switch values", () => {
  it("a style draws the line; off and absent don't", () => {
    expect(isCollectorStyle("2015")).toBe(true);
    expect(isCollectorStyle("2023")).toBe(true);
    expect(isCollectorStyle("off")).toBe(false);
    expect(isCollectorStyle(undefined)).toBe(false);
    expect(isCollectorStyle(true)).toBe(false);
    expect(isCollectorSwitch("off")).toBe(true);
    expect(isCollectorSwitch("on")).toBe(false);
    expect(collectorStyleOf("2015")).toBe("2015");
    expect(collectorStyleOf("off")).toBeNull();
    expect(collectorStyleOf(null)).toBeNull();
  });

  it("switching a stored card on picks the 2015 style for a number with a set size, else 2023 (design §4.1)", () => {
    expect(collectorStyleForNumber("107/281")).toBe("2015");
    expect(collectorStyleForNumber("1/16")).toBe("2015");
    expect(collectorStyleForNumber("107")).toBe("2023");
    expect(collectorStyleForNumber("237a")).toBe("2023");
    expect(collectorStyleForNumber("")).toBe("2023");
    expect(collectorStyleForNumber(null)).toBe("2023");
  });

  it("the wave-1 templates, by name (the profiles test holds the PROFILES entries to them)", () => {
    expect([...COLLECTOR_TEMPLATES]).toEqual([
      "m15",
      "m15land",
      "m15snowland",
      "m15artifact",
      "m15snow",
      "m15devoid",
      "m15pw",
      "m15token",
      "m15tokenartifact",
      "m15tokentext",
      "m15tokenartifacttext",
      "emblem",
    ]);
  });
});

describe("the rarity letter", () => {
  it("T on a token whatever its rarity, E on an emblem, L on a basic land, else C / U / R / M", () => {
    expect(collectorLetter({ cardType: "token", rarity: "rare" })).toBe("T"); // owner 2026-09-29
    expect(collectorLetter({ cardType: "token", supertype: "Creature", rarity: null })).toBe("T");
    expect(collectorLetter({ cardType: "emblem", rarity: "common" })).toBe("E");
    expect(collectorLetter({ cardType: "land", supertype: "Basic", rarity: "common" })).toBe("L"); // FDN #280
    expect(collectorLetter({ cardType: "land", supertype: "Basic Snow", rarity: "common" })).toBe("L");
    expect(collectorLetter({ cardType: "land", supertype: "Legendary", rarity: "rare" })).toBe("R");
    expect(collectorLetter({ cardType: "land", supertype: null, rarity: "common" })).toBe("C");
    expect(collectorLetter({ cardType: "creature", rarity: "common" })).toBe("C");
    expect(collectorLetter({ cardType: "creature", rarity: "uncommon" })).toBe("U");
    expect(collectorLetter({ cardType: "creature", rarity: "rare" })).toBe("R");
    expect(collectorLetter({ cardType: "creature", rarity: "mythic" })).toBe("M");
    expect(collectorLetter({ cardType: "creature", rarity: "Mythic" })).toBe("M");
  });

  it("none for an unrated card, and never for a word that only contains Basic", () => {
    expect(collectorLetter({ cardType: "creature", rarity: null })).toBeNull();
    expect(collectorLetter({ cardType: "creature", rarity: "" })).toBeNull();
    expect(collectorLetter({ cardType: "instant", rarity: "legendary" })).toBeNull();
    expect(collectorLetter({ cardType: "land", supertype: "Basically", rarity: null })).toBeNull();
    expect(collectorLetter({ cardType: "creature", supertype: "Basic", rarity: null })).toBeNull();
  });
});

describe("the number", () => {
  const text = (runs: ReturnType<typeof collectorNumberRuns>) => runs.map((r) => (r.kind === "text" ? r.text : "★")).join("");

  it("2015: the digits and the set size padded to three", () => {
    expect(text(collectorNumberRuns("107/281", "2015"))).toBe("107/281"); // DMU #107
    expect(text(collectorNumberRuns("1/16", "2015"))).toBe("001/016"); // TDOM #1
    expect(text(collectorNumberRuns("265/264", "2015"))).toBe("265/264"); // KLD #265
    expect(text(collectorNumberRuns("114", "2015"))).toBe("114"); // ONC #114
    expect(text(collectorNumberRuns("7", "2015"))).toBe("007"); // SCH #7
    expect(text(collectorNumberRuns("1234/1234", "2015"))).toBe("1234/1234");
  });

  it("2023: the digits padded to four, any set size dropped", () => {
    expect(text(collectorNumberRuns("1242", "2023"))).toBe("1242"); // SLD #1242
    expect(text(collectorNumberRuns("9", "2023"))).toBe("0009"); // MOM #9
    expect(text(collectorNumberRuns("1", "2023"))).toBe("0001"); // FDN #1
    expect(text(collectorNumberRuns("280", "2023"))).toBe("0280"); // FDN #280
    expect(text(collectorNumberRuns("107/281", "2023"))).toBe("0107");
    expect(text(collectorNumberRuns("12345", "2023"))).toBe("12345");
  });

  it("a non-numeric number prints as stored in either style; a ★ in it is the ★ run, a † the glyph", () => {
    for (const style of ["2015", "2023"] as const) {
      expect(text(collectorNumberRuns("237a", style))).toBe("237a");
      expect(text(collectorNumberRuns("H13", style))).toBe("H13");
      expect(text(collectorNumberRuns("XLN-117", style))).toBe("XLN-117");
      expect(collectorNumberRuns("265★", style)).toEqual([{ kind: "text", text: "265" }, { kind: "star" }]);
      expect(collectorNumberRuns("★1", style)).toEqual([{ kind: "star" }, { kind: "text", text: "1" }]);
      expect(collectorNumberRuns("12†", style)).toEqual([{ kind: "text", text: "12†" }]);
    }
  });

  it("nothing for an empty number", () => {
    expect(collectorNumberRuns("", "2015")).toEqual([]);
    expect(collectorNumberRuns("  ", "2023")).toEqual([]);
    expect(collectorNumberRuns(null, "2023")).toEqual([]);
    expect(collectorNumberRuns(undefined, "2015")).toEqual([]);
  });
});

describe("the two lines (collectorContent)", () => {
  const dmu = {
    cardType: "creature",
    supertype: "Legendary",
    rarity: "mythic",
    setCode: "DMU",
    collectorNumber: "107/281",
    lang: "en",
    artistCredit: "Chris Rahn",
    finish: "regular",
  };

  it("DMU #107 in the 2015 style; FDN #1 in the 2023 style", () => {
    const old = collectorContent(dmu, "2015");
    expect(old.line1).toEqual({ style: "2015", letter: "M", number: [{ kind: "text", text: "107/281" }] });
    expect(old.line2).toEqual({ setCode: "DMU", language: "EN", separator: "dot", artist: "Chris Rahn" });
    const modern = collectorContent({ ...dmu, setCode: "FDN", collectorNumber: "1", artistCredit: "Wenfei Ye" }, "2023");
    expect(modern.line1).toEqual({ style: "2023", letter: "M", number: [{ kind: "text", text: "0001" }] });
    expect(collectorLine1Text2023(modern.line1)).toBe("M 0001");
  });

  it("the printed language codes — es prints SP, ko prints KR; the six unverified ones print nothing", () => {
    for (const { code, printed } of PRINTED_LANGS) {
      expect(collectorContent({ ...dmu, lang: code }, "2015").line2.language, code).toBe(printed);
    }
    expect(collectorContent({ ...dmu, lang: "es" }, "2015").line2.language).toBe("SP");
    expect(collectorContent({ ...dmu, lang: "ko" }, "2015").line2.language).toBe("KR");
    for (const code of ["he", "la", "grc", "ar", "sa", "qya", "xx", "", null, undefined]) {
      expect(collectorContent({ ...dmu, lang: code }, "2015").line2.language, String(code)).toBeNull();
    }
  });

  it("the ★ for the star flag and for a foil or etched finish (owner 2026-10-02), the • otherwise", () => {
    expect(collectorContent(dmu, "2015").line2.separator).toBe("dot");
    expect(collectorContent({ ...dmu, star: true }, "2015").line2.separator).toBe("star");
    expect(collectorContent({ ...dmu, finish: "foil" }, "2015").line2.separator).toBe("star");
    expect(collectorContent({ ...dmu, finish: "etched" }, "2015").line2.separator).toBe("star");
    expect(collectorContent({ ...dmu, finish: "showcase" }, "2015").line2.separator).toBe("dot");
    expect(collectorContent({ ...dmu, star: false }, "2015").line2.separator).toBe("dot");
  });

  it("empty fields are left out, never invented; the set code is upper-cased", () => {
    const bare = collectorContent({ cardType: "creature", rarity: "rare", finish: "regular" }, "2023");
    expect(bare.line1).toEqual({ style: "2023", letter: "R", number: [] });
    expect(collectorLine1Text2023(bare.line1)).toBe("R");
    expect(bare.line2).toEqual({ setCode: null, language: null, separator: "dot", artist: null });
    expect(collectorContent({ ...dmu, setCode: " dmu " }, "2015").line2.setCode).toBe("DMU");
    expect(collectorContent({ ...dmu, setCode: "", artistCredit: "  " }, "2015").line2).toMatchObject({ setCode: null, artist: null });
    expect(collectorLine1Text2023({ style: "2023", letter: null, number: [{ kind: "text", text: "0009" }] })).toBe("0009");
    expect(collectorLine1Text2023({ style: "2023", letter: null, number: [] })).toBeNull();
  });

  it("never a Wizards, ™ or licensor line", () => {
    const all = JSON.stringify(collectorContent(dmu, "2015")) + JSON.stringify(collectorContent(dmu, "2023"));
    expect(all).not.toMatch(/Wizards|™|©|MEE|Coast/i);
  });
});

describe("the two glyph paths", () => {
  it("are closed SVG paths of our own, on their boxes", () => {
    expect(COLLECTOR_STAR_PATH).toMatch(/^M[\d. ]+(L[\d. ]+){9}Z$/);
    expect(COLLECTOR_BRUSH_PATH.split("Z").filter(Boolean)).toHaveLength(2);
    for (const n of COLLECTOR_STAR_PATH.match(/[\d.]+/g)!.map(Number)) expect(n).toBeGreaterThanOrEqual(0);
    for (const n of COLLECTOR_STAR_PATH.match(/[\d.]+/g)!.map(Number)) expect(n).toBeLessThanOrEqual(20);
    for (const n of COLLECTOR_BRUSH_PATH.match(/[\d.]+/g)!.map(Number)) expect(n).toBeLessThanOrEqual(40);
  });
});
