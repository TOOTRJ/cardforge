import { describe, expect, it } from "vitest";
import {
  buildTypeLine,
  displayLine,
  parseChapters,
  showsPowerToughness,
  slotLine,
} from "@/lib/cards/card-display";

describe("parseChapters", () => {
  it("parses one chapter per Roman-numeral line", () => {
    expect(
      parseChapters("I — Draw a card.\nII — Scry 2.\nIII — Gain 3 life."),
    ).toEqual([
      { marker: "I", text: "Draw a card." },
      { marker: "II", text: "Scry 2." },
      { marker: "III", text: "Gain 3 life." },
    ]);
  });

  it("keeps grouped markers and normalizes their spacing", () => {
    expect(parseChapters("I, II — Draw a card.\nIII — Discard.")).toEqual([
      { marker: "I,II", text: "Draw a card." },
      { marker: "III", text: "Discard." },
    ]);
  });

  it("accepts colon and hyphen separators, lowercase numerals", () => {
    expect(parseChapters("i: Add {G}.\nii - Untap a land.")).toEqual([
      { marker: "I", text: "Add {G}." },
      { marker: "II", text: "Untap a land." },
    ]);
  });

  it("appends marker-less lines to the previous chapter", () => {
    expect(
      parseChapters("I — Create a token\nwith vigilance.\nII — Draw."),
    ).toEqual([
      { marker: "I", text: "Create a token with vigilance." },
      { marker: "II", text: "Draw." },
    ]);
  });

  it("does not treat a sentence starting with 'I' as a chapter", () => {
    expect(parseChapters("Improvise. Whenever you cast a spell, scry 1.")).toEqual(
      [],
    );
  });

  it("returns [] for empty or missing text", () => {
    expect(parseChapters("")).toEqual([]);
    expect(parseChapters(null)).toEqual([]);
    expect(parseChapters(undefined)).toEqual([]);
  });
});

describe("showsPowerToughness", () => {
  it("creature and token show P/T regardless of subtypes", () => {
    expect(showsPowerToughness("creature")).toBe(true);
    expect(showsPowerToughness("token", [])).toBe(true);
  });

  it("Vehicle/Spacecraft subtypes show P/T on non-creatures", () => {
    // Vehicles print crewed stats, Spacecraft stationed stats; both render
    // a P/T box on the real card even though they're artifacts.
    expect(showsPowerToughness("artifact", ["Vehicle"])).toBe(true);
    expect(showsPowerToughness("artifact", ["Spacecraft"])).toBe(true);
    // Case/whitespace tolerant for hand-typed subtypes.
    expect(showsPowerToughness("artifact", [" vehicle "])).toBe(true);
  });

  it("other artifacts still hide P/T", () => {
    expect(showsPowerToughness("artifact")).toBe(false);
    expect(showsPowerToughness("artifact", ["Equipment"])).toBe(false);
    expect(showsPowerToughness("enchantment", [])).toBe(false);
  });
});

describe("displayLine", () => {
  const NBSP = "\u00a0";

  it("joins every inner space run into one no-break space", () => {
    expect(displayLine("Jester's Mask")).toBe(`Jester's${NBSP}Mask`);
    expect(displayLine("Jace,  the\tMind-Sculptor")).toBe(`Jace,${NBSP}the${NBSP}Mind-Sculptor`);
    expect(displayLine(buildTypeLine({ supertype: "Legendary", cardType: "creature", subtypes: ["Human", "Knight"] }))).toBe(
      `Legendary${NBSP}Creature${NBSP}—${NBSP}Human${NBSP}Knight`,
    );
  });

  it("returns a line without inner spaces unchanged", () => {
    for (const text of ["Bogardan", "Instant", "Mind-Sculptor", "", " Lead ", "Trail "]) {
      expect(displayLine(text)).toBe(text);
    }
  });

  it("only rewrites display-font slots", () => {
    expect(slotLine("display", "Art: Nene Thomas")).toBe(`Art:${NBSP}Nene${NBSP}Thomas`);
    expect(slotLine("body", "Art: Nene Thomas")).toBe("Art: Nene Thomas");
    expect(slotLine(undefined, "Art: Nene Thomas")).toBe("Art: Nene Thomas");
  });
});
