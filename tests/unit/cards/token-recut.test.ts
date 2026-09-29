import { describe, expect, it } from "vitest";
import { TOKEN_TEXTLESS_RECUT } from "@/scripts/lib/cc-frames.mjs";
import { SET_SYMBOL_BOX_PCT } from "@/lib/cards/typography";
import { TOKEN_PILL_INTERIOR_PX, TOKEN_RECUT_PX, getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// TODO 4.49, owner decision 2026-09-29: the textless token masters are
// RE-CUT — CC's window edge, type pill and the pill's shadow 8 px lower, as
// the fifteen 2014–19 textless pins print them (scripts/lib/cc-frames.mjs
// TOKEN_TEXTLESS_RECUT). The masters live in the frames bucket (never in
// git); what the profile must do with them is pinned here: the art slot,
// the type band and the set symbol's box ride the moved band, and the
// symbol keeps clear of the pill's bevels (tall glyphs sat on CC's bottom
// bevel before: the print pass had moved the symbol 8 px down onto the
// prints but not the pill).
// ---------------------------------------------------------------------------

const H = 2100;
const px = (pct: number) => (pct / 100) * H;
const TEMPLATES = ["m15token", "m15tokenartifact"] as const;

describe("the textless token re-cut (TODO 4.49)", () => {
  it("moves the profile by exactly the importer's shift", () => {
    expect(TOKEN_RECUT_PX).toBe(TOKEN_TEXTLESS_RECUT.shift);
    expect(TOKEN_RECUT_PX).toBe(8);
  });

  it.each(TEMPLATES)("%s: the art slot ends where the re-cut window does, 8 px lower than on CC's master", (t) => {
    const art = getFrameProfile(t).artSlot;
    expect(art.topPct).toBe(12.0);
    // CC's window: last clear row 1700 on the see-through and coloured
    // artifact masters (the slot ended at 1701); re-cut, 1708 → 1709.
    expect(px(art.topPct + art.heightPct)).toBeCloseTo(1701 + TOKEN_RECUT_PX, 9);
  });

  it.each(TEMPLATES)("%s: the type band centres on the re-cut pill", (t) => {
    const band = getFrameProfile(t).type.rect;
    const centre = px(band.topPct + band.heightPct / 2);
    const pill = (TOKEN_PILL_INTERIOR_PX.top + TOKEN_PILL_INTERIOR_PX.bottom + 1) / 2;
    expect(Math.abs(centre - pill)).toBeLessThanOrEqual(0.5);
  });

  it.each(TEMPLATES)("%s: the set symbol's box sits inside the re-cut pill, clear of both bevels", (t) => {
    const box = getFrameProfile(t).symbolRect!;
    expect(box.heightPct).toBeCloseTo(4.1, 9);
    expect(px(box.heightPct)).toBeCloseTo(SET_SYMBOL_BOX_PCT * 1500, 0);
    const top = px(box.topPct);
    const bottom = px(box.topPct + box.heightPct);
    // CC's box, centred on the moved pill: 84.39 %H + 8 px.
    expect(px(box.topPct + box.heightPct / 2)).toBeCloseTo(px(84.39) + TOKEN_RECUT_PX, 9);
    // The pill's interior (inclusive rows) holds the whole 86 px box — an
    // uploaded icon fills it — with room: ≥ 12 px under the top outline,
    // ≥ 6 px above the bottom bevel's first shaded row. On CC's un-moved
    // pill (1716–1822) the print pass's box (1737.4–1823.4) reached into
    // the bevel.
    expect(top - TOKEN_PILL_INTERIOR_PX.top).toBeGreaterThanOrEqual(12);
    expect(TOKEN_PILL_INTERIOR_PX.bottom + 1 - bottom).toBeGreaterThanOrEqual(6);
  });

  it("puts the pill where the prints do", () => {
    // Fifteen textless pins: interior 1724.1–1828.7 px (means of the edges);
    // CC's 1716–1822 moved 8 px lands within 1.6 px of both.
    expect(TOKEN_PILL_INTERIOR_PX).toEqual({ top: 1724, bottom: 1830 });
    expect(Math.abs(TOKEN_PILL_INTERIOR_PX.top - 1724.1)).toBeLessThan(1);
    expect(Math.abs(TOKEN_PILL_INTERIOR_PX.bottom - 1828.7)).toBeLessThan(2);
  });
});
