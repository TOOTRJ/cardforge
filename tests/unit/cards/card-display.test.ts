import { describe, expect, it } from "vitest";
import { parseChapters } from "@/lib/cards/card-display";

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
