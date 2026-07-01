import { describe, expect, it } from "vitest";

import {
  FRAME_REFERENCE_CARDS,
  getFrameReferenceCard,
} from "@/lib/cards/frame-reference-cards";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// The comparison tool is only useful when every reference actually renders
// through ITS era's frame profile — a typo'd template would silently fall
// back to M15 and the overlay would "measure" the wrong frame.
// ---------------------------------------------------------------------------

describe("frame reference cards", () => {
  it("every reference template is a real frame template", () => {
    for (const ref of FRAME_REFERENCE_CARDS) {
      expect(FRAME_TEMPLATE_VALUES).toContain(ref.template);
      expect(ref.preview.frameStyle?.template).toBe(ref.template);
    }
  });

  it("every reference resolves to its own profile, not the M15 fallback", () => {
    const m15Profile = getFrameProfile("m15");
    for (const ref of FRAME_REFERENCE_CARDS) {
      const profile = getFrameProfile(ref.template);
      if (ref.template !== "m15") {
        expect(profile).not.toBe(m15Profile);
      }
      expect(profile.label.length).toBeGreaterThan(0);
    }
  });

  it("keys are unique and scryfall ids look like UUIDs", () => {
    const keys = new Set(FRAME_REFERENCE_CARDS.map((r) => r.key));
    expect(keys.size).toBe(FRAME_REFERENCE_CARDS.length);
    for (const ref of FRAME_REFERENCE_CARDS) {
      expect(ref.scryfallId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it("falls back to the M15 reference for unknown keys", () => {
    expect(getFrameReferenceCard("nope").template).toBe("m15");
    expect(getFrameReferenceCard(null).template).toBe("m15");
    expect(getFrameReferenceCard("1997-retro").template).toBe("retro");
  });
});
