import { describe, expect, it } from "vitest";
import {
  loyaltyFromRulesText,
  resolveLoyaltyRows,
  resolveSagaChapters,
  romanMarker,
  sagaFromRulesText,
  serializeLoyalty,
  serializeSaga,
} from "@/lib/cards/face-content";
import {
  parseChapters,
  parseLoyaltyAbilities,
} from "@/lib/cards/card-display";
import type { FaceContent } from "@/types/card";

// The whole feature hangs on one invariant: parse(serialize(rows)) === rows,
// so a legacy card (parsed rules_text) and a structured card (face_content +
// the serialized rules_text the form dual-writes) render IDENTICALLY.

describe("romanMarker", () => {
  it("matches parseChapters' marker normalization exactly", () => {
    expect(romanMarker([1])).toBe("I");
    expect(romanMarker([1, 2])).toBe("I,II");
    expect(romanMarker([4])).toBe("IV");
    // parseChapters("I, II — x") normalizes to "I,II" (uppercase, no spaces)
    expect(parseChapters("I, II — Do the thing.")[0].marker).toBe(
      romanMarker([1, 2]),
    );
    expect(parseChapters("iv — Late chapter.")[0].marker).toBe(romanMarker([4]));
  });
});

describe("loyalty round-trip", () => {
  const ROWS = [
    { cost: "+1", text: "Draw a card." },
    { cost: "-3", text: "Destroy target creature." },
    { cost: "0", text: "Discard your hand." },
    { cost: "X", text: "Deal X damage." },
    { cost: null, text: "Static ability line with no badge." },
  ];

  it("parse(serialize(rows)) === rows", () => {
    expect(loyaltyFromRulesText(serializeLoyalty(ROWS))).toEqual(ROWS);
  });

  it("structured and parsed resolution render identically", () => {
    const content: FaceContent = { v: 1, loyalty: { abilities: ROWS } };
    const text = serializeLoyalty(ROWS);
    expect(resolveLoyaltyRows(content, text)).toEqual(
      resolveLoyaltyRows(null, text),
    );
    // And both equal what the legacy parser produces directly.
    expect(resolveLoyaltyRows(content, text)).toEqual(
      parseLoyaltyAbilities(text),
    );
  });

  it("falls back to parsing when structured rows are absent or empty", () => {
    expect(resolveLoyaltyRows(null, "+2: Scry 2.")).toEqual([
      { cost: "+2", text: "Scry 2." },
    ]);
    expect(
      resolveLoyaltyRows({ v: 1 }, "-1: Return it to your hand."),
    ).toEqual([{ cost: "-1", text: "Return it to your hand." }]);
  });
});

describe("saga round-trip", () => {
  const CHAPTERS = [
    { numerals: [1, 2], text: "Create a 2/2 white Knight creature token." },
    { numerals: [3], text: "Knights you control get +2/+1." },
  ];
  const INTRO =
    "(As this Saga enters and after your draw step, add a lore counter.)";

  it("parse(serialize(intro, chapters)) === {intro, chapters}", () => {
    const text = serializeSaga(INTRO, CHAPTERS);
    expect(sagaFromRulesText(text)).toEqual({
      intro: INTRO,
      chapters: CHAPTERS,
    });
  });

  it("round-trips without an intro", () => {
    const text = serializeSaga(null, CHAPTERS);
    expect(sagaFromRulesText(text)).toEqual({ intro: null, chapters: CHAPTERS });
  });

  it("structured and parsed resolution render identically", () => {
    const content: FaceContent = {
      v: 1,
      saga: { intro: INTRO, chapters: CHAPTERS },
    };
    const text = serializeSaga(INTRO, CHAPTERS);
    expect(resolveSagaChapters(content, text)).toEqual(
      resolveSagaChapters(null, text),
    );
  });

  it("handles the six-chapter extreme (Long List of the Ents)", () => {
    const long = [{ numerals: [1, 2, 3, 4, 5, 6], text: "Remember them all." }];
    const text = serializeSaga(null, long);
    expect(sagaFromRulesText(text).chapters).toEqual(long);
    expect(resolveSagaChapters({ v: 1, saga: { chapters: long } }, null)
      .chapters[0].marker).toBe("I,II,III,IV,V,VI");
  });

  it("falls back to parsing when structured chapters are absent", () => {
    const parsed = resolveSagaChapters(null, "I — First.\nII — Second.");
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]).toEqual({ marker: "I", text: "First." });
  });
});
