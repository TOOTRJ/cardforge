import { describe, expect, it } from "vitest";
import { parseStationText } from "@/lib/cards/station";
import {
  STATION_PT_NONE,
  canAddStationTier,
  composeStationText,
  extraTierLines,
  nextThreshold,
  ptChoiceAfterRemove,
  stationOpenText,
  stationPlatedTier,
  stationPtChoiceOf,
  stationRowsOfText,
  stationTiersProblem,
  thresholdOf,
} from "@/lib/creator/station-rows";
import { keptStationRows, submittedRulesOf, type StructuredRulesValues } from "@/lib/creator/structured-rules";
import { faceContentSchema } from "@/lib/validation/card";
import type { FaceContent } from "@/types/card";

// The station frame's tier editor, its data (TODO 4.27a, PR 2): the rows are
// a VIEW of the rules text, the P/T tier the one thing beside it, and a save
// never rewrites what was not touched. The same rules through the real form:
// tests/unit/components/creator-station-tiers-save.test.tsx.

const REMINDER = "Station (… It's an artifact creature at 9+.)";
const TEXT = `Flying\n${REMINDER}\n3+ | Draw a card.\n6+ | Vigilance\n9+ | Flying, lifelink`;
const ROWS: FaceContent = {
  v: 1,
  station: { intro: `Flying\n${REMINDER}`, tiers: [{ threshold: 3, text: "Draw a card." }, { threshold: 6, text: "Vigilance", pt: true }, { threshold: 9, text: "Flying, lifelink" }] },
};
const values = (rules_text: string, station_pt_tier: number | null = null): StructuredRulesValues => ({
  rules_text,
  loyalty_abilities: [],
  saga_intro: "",
  saga_chapters: [],
  station_pt_tier,
});

describe("the rows are a view of the text", () => {
  it("reads the top band and the tiers, and composes the same text back", () => {
    const rows = stationRowsOfText(TEXT);
    expect(rows.intro).toBe(`Flying\n${REMINDER}`);
    expect(rows.tiers.map((t) => [t.n, t.input, t.text])).toEqual([
      [3, "3", "Draw a card."],
      [6, "6", "Vigilance"],
      [9, "9", "Flying, lifelink"],
    ]);
    expect(composeStationText(rows)).toBe(TEXT);
    expect(composeStationText({ intro: "", tiers: rows.tiers.slice(0, 1) })).toBe("3+ | Draw a card.");
    expect(composeStationText({ intro: "", tiers: [] })).toBe("");
  });

  it("keeps a box's keystrokes as typed: a trailing space or line survives, and still reads as the same rows", () => {
    const typed = { intro: "Flying \n", tiers: [{ n: 3, input: "3", text: "Draw a card.\n" }, { n: 6, input: "", text: "" }] };
    const text = composeStationText(typed);
    expect(text).toBe("Flying \n\n3+ | Draw a card.\n\n6+ | ");
    expect(parseStationText(text).tiers.map((t) => [t.threshold, t.text])).toEqual([
      [3, "Draw a card."],
      [6, ""],
    ]);
  });

  it("a number box holds 1–99; a new tier opens past the last; a fourth is not offered", () => {
    expect(["1", "20", "99", " 7 "].map(thresholdOf)).toEqual([1, 20, 99, 7]);
    expect(["", "0", "100", "x", "1.5"].map(thresholdOf)).toEqual([null, null, null, null, null]);
    expect(nextThreshold([])).toBe(2);
    expect(nextThreshold([{ n: 9 }])).toBe(13);
    expect(nextThreshold([{ n: 98 }])).toBe(99);
    expect([0, 1, 2, 3].map((n) => canAddStationTier(Array.from({ length: n })))).toEqual([true, true, true, false]);
  });

  it("a fourth tier line stays in the third tier's text, and is named", () => {
    expect(extraTierLines(TEXT)).toEqual([]);
    expect(extraTierLines(`${TEXT}\n12+ | Trample\n15+|Haste`)).toEqual(["12+ | Trample", "15+|Haste"]);
    expect(parseStationText(`${TEXT}\n12+ | Trample`).tiers[2]!.text).toBe("Flying, lifelink\n12+ | Trample");
  });

  it("says what stops the tiers from saving as rows", () => {
    expect(stationTiersProblem(TEXT)).toBeNull();
    expect(stationTiersProblem("Flying")).toBeNull();
    expect(stationTiersProblem("3+ | A\n6+ | ")).toMatch(/Tier 2 \(6\+\) has no text yet/);
    expect(stationTiersProblem("6+ | A\n6+ | B")).toMatch(/tier 2 is 6\+ under 6\+/);
  });
});

describe("the tier that carries the P/T", () => {
  it("is the maker's while it names a tier, else the text's: its reminder's, else the last", () => {
    expect(stationPlatedTier(TEXT, null)).toBe(2);
    expect(stationPlatedTier(TEXT.replace("at 9+", "at 3+"), null)).toBe(0);
    expect(stationPlatedTier("3+ | A\n6+ | B", null)).toBe(1);
    expect(stationPlatedTier(TEXT, 0)).toBe(0);
    expect(stationPlatedTier(TEXT, 7)).toBe(2);
    expect(stationPlatedTier(TEXT, STATION_PT_NONE)).toBe(-1);
    expect(stationPlatedTier("Flying", 0)).toBe(-1);
  });

  it("follows its tier when another is removed", () => {
    expect([0, 1, 2].map((removed) => ptChoiceAfterRemove(1, removed))).toEqual([0, null, 1]);
    expect(ptChoiceAfterRemove(null, 0)).toBeNull();
    expect(ptChoiceAfterRemove(STATION_PT_NONE, 0)).toBe(STATION_PT_NONE);
  });

  it("opens from a stored card: null where the text says it, the rows' tier where they say more, none where they plate none", () => {
    expect(stationPtChoiceOf(TEXT, null)).toBeNull();
    expect(stationPtChoiceOf(TEXT, ROWS)).toBe(1);
    const asText: FaceContent = { v: 1, station: { ...ROWS.station!, tiers: ROWS.station!.tiers.map((t, i) => ({ threshold: t.threshold, text: t.text, ...(i === 2 ? { pt: true as const } : {}) })) } };
    expect(stationPtChoiceOf(TEXT, asText)).toBeNull();
    const none: FaceContent = { v: 1, station: { ...ROWS.station!, tiers: ROWS.station!.tiers.map((t) => ({ threshold: t.threshold, text: t.text })) } };
    expect(stationPtChoiceOf(TEXT, none)).toBe(STATION_PT_NONE);
  });

  it("the form opens with the stored text — or with the ROWS' text where the two disagree", () => {
    expect(stationOpenText(TEXT, null)).toBe(TEXT);
    expect(stationOpenText(TEXT, ROWS)).toBe(TEXT);
    // Spelled another way, the same rows: the stored text, untouched.
    const spaced = TEXT.replace("3+ | ", "3+|");
    expect(stationOpenText(spaced, ROWS)).toBe(spaced);
    expect(stationOpenText("Flying\n3+ | Older.", ROWS)).toBe(TEXT);
    expect(stationOpenText(null, null)).toBe("");
  });
});

describe("what a save writes on a station frame (submittedRulesOf)", () => {
  const on = { stationFrame: true } as const;

  it("untouched: the stored text byte for byte, the rows not sent — with rows or without", () => {
    const opened = values(TEXT, 1);
    expect(submittedRulesOf("artifact", values(TEXT, 1), { ...on, opened, storedFaceContent: ROWS, storedRulesText: TEXT })).toEqual({ rulesText: TEXT, faceContent: ROWS, keepsStored: true });
    const plain = "Flying\n3+|Draw a card.";
    expect(submittedRulesOf("artifact", values(plain), { ...on, opened: values(plain), storedFaceContent: null, storedRulesText: plain })).toEqual({ rulesText: plain, faceContent: null, keepsStored: true });
    // The form opened with the rows' text: the STORED one is what stays.
    const other = "Flying\n3+ | Older.";
    expect(submittedRulesOf("artifact", values(TEXT, 1), { ...on, opened, storedFaceContent: ROWS, storedRulesText: other }).rulesText).toBe(other);
  });

  it("THE PATH PR 1 LEFT OPEN: an edited text carries the rows, the plate on the maker's tier", () => {
    const edited = TEXT.replace("Flying\n", "Flying, vigilance\n");
    const out = submittedRulesOf("artifact", values(edited, 1), { ...on, opened: values(TEXT, 1), storedFaceContent: ROWS, storedRulesText: TEXT });
    expect(out.keepsStored).toBeUndefined();
    expect(out.rulesText).toBe(edited);
    expect(out.faceContent!.station!.tiers).toEqual(ROWS.station!.tiers);
    expect(faceContentSchema.safeParse(out.faceContent).success).toBe(true);
    // …and the preview draws exactly those rows.
    expect(keptStationRows("artifact", values(edited, 1), { ...on, opened: values(TEXT, 1), storedFaceContent: ROWS, storedRulesText: TEXT })).toEqual(out.faceContent);
  });

  it("a moved plate alone is an edit; a new card writes rows with the text's own tier plated", () => {
    const moved = submittedRulesOf("artifact", values(TEXT, 0), { ...on, opened: values(TEXT, 1), storedFaceContent: ROWS, storedRulesText: TEXT });
    expect(moved.faceContent!.station!.tiers.map((t) => t.pt === true)).toEqual([true, false, false]);
    expect(moved.rulesText).toBe(TEXT);
    const fresh = submittedRulesOf("artifact", values(TEXT), on);
    expect(fresh.faceContent!.station!.tiers.map((t) => t.pt === true)).toEqual([false, false, true]);
    expect(fresh.rulesText).toBe(TEXT);
  });

  it("no tier: the text alone (null clears stored rows); rows the server cannot store: the text alone, which draws the same tiers", () => {
    expect(submittedRulesOf("artifact", values("Flying"), { ...on, opened: values(TEXT, 1), storedFaceContent: ROWS, storedRulesText: TEXT })).toEqual({ rulesText: "Flying", faceContent: null });
    const empty = submittedRulesOf("artifact", values("Flying\n3+ | "), on);
    expect(empty).toEqual({ rulesText: "Flying\n3+ |", faceContent: null });
    expect(parseStationText(empty.rulesText).tiers).toHaveLength(1);
  });

  it("OFF a station frame nothing changes: an untouched text keeps stored rows, an edited one is the card's own", () => {
    expect(submittedRulesOf("artifact", values(TEXT), { opened: values(TEXT), storedFaceContent: ROWS })).toEqual({ rulesText: TEXT, faceContent: ROWS, keepsStored: true });
    expect(submittedRulesOf("artifact", values(`${TEXT} x`), { opened: values(TEXT), storedFaceContent: ROWS })).toEqual({ rulesText: `${TEXT} x`, faceContent: null });
  });
});
