import { describe, expect, it } from "vitest";
import {
  keepsStoredMarker,
  markerNumerals,
  markerText,
  resolveSagaChapters,
  sagaEditorRows,
  sagaFromRulesText,
  serializeSaga,
  serializeSagaMarkers,
  storedMarkerOf,
  unreadableMarkerParts,
} from "@/lib/cards/face-content";
import { parseChapters } from "@/lib/cards/card-display";
import {
  sagaRowsLosingMarker,
  sagaRowsNeedingNumber,
  sagaRowsOut,
  structuredRowsSaveAsText,
  structuredRowsUntouched,
  submittedRulesOf,
  type StructuredRulesValues,
} from "@/lib/creator/structured-rules";
import { faceContentSchema } from "@/lib/validation/card";
import type { FaceContent } from "@/types/card";

// ---------------------------------------------------------------------------
// A saga row keeps its chapter marker AS STORED while its numbers are that
// marker's (the TODO 3b.25 follow-up, 2026-10-13). The editor holds a
// chapter as numbers and writes them ascending; a stored marker can say
// more — "II, I —" (an order), "I, XI —" (a numeral with no toggle) — and
// an edited save used to rewrite every row from its numbers.
// ---------------------------------------------------------------------------

const values = (over: Partial<StructuredRulesValues> = {}): StructuredRulesValues => ({
  rules_text: "",
  loyalty_abilities: [],
  saga_intro: "",
  saga_chapters: [],
  ...over,
});
/** The form as it opens on a stored saga. */
const opened = (rules_text: string, face: FaceContent | null = null) => {
  const saga = sagaEditorRows(face, rules_text);
  return values({ rules_text, saga_intro: saga.intro ?? "", saga_chapters: saga.chapters });
};
const withRow = (from: StructuredRulesValues, index: number, patch: Partial<StructuredRulesValues["saga_chapters"][number]>) =>
  ({ ...from, saga_chapters: from.saga_chapters.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
/** What the renderers draw the rail from. */
const drawn = (out: { rulesText: string; faceContent: FaceContent | null }) =>
  resolveSagaChapters(out.faceContent, out.rulesText).chapters;

describe("a marker as stored", () => {
  it("is carried only where the numbers alone would not give it back", () => {
    for (const marker of ["I", "I,II", "III,IV,V", "VII", "I,X"]) expect(storedMarkerOf(marker)).toBeUndefined();
    expect(storedMarkerOf("II,I")).toBe("II,I");
    expect(storedMarkerOf("i, xi")).toBe("I,XI");
    expect(storedMarkerOf("XI")).toBe("XI");
    expect(storedMarkerOf("IIII")).toBe("IIII");
  });

  it("its numerals the editor shows, and the ones it can't", () => {
    expect(markerNumerals("II,I")).toEqual([2, 1]);
    expect(markerNumerals("I,XI")).toEqual([1]);
    expect(unreadableMarkerParts("I,XI")).toEqual(["XI"]);
    expect(unreadableMarkerParts("II,I")).toEqual([]);
    expect(markerText("I,XI")).toBe("I, XI");
  });

  it("is kept while the row's numbers are the marker's own, in any order", () => {
    expect(keepsStoredMarker({ numerals: [2, 1], marker: "II,I" })).toBe(true);
    expect(keepsStoredMarker({ numerals: [1, 2], marker: "II,I" })).toBe(true);
    expect(keepsStoredMarker({ numerals: [1, 2, 3], marker: "II,I" })).toBe(false);
    expect(keepsStoredMarker({ numerals: [1], marker: "I,XI" })).toBe(true);
    expect(keepsStoredMarker({ numerals: [], marker: "XI" })).toBe(true);
    expect(keepsStoredMarker({ numerals: [1], marker: "XI" })).toBe(false);
    expect(keepsStoredMarker({ numerals: [1] })).toBe(false);
  });

  it("serializeSagaMarkers is serializeSaga for numbered rows, and parseChapters reads its markers back", () => {
    const chapters = [
      { numerals: [1, 2], text: "Draw a card." },
      { numerals: [3], text: "Win." },
    ];
    expect(
      serializeSagaMarkers("(Reminder.)", [
        { marker: "I,II", text: "Draw a card." },
        { marker: "III", text: "Win." },
      ]),
    ).toBe(serializeSaga("(Reminder.)", chapters));
    const rows = [
      { marker: "II,I", text: "Both." },
      { marker: "I,XI", text: "Eleven." },
      { marker: "XI", text: "Alone." },
    ];
    expect(parseChapters(serializeSagaMarkers(null, rows))).toEqual(rows);
  });
});

describe("the rows the editor opens with", () => {
  it("an ordinary saga carries no marker — the rows are what they always were", () => {
    const text = "(Reminder.)\nI, II — Draw a card.\nIII — Win.";
    expect(sagaEditorRows(null, text)).toEqual({ intro: "(Reminder.)", chapters: sagaFromRulesText(text).chapters });
    for (const row of sagaEditorRows(null, text).chapters) expect(row).not.toHaveProperty("marker");
  });

  it("a marker out of order or with a numeral past X rides on its row", () => {
    expect(sagaEditorRows(null, "II, I — Both.\nI, XI — Eleven.\nXI — Alone.\nIII — c").chapters).toEqual([
      { numerals: [2, 1], text: "Both.", marker: "II,I" },
      { numerals: [1], text: "Eleven.", marker: "I,XI" },
      { numerals: [], text: "Alone.", marker: "XI" },
      { numerals: [3], text: "c" },
    ]);
  });

  it("structured rows first — their order is their marker", () => {
    const face: FaceContent = { v: 1, saga: { intro: null, chapters: [{ numerals: [2, 1], text: "Both." }] } };
    expect(sagaEditorRows(face, "I, II — Both.").chapters).toEqual([{ numerals: [2, 1], text: "Both.", marker: "II,I" }]);
  });
});

describe("an EDITED save", () => {
  const ORDER = "II, I — Both.\nIII — Three.";
  const ELEVEN = "I, XI — Both.\nII — Two.";

  it("another row edited: “II, I” is not re-ordered — stored as rows in that order", () => {
    const from = opened(ORDER);
    const out = submittedRulesOf("saga", withRow(from, 1, { text: "Three, changed." }), { opened: from });
    expect(out.rulesText).toBe("II, I — Both.\nIII — Three, changed.");
    expect(out.faceContent?.saga?.chapters[0]).toEqual({ numerals: [2, 1], text: "Both." });
    expect(faceContentSchema.safeParse(out.faceContent).success).toBe(true);
    expect(drawn(out).map((ch) => ch.marker)).toEqual(["II,I", "III"]);
    // …and the same card whichever of the two the renderers read.
    expect(drawn(out)).toEqual(drawn({ rulesText: out.rulesText, faceContent: null }));
  });

  it("another row edited: “I, XI” keeps its XI — plain text, which is what draws", () => {
    const from = opened(ELEVEN);
    const out = submittedRulesOf("saga", withRow(from, 1, { text: "Two, changed." }), { opened: from });
    expect(out).toEqual({ rulesText: "I, XI — Both.\nII — Two, changed.", faceContent: null });
    expect(drawn(out).map((ch) => ch.marker)).toEqual(["I,XI", "II"]);
  });

  it("the marker row's own text edited: the marker is kept", () => {
    const from = opened(ELEVEN);
    const out = submittedRulesOf("saga", withRow(from, 0, { text: "Both, changed." }), { opened: from });
    expect(out.rulesText).toBe("I, XI — Both, changed.\nII — Two.");
  });

  it("“XI —” alone beside an edited row: saved under its marker, asked nothing", () => {
    const from = opened("I — One.\nXI — Eleven.");
    const now = withRow(from, 0, { text: "One, changed." });
    expect(sagaRowsNeedingNumber("saga", now, from)).toEqual([]);
    expect(submittedRulesOf("saga", now, { opened: from })).toEqual({
      rulesText: "I — One, changed.\nXI — Eleven.",
      faceContent: null,
    });
  });

  it("its numbers changed on “II, I”: the numbers picked, ascending", () => {
    const from = opened(ORDER);
    const now = withRow(from, 0, { numerals: [1, 2, 4] });
    expect(sagaRowsLosingMarker("saga", now)).toEqual([]);
    expect(submittedRulesOf("saga", now, { opened: from }).rulesText).toBe("I, II, IV — Both.\nIII — Three.");
  });

  it("its numbers changed on “I, XI”: the row is named — never saved short of the XI without a word", () => {
    const from = opened(ELEVEN);
    expect(sagaRowsLosingMarker("saga", from)).toEqual([]);
    const now = withRow(from, 0, { numerals: [1, 3] });
    expect(sagaRowsLosingMarker("saga", now)).toEqual([0]);
    // Put back: kept again.
    expect(sagaRowsLosingMarker("saga", withRow(now, 0, { numerals: [1] }))).toEqual([]);
    // Dropped by name (the row's marker cleared): the numbers are the row's.
    const dropped = withRow(now, 0, { marker: undefined });
    expect(sagaRowsLosingMarker("saga", dropped)).toEqual([]);
    expect(submittedRulesOf("saga", dropped, { opened: from }).rulesText).toBe("I, III — Both.\nII — Two.");
    // An emptied row is not saved at all; another kind has no rows.
    expect(sagaRowsLosingMarker("saga", withRow(now, 0, { text: " " }))).toEqual([]);
    expect(sagaRowsLosingMarker("creature", now)).toEqual([]);
  });

  it("a number picked on “XI —” (no numeral the editor shows): the row's — the answer the form asks for", () => {
    const from = opened("I — One.\nXI — Eleven.");
    const now = withRow(from, 1, { numerals: [2] });
    expect(sagaRowsLosingMarker("saga", now)).toEqual([]);
    expect(submittedRulesOf("saga", now, { opened: from }).rulesText).toBe("I — One.\nII — Eleven.");
  });

  it("a marker dropped by name is an edit even with the numbers it opened with", () => {
    const from = opened(ELEVEN);
    const dropped = withRow(from, 0, { marker: undefined });
    expect(structuredRowsUntouched("saga", dropped, from)).toBe(false);
    expect(submittedRulesOf("saga", dropped, { opened: from }).rulesText).toBe("I — Both.\nII — Two.");
  });

  it("untouched is what it was: the stored text, nothing written beside it", () => {
    for (const text of [ORDER, ELEVEN, "I — One.\nXI — Eleven."]) {
      const from = opened(text);
      expect(submittedRulesOf("saga", from, { opened: from })).toEqual({
        rulesText: text,
        faceContent: null,
        keepsStored: true,
      });
    }
  });

  it("a kept marker the rows cannot hold says the card saves as text; an order alone does not", () => {
    expect(structuredRowsSaveAsText("saga", opened(ELEVEN))).toBe(true);
    expect(structuredRowsSaveAsText("saga", opened(ORDER))).toBe(false);
    expect(sagaRowsOut(opened(ELEVEN).saga_chapters)).toEqual([
      { marker: "I,XI", numerals: [1], text: "Both.", kept: true },
      { marker: "II", numerals: [2], text: "Two.", kept: false },
    ]);
  });
});
