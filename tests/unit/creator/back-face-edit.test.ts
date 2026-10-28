import { describe, expect, it } from "vitest";
import { editBackFacePayload } from "@/lib/creator/back-face-edit";
import { EMPTY_BACK_FACE, type FormValues } from "@/lib/creator/form-types";

// TODO 3b.29 and #629's check — what an edit sends for a legacy / inline back.

const STORED = { title: "Back", card_type: "creature", rules_text: "Flying", color_identity: ["blue"] };
const opened: Pick<FormValues, "has_back_face" | "back_face"> = {
  has_back_face: true,
  back_face: { ...EMPTY_BACK_FACE, title: "Back", card_type: "creature", rules_text: "Flying", color_identity: ["blue"] },
};
const built = (over: Record<string, unknown> = {}) => ({
  title: "Back",
  card_type: "creature",
  rules_text: "Flying",
  subtypes: [],
  art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
  ...over,
});
const send = (
  values: Pick<FormValues, "has_back_face" | "back_face">,
  b: Record<string, unknown> | null,
  extra: { trustOpened?: boolean; ownsColour?: boolean } = {},
) => editBackFacePayload({ stored: STORED, opened, values, built: b, trustOpened: extra.trustOpened ?? true, ownsColour: extra.ownsColour });

describe("editBackFacePayload", () => {
  it("untouched and not rebuilt as stored: left out", () => {
    expect(send(opened, built())).toBeUndefined();
  });

  it("switched off: null, which clears it", () => {
    expect(send({ ...opened, has_back_face: false }, null)).toBeNull();
  });

  it("edited: the form's fields over what it never holds — the colour kept, no art position invented", () => {
    const values = { ...opened, back_face: { ...opened.back_face, rules_text: "Flying, haste" } };
    expect(send(values, built({ rules_text: "Flying, haste" }))).toEqual({
      title: "Back",
      card_type: "creature",
      rules_text: "Flying, haste",
      subtypes: [],
      color_identity: ["blue"],
    });
  });

  it("edited, a field emptied: it leaves the object", () => {
    const values = { ...opened, back_face: { ...opened.back_face, rules_text: "" } };
    const out = send(values, built({ rules_text: undefined })) as Record<string, unknown>;
    expect(out.rules_text).toBeUndefined();
    expect(out.color_identity).toEqual(["blue"]);
  });

  it("a frame that draws the part colour owns it: an emptied colour is not brought back", () => {
    const values = { ...opened, back_face: { ...opened.back_face, color_identity: [], rules_text: "X" } };
    const out = send(values, built({ rules_text: "X" }), { ownsColour: true }) as Record<string, unknown>;
    expect(out.color_identity).toBeUndefined();
  });

  it("a moved picture keeps its position", () => {
    const moved = { focalX: 0.2, focalY: 0.5, scale: 1 };
    const values = { ...opened, back_face: { ...opened.back_face, art_position: moved } };
    expect((send(values, built({ art_position: moved })) as Record<string, unknown>).art_position).toEqual(moved);
  });

  it("after a save of this session sent a back (no refresh yet): the built back, as main", () => {
    expect(send(opened, built(), { trustOpened: false })).toEqual(built());
  });
});
