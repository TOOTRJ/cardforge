import { describe, expect, it } from "vitest";
import { dfcBodyOf } from "@/lib/cards/dfc";
import {
  frontDrawsPowerToughness,
  profileDrawsPowerToughness,
  profileSecondFaceDrawsPowerToughness,
  PT_NOT_DRAWN_NOTE,
  secondFaceDrawsPowerToughness,
} from "@/lib/cards/pt-drawn";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// "Does this face's frame draw a power / toughness?" — answered from the
// profiles' own P/T slots (the data both renderers gate the plate on), for
// every template and every way a second face reaches the picture. The sets
// below are PINNED: a new template is classified by its profile with no code
// change, and this test then names it — add it to the list it belongs on
// (and, when a frame gains its slot — the saga's is TODO 4.5c — take it off).
// ---------------------------------------------------------------------------

/** Templates whose own face (a front, or a back on that body) draws NO P/T. */
const NO_PT_SLOT: FrameTemplate[] = [
  "m15pw",
  "emblem",
  "m15borderlesspw",
  "m15borderlesspwtall",
  "m15dfclandback",
  "m15mdfclandfront",
  "m15mdfclandback",
  "battle",
  "saga",
  "split",
  "aftermath",
];

/** Templates that paint a second face on their own master → whether that
 *  half draws a P/T. */
const INLINE_SECOND_FACE: Partial<Record<FrameTemplate, boolean>> = {
  adventure: false,
  flip: true,
  split: false,
  aftermath: false,
};

describe("the front face, every template", () => {
  it("the templates with no P/T slot are exactly the pinned list", () => {
    expect(FRAME_TEMPLATE_VALUES.filter((t) => !frontDrawsPowerToughness(t))).toEqual(NO_PT_SLOT);
  });

  it("the answer IS the profile's slot — what both renderers gate on", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      const profile = getFrameProfile(t);
      expect(frontDrawsPowerToughness(t), t).toBe(Boolean(profile.pt));
      expect(profileDrawsPowerToughness(profile), t).toBe(Boolean(profile.pt));
    }
  });

  it("an unknown or missing template reads as the default frame, which draws one", () => {
    expect(frontDrawsPowerToughness(undefined)).toBe(true);
    expect(frontDrawsPowerToughness(null)).toBe(true);
    expect(frontDrawsPowerToughness("regular")).toBe(true);
  });
});

describe("the second / back face, every template", () => {
  it("the templates that paint a second face on their master are exactly the pinned ones", () => {
    const inline = Object.fromEntries(
      FRAME_TEMPLATE_VALUES.map((t) => [t, profileSecondFaceDrawsPowerToughness(getFrameProfile(t))] as const).filter(
        ([, drawn]) => drawn !== null,
      ),
    );
    expect(inline).toEqual(INLINE_SECOND_FACE);
    for (const [t, drawn] of Object.entries(inline)) expect(secondFaceDrawsPowerToughness(t), t).toBe(drawn);
  });

  it("a legacy back (no body) draws on the front's frame: the front's answer", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      if (t in INLINE_SECOND_FACE) continue;
      expect(secondFaceDrawsPowerToughness(t), t).toBe(frontDrawsPowerToughness(t));
      expect(secondFaceDrawsPowerToughness(t, null), t).toBe(frontDrawsPowerToughness(t));
    }
  });

  it("a back on its own body: the BODY's slot, under every front body", () => {
    const fronts = FRAME_TEMPLATE_VALUES.filter((t) => dfcBodyOf(t)?.role === "front");
    const backs = FRAME_TEMPLATE_VALUES.filter((t) => dfcBodyOf(t)?.role === "back");
    expect(fronts.length).toBeGreaterThan(0);
    expect(backs.length).toBeGreaterThan(0);
    for (const front of fronts) {
      for (const back of backs) {
        expect(secondFaceDrawsPowerToughness(front, back), `${front} → ${back}`).toBe(Boolean(getFrameProfile(back).pt));
      }
    }
    // The back bodies with no slot today: the two land backs.
    expect(backs.filter((b) => !secondFaceDrawsPowerToughness(fronts[0], b))).toEqual(["m15dfclandback", "m15mdfclandback"]);
  });

  it("a body is honoured only as backBodyOf honours it (a back body under a front body)", () => {
    // A stray body on a plain card: a legacy back, the front's frame.
    expect(secondFaceDrawsPowerToughness("m15", "m15mdfclandback")).toBe(true);
    expect(secondFaceDrawsPowerToughness("saga", "m15dfcback")).toBe(false);
    // A template that is no back body under a front body: the front's frame.
    expect(secondFaceDrawsPowerToughness("m15mdfclandfront", "m15")).toBe(false);
    expect(secondFaceDrawsPowerToughness("m15dfcfront", "saga")).toBe(true);
  });
});

describe("the note", () => {
  it("plain words, no promise of a date", () => {
    expect(PT_NOT_DRAWN_NOTE).toBe(
      "This frame doesn't draw power / toughness. The numbers are saved with the card, but the picture won't show them.",
    );
    expect(PT_NOT_DRAWN_NOTE).not.toMatch(/yet|soon/i);
  });
});
