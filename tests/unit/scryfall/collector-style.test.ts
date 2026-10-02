import { describe, expect, it } from "vitest";
import printings from "./fixtures/collector-style-printings.json";
import { scryfallCardSchema, type ScryfallCard } from "@/lib/scryfall/client";
import {
  COLLECTOR_2023_FROM,
  COLLECTOR_2023_STYLE_EARLY,
  COLLECTOR_2023_STYLE_EARLY_FROM,
  collectorStyleOfPrinting,
  mapScryfallToFormPatch,
  starOfPrinting,
} from "@/lib/scryfall/import-mapper";
import { importedAnatomy } from "@/lib/cards/anatomy";

// ---------------------------------------------------------------------------
// TODO 4.9b — which collector style an import draws, pinned by the scans of
// every 2015-frame paper printing released between ONE / ONC (2023-02-10)
// and SLD #1242 (2023-03-26) — scratchpad collector-line/boundary/contact
// .png, 2026-09-30 — and the ★ of a foil-only printing. Fixtures: real
// Scryfall payloads (/cards/:set/:number and the /cards/search of that
// window), trimmed like collector-printings.json; every expectation below
// was read off the printed card's bottom line.
//
// The finding: the two styles overlap by PRODUCT for six weeks. The 2023
// style is already on PL23 #1 ("P 0001", 02-10), SLD #8001 ("M 8001",
// 02-17), SLP #1 ("P 0001", 02-19) and SLD #1243 ("R 1243", 02-20), while
// the Secret Lair bonus cards #685 ("685 R", 02-20), #716 ("716 P", 02-21)
// and #681 ("681 R", 03-16), PRCQ #1 ("001/003 P", 02-25), SCH #7 ("007 P",
// 02-25), PW23 #1 ("001/001 P", 03-10) and P30H #1 ("001/005 P", 03-21)
// still print the 2015 style. From 2023-03-26 (SLD #728 "R 0728", #1237
// "R 1237", #1242 "R 1242") every scan is 2023-style. So the date is the
// first day with ONLY the new style, and the early products are listed.
//
// The early list never reaches back before its first product (PL23 #1,
// 2023-02-10 — the skeptic's scans, 2026-10-02): Secret Lair has numbers
// past 1243 that are a year older. SLD #9995–9999 (2022-04-12, the mirrored
// "left-handed" drop) print the 2015 style, mirrored — the number alone at
// the edge, the letter in its column ("M      9995").
// ---------------------------------------------------------------------------

type Key = keyof typeof printings;
const printing = (key: Key): ScryfallCard => scryfallCardSchema.parse(printings[key]);

describe("the style boundary (COLLECTOR_2023_FROM)", () => {
  it("is 2023-03-26: the first release day on which every printing is 2023-style", () => {
    expect(COLLECTOR_2023_FROM).toBe("2023-03-26");
  });

  it.each([
    ["one-19", "2015", "ONE #19 (2023-02-10): 019/271 R — the last expansion in the 2015 style"],
    ["onc-114", "2015", "ONC #114 (2023-02-10): 114 R"],
    ["onc-29", "2015", "ONC #29 (2023-02-10, etched): 029 M"],
    ["dom-1", "2015", "DOM #1 (2018): 001/269 M, a planeswalker"],
    ["tdom-1", "2015", "TDOM #1 (2018): 001/016 T"],
    ["kld-265", "2015", "KLD #265 (2016): 265/264 M"],
    ["sld-685", "2015", "SLD #685 (2023-02-20, a bonus card): 685 R"],
    ["sld-716", "2015", "SLD #716 (2023-02-21, a bonus card): 716 P"],
    ["sld-681", "2015", "SLD #681 (2023-03-16, a bonus card): 681 R"],
    ["sld-9995", "2015", "SLD #9995 (2022-04-12, the mirrored drop): 9995 M — past #1243, a year before the early products"],
    ["sld-9999", "2015", "SLD #9999 (2022-04-12, the mirrored drop): 9999 R"],
    ["prcq-1", "2015", "PRCQ #1 (2023-02-25): 001/003 P"],
    ["sch-7", "2015", "SCH #7 (2023-02-25): 007 P"],
    ["pw23-1", "2015", "PW23 #1 (2023-03-10): 001/001 P"],
    ["p30h-1", "2015", "P30H #1 (2023-03-21): 001/005 P — the LAST 2015-style printing"],
    ["pl23-1", "2023", "PL23 #1 (2023-02-10): P 0001 — early"],
    ["sld-8001", "2023", "SLD #8001 (2023-02-17): M 8001 — early"],
    ["slp-1", "2023", "SLP #1 (2023-02-19): P 0001 — early"],
    ["sld-1243", "2023", "SLD #1243 (2023-02-20): R 1243 — early"],
    ["sld-728", "2023", "SLD #728 (2023-03-26, a bonus card): R 0728 — the pin"],
    ["sld-1237", "2023", "SLD #1237 (2023-03-26): R 1237"],
    ["sld-1242", "2023", "SLD #1242 (2023-03-26): R 1242"],
    ["moc-1", "2023", "MOC #1 (2023-04-21): M 0001"],
    ["fdn-280", "2023", "FDN #280 (2024): L 0280, a basic land"],
    ["tfdn-24", "2023", "TFDN #24 (2024): E 0024, an emblem"],
  ] as const)("%s → %s (%s)", (key, style, _why) => {
    void _why;
    expect(collectorStyleOfPrinting(printing(key))).toBe(style);
  });

  it("the early products: by set, SLD only from #1243", () => {
    expect(COLLECTOR_2023_STYLE_EARLY).toEqual({ pl23: {}, slp: {}, sld: { fromNumber: 1243 } });
    const early = printing("sld-1243");
    expect(collectorStyleOfPrinting({ ...early, collector_number: "1242" })).toBe("2015"); // before the pin, below 1243
    expect(collectorStyleOfPrinting({ ...early, collector_number: "8001" })).toBe("2023");
    expect(collectorStyleOfPrinting({ ...early, collector_number: "1242", released_at: "2023-03-26" })).toBe("2023");
    // A number with a suffix reads by its digits; one with none is never early.
    expect(collectorStyleOfPrinting({ ...early, collector_number: "1243★" })).toBe("2023");
    expect(collectorStyleOfPrinting({ ...early, collector_number: "1242a" })).toBe("2015");
    expect(collectorStyleOfPrinting({ ...early, collector_number: "SLD-1" })).toBe("2015");
    expect(collectorStyleOfPrinting({ ...early, collector_number: null })).toBe("2015");
    // …and only from the first early product's day on: nothing before
    // 2023-02-10 prints the 2023 style, whatever its set and number.
    expect(COLLECTOR_2023_STYLE_EARLY_FROM).toBe("2023-02-10");
    expect(collectorStyleOfPrinting({ ...early, released_at: "2023-02-10" })).toBe("2023");
    expect(collectorStyleOfPrinting({ ...early, released_at: "2023-02-09" })).toBe("2015");
    expect(collectorStyleOfPrinting({ ...early, collector_number: "9995", released_at: "2022-04-12" })).toBe("2015");
    expect(collectorStyleOfPrinting({ ...printing("pl23-1"), released_at: "2022-12-31" })).toBe("2015");
    // A promo with no release date takes the current style, as the stored
    // number does (storedCollectorNumber).
    expect(collectorStyleOfPrinting({ ...printing("one-19"), released_at: null })).toBe("2023");
  });

  it("a pre-2015 frame prints no collector line: off, whatever frame the card lands on", () => {
    for (const frame of ["1993", "1997", "2003", "future"]) {
      expect(collectorStyleOfPrinting({ ...printing("one-19"), frame }), frame).toBe("off");
    }
    const patch = mapScryfallToFormPatch({ ...printing("one-19"), frame: "2003" });
    expect(patch.printed_collector).toBe("off");
    expect(importedAnatomy(patch, "m15").style.collector).toBe("off");
  });
});

describe("the ★ (starOfPrinting)", () => {
  it("a foil-only printing — KLD #265 'KLD★EN' — and an etched-only one — ONC #29 'ONC★EN'; never a nonfoil or a both-finish printing", () => {
    expect(printing("kld-265").finishes).toEqual(["foil"]);
    expect(starOfPrinting(printing("kld-265"))).toBe(true);
    expect(printing("onc-29").finishes).toEqual(["etched"]);
    expect(starOfPrinting(printing("onc-29"))).toBe(true);
    expect(starOfPrinting(printing("onc-114"))).toBeUndefined(); // ["nonfoil"]: "ONC • EN"
    expect(starOfPrinting(printing("sld-1242"))).toBeUndefined(); // ["nonfoil", "foil"]: "SLD • EN"
    expect(starOfPrinting(printing("one-19"))).toBeUndefined();
    expect(starOfPrinting({ finishes: [] })).toBeUndefined();
    expect(starOfPrinting({ finishes: null })).toBeUndefined();
    expect(starOfPrinting({ finishes: ["foil", "etched"] })).toBe(true);
  });

  it("rides the patch and the import's switches", () => {
    const kld = mapScryfallToFormPatch(printing("kld-265"));
    expect(kld.printed_collector).toBe("2015");
    expect(kld.printed_star).toBe(true);
    expect(importedAnatomy(kld, "m15").style).toMatchObject({ collector: "2015", star: true });
    const onc = mapScryfallToFormPatch(printing("onc-114"));
    expect(onc.printed_star).toBeUndefined();
    expect("star" in importedAnatomy(onc, "m15").style).toBe(false);
  });
});

describe("the patch for every fixture", () => {
  it("names a collector style for every 2015-frame printing — never off, never absent", () => {
    for (const key of Object.keys(printings) as Key[]) {
      const patch = mapScryfallToFormPatch(printing(key));
      expect(["2015", "2023"], key).toContain(patch.printed_collector);
    }
  });
});
