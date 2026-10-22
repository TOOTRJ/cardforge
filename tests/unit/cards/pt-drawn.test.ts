import { describe, expect, it } from "vitest";
import { dfcBodyOf } from "@/lib/cards/dfc";
import {
  frontDrawsPowerToughness,
  profileDrawsPowerToughness,
  profileSecondFaceDrawsPowerToughness,
  PT_NOT_DRAWN_NOTE,
  secondFaceDrawsPowerToughness,
  frontPrintsPowerToughnessOnTier,
  PT_NEEDS_TIER_NOTE,
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
  // The double-faced saga front (TODO 5.5 (b)): the saga's body — the back's
  // P/T is the tab's reverse P/T, not a slot of the front's.
  "sagadfcfront",
  // …and its back (5.5 (b) PR 2): a Saga back prints no P/T (a saga
  // creature back is 4.5d's body).
  "sagadfcback",
  "split",
  "aftermath",
];

/** Templates that paint a second face on their own master → whether that
 *  half draws a P/T. */
const INLINE_SECOND_FACE: Partial<Record<FrameTemplate, boolean>> = {
  adventure: false,
  // The Prepare page (TODO 4.27): a spell, the adventure's anatomy — no slot.
  prepare: false,
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
      // A corner slot, or the station frame's plate on a tier (TODO 4.27a).
      expect(frontDrawsPowerToughness(t), t).toBe(Boolean(profile.pt || profile.tiers));
      expect(profileDrawsPowerToughness(profile), t).toBe(Boolean(profile.pt || profile.tiers));
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
    // The back bodies with no slot today: the two land backs — and the
    // double-faced saga back (TODO 5.5 (b) PR 2: a Saga back prints none; a
    // saga creature back is 4.5d's body).
    expect(backs.filter((b) => !secondFaceDrawsPowerToughness(fronts[0], b))).toEqual(["m15dfclandback", "m15mdfclandback", "sagadfcback"]);
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

describe("the station frame prints its P/T on a tier (TODO 4.27a)", () => {
  it("a card with no tier draws none — whichever way its tiers are stored — and says which note to show", () => {
    for (const template of ["m15station", "m15stationland", "extendedartstation", "m15borderlessstation"]) {
      expect(frontPrintsPowerToughnessOnTier(template)).toBe(true);
      expect(frontDrawsPowerToughness(template, { rulesText: "Flying\nStation (…)" })).toBe(false);
      expect(frontDrawsPowerToughness(template, { rulesText: null })).toBe(false);
      expect(frontDrawsPowerToughness(template, { rulesText: "Flying\n8+ | Trample" })).toBe(true);
      expect(frontDrawsPowerToughness(template, { rulesText: "Flying", faceContent: { v: 1, station: { intro: "Flying", tiers: [{ threshold: 8, text: "Trample", pt: true }] } } })).toBe(true);
      expect(frontDrawsPowerToughness(template, { rulesText: "8+ | Trample", faceContent: { v: 1, station: { intro: null, tiers: [] } } })).toBe(false);
    }
    // Every other frame: the text changes nothing.
    expect(frontPrintsPowerToughnessOnTier("m15")).toBe(false);
    expect(frontDrawsPowerToughness("m15", { rulesText: null })).toBe(true);
    expect(frontDrawsPowerToughness("saga", { rulesText: "8+ | Trample" })).toBe(false);
    expect(PT_NEEDS_TIER_NOTE).toMatch(/Add a tier/);
  });
});
