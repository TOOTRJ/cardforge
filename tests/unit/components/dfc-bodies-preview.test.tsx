// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { COLOR_INDICATOR, colorIndicatorBox } from "@/lib/cards/color-indicator";
import { DFC_ICON_RIDER, DFC_REVERSE_PT, getFrameProfile } from "@/lib/cards/template-layout";
import type { CardBackFace } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview half of TODO 5.1a's transform bodies: CardPreview draws what
// the bake draws (tests/unit/render/dfc-bodies-bake.test.tsx measures the
// bake) — on the FRONT the icon rider keyed by the family's front glyph, the
// back's P/T in the grey tab (end-aligned, #777, only when the back prints
// one) and the name from the icon face's inset; on the BACK face (flipped
// through lib/cards/faces.ts backPreviewData: its own body and colour) no
// cost, the colour-indicator dot with the type line indented past it, the
// 2016–22 back's rider keyed by the family's back glyph, the dark plate. A
// legacy back (no body) keeps today's flip. Read from the server markup.
// ---------------------------------------------------------------------------

const BACK: CardBackFace = {
  title: "Insectile Aberration",
  cost: "",
  card_type: "creature",
  subtypes: ["Human", "Insect"],
  rules_text: "Flying",
  power: "3",
  toughness: "2",
  frame_style: { template: "m15dfcback" },
  color_identity: ["blue"],
};

function preview(over: { backFace?: CardBackFace | null; dfcIcon?: "arrows" | "sunmoon" | "moon" | "compass" | "fan"; template?: "m15dfcfront" | "m15dfclandfront" | "m15"; colors?: ("white" | "blue" | "black" | "green" | "colorless")[] } = {}) {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Delver of Secrets"
      cardType={over.template === "m15dfclandfront" ? "land" : "creature"}
      supertype={null}
      subtypes={["Human", "Wizard"]}
      colorIdentity={over.colors ?? ["blue"]}
      rulesText="Flying"
      cost="{U}"
      power="1"
      toughness="1"
      rarity="common"
      frameStyle={{ template: over.template ?? "m15dfcfront", ...(over.dfcIcon ? { dfcIcon: over.dfcIcon } : {}) }}
      backFace={over.backFace === undefined ? BACK : over.backFace}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const faces = Array.from(doc.querySelectorAll<HTMLElement>("[aria-hidden][style*='backface-visibility']"));
  return { html, doc, front: faces[0] ?? doc.body, back: faces[1] ?? null };
}

const overlayKeys = (root: Element | null) =>
  Array.from(root?.querySelectorAll("[data-frame-overlay]") ?? []).map((el) => `${el.getAttribute("data-frame-overlay")}:${el.getAttribute("data-overlay-key")}`);

describe("CardPreview — the transform bodies (TODO 5.1a)", () => {
  it("the front draws the family's front glyph in the well (arrows → default, sun / moon → sun) and the back's P/T in the tab", () => {
    const { front, back } = preview();
    expect(overlayKeys(front)).toEqual(["dfcIcon:default"]);
    expect(front.querySelector("[data-frame-overlay]")?.getAttribute("style")).toContain("dfcicon/default.webp");
    const tab = front.querySelector<HTMLElement>('[data-testid="reverse-pt"]');
    expect(tab?.textContent).toBe("3/2");
    expect(tab?.getAttribute("style")).toContain("justify-content:flex-end");
    expect(tab?.querySelector("span")?.getAttribute("style")).toContain(`color:${DFC_REVERSE_PT.colorHex}`);
    // The ▼ back draws no rider (its ▼ is the master's).
    expect(overlayKeys(back)).toEqual([]);
    expect(overlayKeys(preview({ dfcIcon: "sunmoon" }).front)).toEqual(["dfcIcon:sun"]);
    expect(overlayKeys(preview({ dfcIcon: "compass" }).front)).toEqual(["dfcIcon:compass"]);
  });

  it("the tab prints empty when the back prints no P/T (owner decision Q7), and nothing at all without a back face", () => {
    const aura = preview({ backFace: { ...BACK, card_type: "enchantment", subtypes: ["Aura"], power: undefined, toughness: undefined } });
    expect(aura.front.querySelector('[data-testid="reverse-pt"]')).toBeNull();
    expect(overlayKeys(aura.front)).toEqual(["dfcIcon:default"]);
    const alone = preview({ backFace: null });
    expect(alone.front.querySelector('[data-testid="reverse-pt"]')).toBeNull();
    // No family without a back face: the master's own ▲ stands.
    expect(overlayKeys(alone.front)).toEqual([]);
  });

  it("the back face flips on its own BODY and colour: no cost, the dot before an indented type line, the dark plate", () => {
    const { back } = preview();
    expect(back).not.toBeNull();
    const dot = back!.querySelector<HTMLElement>('[data-testid="color-indicator"]');
    expect(dot).not.toBeNull();
    expect(dot!.querySelectorAll("path")).toHaveLength(1);
    expect(dot!.querySelector("path")?.getAttribute("fill")).toBe("#0e68ab");
    const box = colorIndicatorBox();
    expect(dot!.getAttribute("style")).toContain(`left:${box.leftPct}%`);
    // The type line starts at 13.4 %W while the dot draws (M15's 8.5 otherwise).
    const typeBand = back!.querySelector<HTMLElement>('[data-testid="type-line"]')?.closest("[style*='left:']");
    expect(typeBand?.getAttribute("style")).toContain(`left:${COLOR_INDICATOR.typeLeftPct}%`);
    // No mana cost on the back (the back body hides it) — the front has its pip.
    expect(back!.querySelector(".ms-cost")).toBeNull();
    expect(preview().front.querySelector(".ms-cost")).not.toBeNull();
    // The dark plate with white digits.
    expect(back!.innerHTML).toContain("m15dfcback/pt/u");
    expect(back!.innerHTML).toContain("3/2");
    expect(getFrameProfile("m15dfcback").hideCost).toBe(true);
  });

  it("the 2016–22 back draws the family's back glyph in its left well; a gold back of two colours splits the dot", () => {
    const { back } = preview({ dfcIcon: "sunmoon", backFace: { ...BACK, frame_style: { template: "m15dfcbackleft" } } });
    expect(overlayKeys(back)).toEqual(["dfcIcon:moon"]);
    expect(back!.querySelector("[data-frame-overlay]")?.getAttribute("style")).toContain(`left:${DFC_ICON_RIDER.rect.leftPct}%`);
    const gold = preview({ colors: ["white", "blue"], backFace: { ...BACK, color_identity: ["white", "blue"] } });
    const paths = gold.back!.querySelectorAll<SVGPathElement>('[data-testid="color-indicator"] path');
    expect(Array.from(paths).map((p) => p.getAttribute("fill"))).toEqual(["#f9faf4", "#0e68ab"]);
    const three = preview({ colors: ["white", "blue", "black"], backFace: { ...BACK, color_identity: ["white", "blue", "black"] } });
    expect(three.back!.querySelectorAll('[data-testid="color-indicator"] path')).toHaveLength(3);
    // A colourless (artifact stand-in) back draws no dot and no indent.
    const grey = preview({ colors: ["colorless"], backFace: { ...BACK, color_identity: ["colorless"], supertype: "Artifact" } });
    expect(grey.back!.querySelector('[data-testid="color-indicator"]')).toBeNull();
  });

  it("a legacy back (no body) keeps today's flip on the front's template, with no dot and no rider", () => {
    const legacy: CardBackFace = { ...BACK };
    delete legacy.frame_style;
    delete legacy.color_identity;
    const { back, front } = preview({ template: "m15", backFace: legacy });
    expect(back).not.toBeNull();
    expect(back!.querySelector('[data-testid="color-indicator"]')).toBeNull();
    expect(overlayKeys(back)).toEqual([]);
    expect(front.querySelector('[data-testid="reverse-pt"]')).toBeNull();
    expect(overlayKeys(front)).toEqual([]);
  });
});
