import { describe, expect, it } from "vitest";
import {
  ANATOMY_CAPABILITIES,
  KIND_ONLY_SLOTS,
  KIND_REQUIRES,
  capabilitiesOf,
  kindDrawsSlot,
  profileDrawsKind,
  walkerAnatomy,
} from "@/lib/cards/kind-anatomy";
import { getFrameProfile, type FrameProfile, type StatSlot } from "@/lib/cards/template-layout";
import { CARD_KIND_VALUES } from "@/lib/creator/card-kinds";

// ---------------------------------------------------------------------------
// lib/cards/kind-anatomy.ts (TODO 4.5.0): the anatomy a body draws, read
// from its profile's fields; what each kind needs; and the walker builder
// m15pw and the borderless walkers are built with.
// ---------------------------------------------------------------------------

const shield: StatSlot = {
  rect: { topPct: 90, leftPct: 80, widthPct: 14, heightPct: 4 },
  plateAssetPathTemplate: "/frames/probe/loyalty/{color}.png",
  sizePct: 0.05,
  colorHex: "#ffffff",
};

describe("KIND_REQUIRES", () => {
  it("names every kind, with known capabilities only", () => {
    expect(Object.keys(KIND_REQUIRES).sort()).toEqual([...CARD_KIND_VALUES].sort());
    for (const caps of Object.values(KIND_REQUIRES)) {
      for (const cap of caps) expect(ANATOMY_CAPABILITIES).toContain(cap);
    }
  });

  it("gives each kind-only slot to exactly one kind", () => {
    for (const slot of KIND_ONLY_SLOTS) {
      expect(CARD_KIND_VALUES.filter((kind) => kindDrawsSlot(kind, slot)), slot).toHaveLength(1);
    }
    expect(kindDrawsSlot("planeswalker", "loyalty")).toBe(true);
    expect(kindDrawsSlot("battle", "defense")).toBe(true);
    expect(kindDrawsSlot("saga", "chapters")).toBe(true);
    expect(kindDrawsSlot("creature", "loyalty")).toBe(false);
  });
});

describe("capabilitiesOf / profileDrawsKind", () => {
  it("reads the profile's fields", () => {
    expect([...capabilitiesOf(getFrameProfile("m15"))]).toEqual(["pt"]);
    expect([...capabilitiesOf(getFrameProfile("m15pw"))].sort()).toEqual(["loyalty", "loyaltyRows"]);
    expect([...capabilitiesOf(getFrameProfile("battle"))].sort()).toEqual(["defense", "landscape"]);
    expect([...capabilitiesOf(getFrameProfile("saga"))]).toEqual(["chapters"]);
    expect([...capabilitiesOf(getFrameProfile("fullartland"))].sort()).toEqual(["basicSymbol", "pt"]);
  });

  it("counts a spread profile and a builder-made one alike", () => {
    const base = getFrameProfile("lotr");
    const walker = walkerAnatomy({ shield, stripes: { a: "#fff", b: "#eee" }, badgeTextHex: "#000", maxSizePct: 0.03 });
    const spread: FrameProfile = { ...base, loyalty: walker.loyalty, loyaltyRows: walker.loyaltyRows };
    expect(profileDrawsKind(base, "planeswalker")).toBe(false);
    expect(profileDrawsKind(spread, "planeswalker")).toBe(true);
    // Half a walker isn't one: the shield without the rows.
    expect(profileDrawsKind({ ...base, loyalty: walker.loyalty }, "planeswalker")).toBe(false);
  });

  it("a battle needs the defense shield on the landscape card", () => {
    const battle = getFrameProfile("battle");
    expect(profileDrawsKind(battle, "battle")).toBe(true);
    expect(profileDrawsKind({ ...battle, orientation: "portrait" }, "battle")).toBe(false);
    expect(profileDrawsKind(getFrameProfile("split"), "battle")).toBe(false);
  });

  it("the kinds that need nothing a body can lack are drawn by any body", () => {
    for (const kind of ["instant", "sorcery", "artifact", "enchantment", "land", "token", "emblem"] as const) {
      expect(profileDrawsKind(getFrameProfile("m15pw"), kind), kind).toBe(true);
    }
  });
});

describe("walkerAnatomy", () => {
  it("assembles the shield, the rows and the backdrop from the body's own values", () => {
    const w = walkerAnatomy({
      shield,
      stripes: { a: "rgba(1,1,1,0.5)", b: "rgba(2,2,2,0.5)" },
      badges: "mse-m15",
      badgeTextHex: "#f5f0e4",
      maxSizePct: 0.031,
      rulesBackdropHex: "rgba(3,3,3,0.7)",
      rulesBackdropWhenEmpty: true,
    });
    expect(w.loyalty).toEqual(shield);
    expect(w.loyaltyRows).toEqual({
      maxSizePct: 0.031,
      badgeTextHex: "#f5f0e4",
      stripeAHex: "rgba(1,1,1,0.5)",
      stripeBHex: "rgba(2,2,2,0.5)",
    });
    expect(w.rulesPatch).toEqual({ backdropHex: "rgba(3,3,3,0.7)", backdropWhenEmpty: true });
    // No backdrop asked for: the patch adds nothing to the rules slot.
    expect(walkerAnatomy({ shield, stripes: { a: "a", b: "b" }, badgeTextHex: "#000", maxSizePct: 0.03 }).rulesPatch).toEqual({});
  });

  it("is deep-frozen: a profile that spreads it can't edit another body's anatomy", () => {
    const w = walkerAnatomy({ shield: { ...shield, rect: { ...shield.rect } }, stripes: { a: "a", b: "b" }, badgeTextHex: "#000", maxSizePct: 0.03 });
    expect(Object.isFrozen(w)).toBe(true);
    expect(Object.isFrozen(w.loyalty)).toBe(true);
    expect(Object.isFrozen(w.loyalty.rect)).toBe(true);
    expect(Object.isFrozen(w.loyaltyRows)).toBe(true);
    expect(() => {
      (w.loyalty.rect as { topPct: number }).topPct = 1;
    }).toThrow(TypeError);
  });

  it("builds m15pw and both borderless walkers: their shields differ only by the plate cut from their own masters", () => {
    const pw = getFrameProfile("m15pw");
    const bl = getFrameProfile("m15borderlesspw");
    const tall = getFrameProfile("m15borderlesspwtall");
    expect(pw.loyalty?.plateAssetPathTemplate).toBe("/frames/m15pw/loyalty/{color}.png");
    expect(bl.loyalty?.plateAssetPathTemplate).toBe("/frames/m15borderlesspw/loyalty/{color}.png");
    expect(tall.loyalty?.plateAssetPathTemplate).toBe("/frames/m15borderlesspwtall/loyalty/{color}.png");
    const withoutPlate = (slot: StatSlot | undefined) => ({ ...slot, plateAssetPathTemplate: undefined });
    expect(withoutPlate(bl.loyalty)).toEqual(withoutPlate(pw.loyalty));
    expect(withoutPlate(tall.loyalty)).toEqual(withoutPlate(pw.loyalty));
    // The borderless rows are the neutral stripes, with the backdrop drawn
    // even with no text (4.33); m15pw's the cream ones.
    expect(tall.loyaltyRows).toEqual(bl.loyaltyRows);
    expect(bl.loyaltyRows?.stripeAHex).toBe(bl.rules.backdropHex);
    expect(bl.rules.backdropWhenEmpty).toBe(true);
    expect(pw.rules.backdropWhenEmpty).toBeUndefined();
    expect(pw.loyaltyRows?.stripeAHex).not.toBe(bl.loyaltyRows?.stripeAHex);
  });
});
