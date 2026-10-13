import { describe, expect, it } from "vitest";
import { submittedRulesOf, type StructuredRulesValues } from "@/lib/creator/structured-rules";
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
