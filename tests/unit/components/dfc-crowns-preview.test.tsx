// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import type { CardBackFace, ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview half of TODO 5.1d (the bake half: tests/unit/render/
// dfc-crowns-bake.test.tsx): CardPreview draws the crown piece BEFORE the
// icon rider in the overlay layer (DOM order is paint order for the layer's
// absolutely placed siblings), from the folder of the face's well — the
// left well's on the transform front and the 2016–22 back, the right well's
// on the ▼ back, the housing's on the modal faces — keyed by the master
// actually drawn (the pair with the two-colour switch, gold without); a
// nonlegendary front with a Legendary back draws the back's crown alone; the
// switch off draws none. Read from the server markup.
// ---------------------------------------------------------------------------

const BACK: CardBackFace = {
  title: "Tovolar, the Midnight Scourge",
  cost: "",
  card_type: "creature",
  supertype: "Legendary",
  subtypes: ["Werewolf"],
  rules_text: "Whenever a Wolf or Werewolf you control deals combat damage to a player, draw a card.",
  power: "4",
  toughness: "4",
  frame_style: { template: "m15dfcbackleft" },
  color_identity: ["red", "green"],
};

function preview(frameStyle: FrameStyle, over: { supertype?: string | null; backFace?: CardBackFace | null; colors?: ColorIdentity[]; cost?: string; cardType?: "creature" | "land" } = {}) {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Tovolar, Dire Overlord"
      cardType={over.cardType ?? "creature"}
      supertype={over.supertype === undefined ? "Legendary" : over.supertype}
      subtypes={["Human", "Werewolf"]}
      colorIdentity={over.colors ?? ["red", "green"]}
      rulesText="Daybound"
      cost={over.cost ?? "{1}{R}{G}"}
      power="3"
      toughness="3"
      rarity="mythic"
      frameStyle={frameStyle}
      backFace={over.backFace === undefined ? BACK : over.backFace}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const faces = Array.from(doc.querySelectorAll<HTMLElement>("[aria-hidden][style*='backface-visibility']"));
  return { html, front: faces[0] ?? doc.body, back: faces[1] ?? null };
}
const overlays = (root: Element | null) =>
  Array.from(root?.querySelectorAll("[data-frame-overlay]") ?? []).map((el) => `${el.getAttribute("data-frame-overlay")}:${el.getAttribute("data-overlay-key")}`);
const overlayUrl = (root: Element | null, anatomy: string) => root?.querySelector(`[data-frame-overlay="${anatomy}"]`)?.getAttribute("style") ?? "";

describe("CardPreview — the crown and the pairs on the double-faced bodies (TODO 5.1d)", () => {
  it("a crowned Legendary transform front: the crown piece first, the family's glyph after it; the switch off draws the glyph alone", () => {
    const on = preview({ template: "m15dfcfront", dfcIcon: "sunmoon", crown: true });
    expect(overlays(on.front)).toEqual(["crown:m", "dfcIcon:sun"]);
    expect(overlayUrl(on.front, "crown")).toContain("m15dfccrown/m.");
    expect(overlays(preview({ template: "m15dfcfront", dfcIcon: "sunmoon", crown: false }).front)).toEqual(["dfcIcon:sun"]);
    expect(overlays(preview({ template: "m15dfcfront", dfcIcon: "sunmoon" }).front)).toEqual(["dfcIcon:sun"]);
  });

  it("both switches on an R/G card: the pair master and the pair's crown on the front, the 2016–22 back (left well, the moon after it) and the ▼ back (right well, no rider)", () => {
    const left = preview({ template: "m15dfcfront", dfcIcon: "sunmoon", crown: true, twoColor: true });
    expect(left.html).toContain("m15dfcfront/rg.");
    expect(overlays(left.front)).toEqual(["crown:rg", "dfcIcon:sun"]);
    expect(overlayUrl(left.front, "crown")).toContain("m15dfccrown/rg.");
    expect(left.html).toContain("m15dfcbackleft/rg.");
    expect(overlays(left.back)).toEqual(["crown:rg", "dfcIcon:moon"]);
    expect(overlayUrl(left.back, "crown")).toContain("m15dfccrown/rg.");
    const right = preview({ template: "m15dfcfront", crown: true, twoColor: true }, { backFace: { ...BACK, frame_style: { template: "m15dfcback" } } });
    expect(right.html).toContain("m15dfcback/rg.");
    expect(overlays(right.back)).toEqual(["crown:rg"]);
    expect(overlayUrl(right.back, "crown")).toContain("m15dfccrownright/rg.");
    // The two-colour switch off: gold, and the gold crown.
    const gold = preview({ template: "m15dfcfront", crown: true }, { backFace: { ...BACK, frame_style: { template: "m15dfcback" } } });
    expect(gold.html).toContain("m15dfcback/m.");
    expect(gold.html).not.toContain("m15dfcback/rg.");
    expect(overlays(gold.back)).toEqual(["crown:m"]);
  });

  it("a nonlegendary front with a Legendary back (MOM #43's shape): the back's crown alone; off removes it", () => {
    const on = preview({ template: "m15dfcfront", crown: true }, { supertype: null, backFace: { ...BACK, frame_style: { template: "m15dfcback" } } });
    expect(overlays(on.front)).toEqual(["dfcIcon:default"]);
    expect(overlays(on.back)).toEqual(["crown:m"]);
    const off = preview({ template: "m15dfcfront", crown: false }, { supertype: null, backFace: { ...BACK, frame_style: { template: "m15dfcback" } } });
    expect(overlays(off.back)).toEqual([]);
  });

  it("the modal faces wear the housing's crown — the hybrid dress on an all-hybrid front cost, the split on the back; the ▼ land back draws neither", () => {
    const modal = preview(
      { template: "m15mdfcfront", crown: true, twoColor: true },
      { colors: ["white", "blue"], cost: "{W/U}{W/U}", backFace: { ...BACK, title: "Black Panther, Hope Enduring", cost: "{3}{W}{U}", frame_style: { template: "m15mdfcback" }, color_identity: ["white", "blue"] } },
    );
    expect(modal.html).toContain("m15mdfcfront/wu-h.");
    expect(overlays(modal.front)).toEqual(["crown:wu"]);
    expect(overlayUrl(modal.front, "crown")).toContain("m15mdfccrown/wu.");
    expect(modal.html).toContain("m15mdfcback/wu.");
    expect(overlays(modal.back)).toEqual(["crown:wu"]);
    const land = preview(
      { template: "m15dfcfront", crown: true, twoColor: true },
      { backFace: { ...BACK, title: "Westvale Abbey", card_type: "land", cost: "", power: undefined, toughness: undefined, subtypes: [], frame_style: { template: "m15dfclandback" }, color_identity: ["colorless"] } },
    );
    expect(land.html).toContain("m15dfclandback/c.");
    expect(overlays(land.back)).toEqual([]);
  });
});
