import { describe, expect, it } from "vitest";
import { getFrameProfile, type FrameProfile } from "@/lib/cards/template-layout";
import {
  mergeProfile,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";

// ---------------------------------------------------------------------------
// Production ran six frame templates with DB layout overrides from July to
// September 2026 while every other environment rendered the code defaults.
// Migration 0114 deleted the rows and the values moved into
// lib/cards/template-layout.ts. This is the proof that the fold was exact:
// applying the production override snapshot over today's code profile must
// change NOTHING — otherwise production's look would have shifted at merge.
//
// Snapshot: `select template, overrides from frame_profile_overrides`
// on production, 2026-09-24.
// ---------------------------------------------------------------------------

const PRODUCTION_OVERRIDES_2026_09_24: FrameProfileOverridesMap = {
  m15devoid: {
    type: { rect: { topPct: 56.4 } },
    symbolRect: { topPct: 56.2, leftPct: 80.2, widthPct: 12, heightPct: 5.2 },
  },
  m15land: { title: { rect: { leftPct: 8.4 } } },
  m15pw: {
    type: { rect: { topPct: 56.8 } },
    title: { rect: { topPct: 3.8 } },
    costRect: { topPct: 3.8, leftPct: 51.2, widthPct: 40, heightPct: 4.4 },
    symbolRect: { topPct: 56.9, leftPct: 79, widthPct: 12, heightPct: 3.8 },
  },
  m15snowland: { title: { rect: { leftPct: 9.1 } } },
  modern: {
    pt: { rect: { topPct: 88.4 } },
    title: { rect: { topPct: 6, leftPct: 8.9 } },
    footer: { rect: { topPct: 92.2, leftPct: 15.5 } },
    costRect: { topPct: 5.6, leftPct: 52.3, widthPct: 39, heightPct: 4.4 },
    symbolRect: { topPct: 56.95, leftPct: 78.2, widthPct: 12, heightPct: 3.9 },
  },
  saga: { type: { rect: { topPct: 85.1 } } },
};

// Values deliberately moved in code AFTER the fold (the override rows are
// gone, so nothing re-applies the old ones). The old override would put each
// back; every other field of the snapshot must still be a no-op.
const MOVED_AFTER_FOLD: Record<string, (p: FrameProfile) => FrameProfile> = {
  // Frame review round 4: the planeswalker name lowered 8 px into CC's taller
  // title plate (3.8 → 4.18), with the pips (costDy, not in the snapshot).
  m15pw: (p) => ({ ...p, title: { ...p.title, rect: { ...p.title.rect, topPct: 3.8 } } }),
};

describe("folded production overrides (migration 0114)", () => {
  for (const [template, override] of Object.entries(PRODUCTION_OVERRIDES_2026_09_24)) {
    it(`${template}: the old override is a no-op over the folded code profile`, () => {
      const code = getFrameProfile(template);
      const undo = MOVED_AFTER_FOLD[template];
      expect(mergeProfile(code, override)).toEqual(undo ? undo(code) : code);
    });
  }

  it("m15pw: only the name's top moved after the fold", () => {
    const code = getFrameProfile("m15pw");
    expect(code.title.rect.topPct).toBe(4.18);
    expect(mergeProfile(code, PRODUCTION_OVERRIDES_2026_09_24.m15pw).title.rect.topPct).toBe(3.8);
  });

  it("the snow land keeps its own title inset, distinct from the plain land", () => {
    expect(getFrameProfile("m15snowland").title.rect.leftPct).toBe(9.1);
    expect(getFrameProfile("m15land").title.rect.leftPct).toBe(8.4);
  });

  it("devoid is no longer a bare alias of M15", () => {
    expect(getFrameProfile("m15devoid").type.rect.topPct).not.toBe(
      getFrameProfile("m15").type.rect.topPct,
    );
    expect(getFrameProfile("m15devoid").symbolRect).toBeDefined();
    expect(getFrameProfile("m15").symbolRect).toBeUndefined();
  });
});
