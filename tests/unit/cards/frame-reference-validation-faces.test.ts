import { describe, expect, it, vi } from "vitest";
import { validateReferenceForCombo } from "@/lib/cards/frame-reference-validation";
import { agadeem, archangelAvacyn, beanstalkGiant, serraAngel, tergrid, valki } from "../scryfall/fixtures/dfc-printings";

// ---------------------------------------------------------------------------
// Pinning a reference on a BACK body (TODO 5.0b), under 5.0a's declared-
// profile fixture (m15artifact = a transform back; m15devoid = a modal back;
// never the real PROFILES): the row is compared with the printing's BACK
// face, so the pin is checked on that face — a second face with its own
// scan, in the row's colour. No kind check (a back body dresses no kind of
// its own: the back's type against bodyFor is 5.2's save rule) and no
// signature warning (the registry names the FRONT body a printing lands
// on). The front-template rules are frame-reference-validation.test.ts.
// ---------------------------------------------------------------------------

vi.mock("@/lib/cards/template-layout", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cards/template-layout")>();
  const { dfcGetFrameProfile } = await import("./dfc-fixture");
  return { ...real, getFrameProfile: dfcGetFrameProfile(real.getFrameProfile) };
});

describe("a back body's pin", () => {
  it("accepts a printing whose back face is the row's colour, with no kind or signature noise", () => {
    // Avacyn, the Purifier is RED (colour indicator) under a white front.
    expect(validateReferenceForCombo(archangelAvacyn, "m15artifact", "r")).toEqual({ errors: [], warnings: [] });
    // A colourless artifact back on the c row; a two-colour walker back on m.
    expect(validateReferenceForCombo(tergrid, "m15devoid", "c")).toEqual({ errors: [], warnings: [] });
    expect(validateReferenceForCombo(valki, "m15devoid", "m")).toEqual({ errors: [], warnings: [] });
    // A land back is the colour of its mana ability.
    expect(validateReferenceForCombo(agadeem, "m15devoid", "b")).toEqual({ errors: [], warnings: [] });
  });

  it("refuses the FRONT's colour: the row verifies the back", () => {
    const result = validateReferenceForCombo(archangelAvacyn, "m15artifact", "w");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Archangel Avacyn \/\/ Avacyn, the Purifier's back face is red; this row verifies the white/);
  });

  it("refuses a printing with no second face, and one whose second face has no scan of its own", () => {
    const single = validateReferenceForCombo(serraAngel, "m15artifact", "w");
    expect(single.errors).toHaveLength(1);
    expect(single.errors[0]).toMatch(/Serra Angel has no second face with its own scan/);
    const adventure = validateReferenceForCombo(beanstalkGiant, "m15artifact", "g");
    expect(adventure.errors).toHaveLength(1);
    expect(adventure.errors[0]).toMatch(/has no second face with its own scan/);
  });

  it("refuses a double-faced token or a Role card: the import drops their second face", () => {
    const incubator = {
      ...archangelAvacyn,
      id: "f9f9f9f9-0009-4009-8009-000000000009",
      name: "Incubator // Phyrexian",
      layout: "double_faced_token",
      card_faces: [
        { ...archangelAvacyn.card_faces![0], name: "Incubator", type_line: "Token Artifact — Incubator", colors: [] },
        { ...archangelAvacyn.card_faces![1], name: "Phyrexian", type_line: "Token Artifact Creature — Phyrexian", colors: [], color_indicator: undefined },
      ],
    } as typeof archangelAvacyn;
    const result = validateReferenceForCombo(incubator, "m15artifact", "c");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^Incubator \/\/ Phyrexian is a double-faced token, whose second face PipGlyph doesn't import/);
  });

  it("an era mismatch stays a warning on a back body", () => {
    const retro = { ...archangelAvacyn, frame: "2003" };
    const result = validateReferenceForCombo(retro as typeof archangelAvacyn, "m15artifact", "r");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(["This printing uses the 2003 frame; the m15artifact template emulates the 2015 era."]);
  });

  it("a front body keeps the front-face rules (its colour is the front's)", () => {
    expect(validateReferenceForCombo(archangelAvacyn, "m15", "w").errors).toEqual([]);
    expect(validateReferenceForCombo(archangelAvacyn, "m15", "r").errors).toHaveLength(1);
  });
});
