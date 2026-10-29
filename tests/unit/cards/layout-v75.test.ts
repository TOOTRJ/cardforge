import { describe, expect, it } from "vitest";
import {
  CARD_LAYOUT_VERSION,
  LIVE_RENDER_SCOPES,
  V75_WALKER_TEMPLATES,
  VERSION_ROLLOUT,
  WALKER_BADGES_LAYOUT_VERSION,
  isRenderStale,
  liveRenderScopesSince,
  v75WalkerRowsChanged,
} from "@/lib/cards/layout-version";
import {
  LOYALTY_BADGE_PRINT,
  layoutProfileLoyaltyRows,
  loyaltyBadgeLabel,
  loyaltyBadgeNumeralPx,
  loyaltyBadgesDrawing,
} from "@/lib/cards/loyalty-rows";
import { measuredLinePreviewPct, measuredLinePx, probeLiveShrunkLines } from "@/lib/cards/render-tiers";
import { statInkEm } from "@/lib/cards/stat-fit";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Layout v75 (owner 2026-10-28): the walker's loyalty badges on print (TODO
// 4.19's badge rail) — a sweep of the planeswalkers that draw ability rows
// on the three walker bodies — and the long name at the 750 px bake (TODO
// 3.37 (d)), which no stored bake carries (LIVE_RENDER_SCOPES).
// ---------------------------------------------------------------------------

const V = WALKER_BADGES_LAYOUT_VERSION;
const WALKER = { card_type: "planeswalker", rules_text: "+1: Draw a card.", face_content: null } as const;

describe("v75 — the walker's badges on print", () => {
  it("is the current version, a sweep (a correction, never a badge)", () => {
    expect(V).toBe(75);
    expect(CARD_LAYOUT_VERSION).toBe(V);
    expect(VERSION_ROLLOUT[V]).toBe("sweep");
  });

  it("names every template that draws walker rows, and nothing else", () => {
    expect([...V75_WALKER_TEMPLATES].sort()).toEqual(["m15borderlesspw", "m15borderlesspwtall", "m15pw"]);
    for (const t of V75_WALKER_TEMPLATES) expect(getFrameProfile(t).loyaltyRows, t).toBeDefined();
  });

  it("re-bakes a planeswalker with rows on a walker body; never another card or another template", () => {
    const at = (template: string, card: Record<string, unknown>) =>
      isRenderStale(V - 1, template, undefined, V, { frame_style: { template }, ...card } as never);
    for (const t of V75_WALKER_TEMPLATES) {
      expect(at(t, WALKER), t).toBe(true);
      // Rows held as face_content alone.
      expect(at(t, { ...WALKER, rules_text: null, face_content: { v: 1, loyalty: { abilities: [{ cost: "+1", text: "Scry 1." }] } } }), t).toBe(true);
      // A walker with no text draws the plain box: as before.
      expect(at(t, { ...WALKER, rules_text: "  ", face_content: null }), t).toBe(false);
      // Another card on the walker body: the plain box.
      expect(at(t, { ...WALKER, card_type: "creature" }), t).toBe(false);
    }
    expect(at("m15", WALKER)).toBe(false);
    expect(at("m15borderless", WALKER)).toBe(false);
  });

  it("reads an absent column as affected", () => {
    expect(v75WalkerRowsChanged({})).toBe(true);
    expect(v75WalkerRowsChanged({ card_type: "planeswalker", rules_text: "x" })).toBe(true);
  });
});

describe("v75 — the long name at the 750 px bake (3.37 (d)): live renders only", () => {
  it("is a LIVE scope: the sweep never reads it, the visual matrix's 750 px cases do", () => {
    expect(LIVE_RENDER_SCOPES[V]).toBe("measured-line");
    expect(liveRenderScopesSince(V - 1, V)).toEqual(["measured-line"]);
    expect(liveRenderScopesSince(V, V)).toEqual([]);
    // A long-named creature on M15 is not in the stored sweep.
    expect(
      isRenderStale(V - 1, "m15", undefined, V, {
        frame_style: { template: "m15" },
        card_type: "creature",
        title: "Sisay, Captain of the Endless Weatherlight Skies",
        rules_text: "Flying",
        face_content: null,
        nickname: null,
        printed_types: null,
      } as never),
    ).toBe(false);
  });

  it("sets a shrunk line at the stored HD bake's px halved at 750 — the preview's — and leaves HD and an unshrunk line alone", () => {
    const base = 0.04;
    for (const fit of [0.0351, 0.0357, 0.0362, 0.0379]) {
      const hd = Math.floor(fit * 1500);
      expect(measuredLinePx(fit, base, 1500)).toBe(hd);
      expect(measuredLinePx(fit, base, 750)).toBe(hd / 2);
      // …exactly the preview's size, in the same card-width share.
      expect(measuredLinePx(fit, base, 750) / 750).toBeCloseTo(measuredLinePreviewPct(fit, base), 12);
    }
    expect(measuredLinePx(base, base, 750)).toBe(Math.round(base * 750));
    // Landscape: the stored width is 2100, the 750 preset's 1050.
    expect(measuredLinePx(0.0351, 0.04, 1050, "landscape")).toBe(Math.floor(0.0351 * 2100) / 2);
  });

  it("the probe sees exactly the narrower bake's shrunk lines", async () => {
    expect((await probeLiveShrunkLines(async () => measuredLinePx(0.0351, 0.04, 750))).shrunk).toBe(true);
    expect((await probeLiveShrunkLines(async () => measuredLinePx(0.0351, 0.04, 1500))).shrunk).toBe(false);
    expect((await probeLiveShrunkLines(async () => measuredLinePx(0.04, 0.04, 750))).shrunk).toBe(false);
    // Outside a probe nothing is recorded (and nothing throws).
    expect(measuredLinePx(0.0351, 0.04, 750)).toBe(Math.floor(0.0351 * 1500) / 2);
  });
});

describe("v75 — a badge's numeral fits its face", () => {
  it("keeps 62 px for every one- and two-digit cost, and steps a three-digit one down to an even px that fits", () => {
    const face = LOYALTY_BADGE_PRINT.faceWidthPx;
    for (const cost of ["+1", "0", "-2", "-10", "+10", "-X", "+X", "-99"]) {
      expect(loyaltyBadgeNumeralPx(loyaltyBadgeLabel(cost)), cost).toBe(LOYALTY_BADGE_PRINT.numeralPx);
    }
    for (const cost of ["+100", "-100", "-250"]) {
      const label = loyaltyBadgeLabel(cost);
      const px = loyaltyBadgeNumeralPx(label);
      const ink = statInkEm(label);
      expect(px, cost).toBeLessThan(LOYALTY_BADGE_PRINT.numeralPx);
      expect(px % 2, cost).toBe(0);
      // Its ink (either renderer's reach, each side of the centre) inside
      // the face, with room to spare on both sides…
      expect(2 * Math.max(ink.left, ink.right) * px, cost).toBeLessThanOrEqual(face - 16);
      // …where at 62 px it was not.
      expect(2 * Math.max(ink.left, ink.right) * LOYALTY_BADGE_PRINT.numeralPx, cost).toBeGreaterThan(face - 16);
    }
    // Never below the rules floor.
    expect(loyaltyBadgeNumeralPx(loyaltyBadgeLabel("-100000"))).toBe(42);
  });

  it("is the size both renderers draw: the drawing's numeral at each target", () => {
    const abilities = [
      { cost: "+100", text: "Draw a card." },
      { cost: "-2", text: "Scry 2." },
    ];
    const rows = layoutProfileLoyaltyRows(getFrameProfile("m15pw"), abilities, 7 / 5);
    const [big, small] = loyaltyBadgesDrawing(rows, abilities, "hd");
    expect(big.numeral.fontPx).toBe(loyaltyBadgeNumeralPx("+100"));
    expect(big.numeral.fontPx).toBe(50);
    expect(small.numeral.fontPx).toBe(62);
    const [big750, small750] = loyaltyBadgesDrawing(rows, abilities, "default");
    expect([big750.numeral.fontPx, small750.numeral.fontPx]).toEqual([25, 31]);
  });
});
