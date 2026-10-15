import { describe, expect, it } from "vitest";
import { normalizeAnatomy, resolveFrameOverlays, resolveTwoColor } from "@/lib/cards/anatomy";
import { frameMasterKey } from "@/components/cards/frame-layer";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// Follow-ups to #566 (owner Round 63, 2026-10-14):
//   • the two-colour (gold-split and hybrid) extended art and its land
//     dress's pairs — opt-in per card (frame_style.twoColor), the split
//     floating crown over a pair master;
//   • a colourless legendary ARTIFACT on extended art keeps the grey C
//     crown (owner Round 67);
//   • the legendary textless promos' crown: the standard band, a pair's
//     crown split over the gold rim (pairCrownOnGold).
// ---------------------------------------------------------------------------

const KEY: Record<string, string> = { white: "w", blue: "u", black: "b", red: "r", green: "g", colorless: "c" };
const facts = (colors: ColorIdentity[], over: Record<string, unknown> = {}) => ({
  colors,
  colorKey: colors.length > 1 ? "m" : KEY[colors[0] ?? "colorless"],
  cost: colors.length === 2 ? "{1}{W}{U}" : "{2}",
  cardType: "creature",
  supertype: "Legendary",
  ...over,
});
const crownKey = (template: string, style: Record<string, unknown>, f: ReturnType<typeof facts>) =>
  resolveFrameOverlays(getFrameProfile(template), style, f).find((o) => o.anatomy === "crown")?.key ?? null;

describe("extended art: a colourless artifact keeps the grey C crown (owner Round 67)", () => {
  it("paints the silver `a` master under CC's grey C crown, as before — the crown is keyed by the card's colour", () => {
    const p = getFrameProfile("extendedart");
    const artifact = facts(["colorless"], { cardType: "artifact" });
    const artifactCreature = facts(["colorless"], { supertype: "Legendary Artifact" });
    expect(frameMasterKey(p, artifact.colors, artifact)).toBe("a");
    expect(crownKey("extendedart", { crown: true }, artifact)).toBe("c");
    expect(crownKey("extendedart", { crown: true }, artifactCreature)).toBe("c");
    expect(crownKey("extendedart", { crown: true }, facts(["colorless"]))).toBe("c");
    expect(getFrameProfile("extendedart").overlays![0].keys).not.toContain("a");
  });
});

describe("extended art: the two-colour pairs (opt-in per card)", () => {
  it("a stored pair with the switch on paints its dress's master and the pair's split crown; off, the gold frame and crown", () => {
    const p = getFrameProfile("extendedart");
    const wu = facts(["white", "blue"]);
    expect(frameMasterKey(p, wu.colors, wu, { twoColor: true })).toBe("wu");
    expect(crownKey("extendedart", { crown: true, twoColor: true }, wu)).toBe("wu");
    expect(frameMasterKey(p, wu.colors, wu, {})).toBe("m");
    expect(crownKey("extendedart", { crown: true }, wu)).toBe("m");
    const hybrid = facts(["white", "blue"], { cost: "{W/U}{W/U}" });
    expect(resolveTwoColor(p, { twoColor: true }, hybrid)).toMatchObject({ dress: "hybrid", masterKey: "wu-h" });
    expect(frameMasterKey(p, hybrid.colors, hybrid, { twoColor: true })).toBe("wu-h");
    expect(crownKey("extendedart", { crown: true, twoColor: true }, hybrid)).toBe("wu");
  });

  it("a land wears pairs on the land dress only, never on the spell frame", () => {
    const land = facts(["black", "red"], { cardType: "land", cost: null });
    expect(frameMasterKey(getFrameProfile("extendedartland"), land.colors, land, { twoColor: true })).toBe("br");
    expect(crownKey("extendedartland", { crown: true, twoColor: true }, land)).toBe("br");
    expect(normalizeAnatomy({ template: "extendedartland", twoColor: true }, "extendedartland", "land")).toEqual({ template: "extendedartland", twoColor: true });
    // On the spell frame a land's switch is dropped (twoColorForLands).
    expect(normalizeAnatomy({ template: "extendedart", twoColor: true }, "extendedart", "land")).toEqual({ template: "extendedart" });
  });

  it("a stored card saved before the pairs has no switch and keeps the gold look", () => {
    // normalizeAnatomy dropped `twoColor` on every save while the frame drew
    // no pairs, so a stored two-colour card reads as off.
    const p = getFrameProfile("extendedart");
    const wu = facts(["white", "blue"]);
    expect(frameMasterKey(p, wu.colors, wu, { template: "extendedart" } as never)).toBe("m");
  });
});

describe("the legendary textless promos' crown", () => {
  it("the standard band in the card's colour; the colourless rim's key (artifact silver on the spell, land grey on the land)", () => {
    expect(resolveFrameOverlays(getFrameProfile("m15textless"), { crown: true }, facts(["blue"]))).toEqual([
      { anatomy: "crown", rect: getFrameProfile("m15").overlays![0].rect, key: "u", path: "/frames/m15crown/u.png" },
    ]);
    expect(crownKey("m15textless", { crown: true }, facts(["colorless"]))).toBe("a");
    expect(crownKey("m15textlessland", { crown: true }, facts(["colorless"], { cardType: "land" }))).toBe("l");
    expect(crownKey("m15textless", { crown: true }, facts(["white", "blue", "black"]))).toBe("m");
  });

  it("a pair's crown is split over the GOLD rim (no pair masters, no switch): PF26 #15 / #16, PL22 #2", () => {
    const p = getFrameProfile("m15textless");
    const wb = facts(["white", "black"]);
    expect(p.twoColorMasters).toBeUndefined();
    expect(frameMasterKey(p, wb.colors, wb, { crown: true })).toBe("m");
    expect(crownKey("m15textless", { crown: true }, wb)).toBe("wb");
    // …whatever a stray switch says (normalizeAnatomy drops it on a save).
    expect(crownKey("m15textless", { crown: true, twoColor: false }, wb)).toBe("wb");
    expect(normalizeAnatomy({ template: "m15textless", crown: true, twoColor: true }, "m15textless", "creature")).toEqual({ template: "m15textless", crown: true });
  });

  it("only with the switch on, on a Legendary card", () => {
    expect(crownKey("m15textless", {}, facts(["blue"]))).toBeNull();
    expect(crownKey("m15textless", { crown: true }, facts(["blue"], { supertype: null }))).toBeNull();
  });
});
