import { describe, expect, it } from "vitest";
import { cardStationLayout } from "@/lib/cards/station-layout";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { keptStationRows, submittedRulesOf, type StructuredRulesValues } from "@/lib/creator/structured-rules";
import type { FaceContent } from "@/types/card";

// TODO 4.27a, PR 1: a station card's rows (`face_content.station`) have no
// editor yet. An edit that leaves the rules text alone must not clear them —
// they may say what the text cannot (the plate on another tier).

const TEXT = "Station (… It's an artifact creature at 8+.)\n2+ | Haste\n8+ | Flying";
const ROWS: FaceContent = {
  v: 1,
  station: { intro: "Station (… It's an artifact creature at 8+.)", tiers: [{ threshold: 2, text: "Haste", pt: true }, { threshold: 8, text: "Flying" }] },
} as FaceContent;
const values = (rules_text: string): StructuredRulesValues => ({ rules_text, loyalty_abilities: [], saga_intro: "", saga_chapters: [] }) as StructuredRulesValues;

describe("a station card's stored rows through the editor", () => {
  it("an edit that leaves the text as it opened keeps the rows: face_content is not sent", () => {
    const out = submittedRulesOf("artifact", values(TEXT), { opened: values(TEXT), storedFaceContent: ROWS });
    expect(out).toEqual({ rulesText: TEXT, faceContent: ROWS, keepsStored: true });
    // …the same on a Planet (the land kind).
    expect(submittedRulesOf("land", values(` ${TEXT}\n`), { opened: values(TEXT), storedFaceContent: ROWS }).keepsStored).toBe(true);
  });

  it("an edited text is the tiers from then on: the rows go", () => {
    const out = submittedRulesOf("artifact", values(`${TEXT}, trample`), { opened: values(TEXT), storedFaceContent: ROWS });
    expect(out).toEqual({ rulesText: `${TEXT}, trample`, faceContent: null });
  });

  it("a new card or a remix (nothing opened), and every card without station rows, as before", () => {
    expect(submittedRulesOf("artifact", values(TEXT), { storedFaceContent: ROWS })).toEqual({ rulesText: TEXT, faceContent: null });
    expect(submittedRulesOf("artifact", values(TEXT), { opened: values(TEXT), storedFaceContent: null })).toEqual({ rulesText: TEXT, faceContent: null });
    expect(submittedRulesOf("creature", values("Flying"), { opened: values("Flying"), storedFaceContent: { v: 1 } as FaceContent })).toEqual({ rulesText: "Flying", faceContent: null });
  });
});

// The independent check of #543, in the real editor: a card stored with rows
// that plate the FIRST tier previewed with the plate on the tier its text
// plates (and the text's line breaks), while the bake, the card page and the
// download drew the rows. The preview draws what a save keeps.
describe("what the creator's preview draws of a station card stored with rows (keptStationRows)", () => {
  it("the stored rows while the text is as it opened — the card the bake draws", () => {
    expect(keptStationRows("artifact", values(TEXT), { opened: values(TEXT), storedFaceContent: ROWS })).toBe(ROWS);
    expect(keptStationRows("land", values(`${TEXT} `), { opened: values(TEXT), storedFaceContent: ROWS })).toBe(ROWS);
    // …and they do plate another tier than the text would: the difference was real.
    const profile = getFrameProfile("m15station");
    const card = { cardType: "artifact" as const, subtypes: ["Spacecraft"], supertype: null, power: "3", toughness: "3", rulesText: TEXT };
    const fromText = cardStationLayout(profile, { ...card, faceContent: null })!;
    const fromRows = cardStationLayout(profile, { ...card, faceContent: keptStationRows("artifact", values(TEXT), { opened: values(TEXT), storedFaceContent: ROWS }) })!;
    expect(fromText.plate!.y0).toBeGreaterThan(fromRows.plate!.y0);
    expect(fromRows.plate!.y0 + 56).toBe(fromRows.bands.tiers[0]!.cy);
  });

  it("the text's own tiers once the text is edited (what that save stores), and on a new card or a remix", () => {
    expect(keptStationRows("artifact", values(`${TEXT}, trample`), { opened: values(TEXT), storedFaceContent: ROWS })).toBeNull();
    expect(keptStationRows("artifact", values(TEXT), { storedFaceContent: ROWS })).toBeNull();
    expect(keptStationRows("artifact", values(TEXT), { opened: values(TEXT), storedFaceContent: null })).toBeNull();
  });

  it("never a walker's or a saga's rows — their editors own them", () => {
    const walker = { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Draw a card." }] }, station: ROWS.station } as FaceContent;
    expect(keptStationRows("planeswalker", values("+1: Draw a card."), { opened: values("+1: Draw a card."), storedFaceContent: walker })).toBeNull();
    expect(keptStationRows("saga", values("I — Draw a card."), { opened: values("I — Draw a card."), storedFaceContent: walker })).toBeNull();
  });
});
