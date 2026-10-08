// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { MDFC_FLIPSIDE_BACK, MDFC_FLIPSIDE_FRONT } from "@/lib/cards/template-layout";
import type { CardBackFace } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview half of TODO 5.1b's modal bodies: CardPreview draws what the
// bake draws (tests/unit/render/mdfc-bodies-bake.test.tsx measures the
// bake) — on BOTH faces the flipside strip's two texts from the other face
// (the word left-aligned in the display face, the line's inline-pip run
// right-aligned), white on the front and dark on the back; the back flips
// on its own body with its cost, no dot and no rider; the land pair with no
// cost. Read from the server markup.
// ---------------------------------------------------------------------------

const BACK: CardBackFace = {
  title: "Soporific Springs",
  cost: "",
  card_type: "land",
  subtypes: [],
  rules_text: "As Soporific Springs enters, you may pay 3 life. If you don't, it enters tapped.\n{T}: Add {U}.",
  frame_style: { template: "m15mdfclandback" },
  color_identity: ["blue"],
};

function preview(over: { backFace?: CardBackFace | null; template?: "m15mdfcfront" | "m15mdfclandfront" | "m15"; cardType?: "instant" | "land" | "creature"; cost?: string | null; rulesText?: string } = {}) {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Sink into Stupor"
      cardType={over.cardType ?? "instant"}
      supertype={null}
      subtypes={[]}
      colorIdentity={["blue"]}
      rulesText={over.rulesText ?? "Return target spell to its owner's hand."}
      cost={over.cost === undefined ? "{2}{U}" : over.cost}
      power={null}
      toughness={null}
      rarity="uncommon"
      frameStyle={{ template: over.template ?? "m15mdfcfront" }}
      backFace={over.backFace === undefined ? BACK : over.backFace}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  const faces = Array.from(doc.querySelectorAll<HTMLElement>("[aria-hidden][style*='backface-visibility']"));
  return { html, doc, front: faces[0] ?? doc.body, back: faces[1] ?? null };
}

const word = (root: Element | null) => root?.querySelector<HTMLElement>('[data-testid="flipside-word"]') ?? null;
const line = (root: Element | null) => root?.querySelector<HTMLElement>('[data-testid="flipside-line"]') ?? null;

describe("CardPreview — the modal bodies (TODO 5.1b)", () => {
  it("the front's strip: the back's type word in white from the left, its mana line's pips right-aligned", () => {
    const { front } = preview();
    const w = word(front)!;
    expect(w.textContent).toBe("Land");
    expect(w.getAttribute("style")).toContain(`color:${MDFC_FLIPSIDE_FRONT.word.colorHex}`);
    expect(w.getAttribute("style")).toContain("justify-content:flex-start");
    expect(w.getAttribute("style")).toContain(`left:${MDFC_FLIPSIDE_FRONT.word.rect.leftPct}%`);
    const l = line(front)!;
    expect(l.getAttribute("style")).toContain("justify-content:flex-end");
    expect(l.getAttribute("style")).toContain(`color:${MDFC_FLIPSIDE_FRONT.line.colorHex}`);
    // "{T}: Add {U}." — the tap and the blue pip as mana-font discs, the words
    // as ceiled boxes.
    const pips = Array.from(l.querySelectorAll("i.ms")).map((i) => i.className);
    expect(pips).toEqual([expect.stringMatching(/ms-tap/), expect.stringMatching(/ms-u/)]);
    expect(l.textContent).toContain("Add");
    expect(l.textContent).toContain(":");
    // No reverse P/T, no rider, no dot on a modal front.
    expect(front.querySelector('[data-testid="reverse-pt"]')).toBeNull();
    expect(front.querySelectorAll("[data-frame-overlay]")).toHaveLength(0);
    expect(front.querySelector('[data-testid="color-indicator"]')).toBeNull();
  });

  it("the back flips on its own body: the front's word and cost in DARK ink, its own cost kept, no dot", () => {
    const spell: CardBackFace = { ...BACK, title: "Echoing Equation", cost: "{3}{U}{U}", card_type: "sorcery", rules_text: "Choose target creature you control.", frame_style: { template: "m15mdfcback" } };
    const { back } = preview({ backFace: spell });
    expect(back).not.toBeNull();
    const w = word(back)!;
    expect(w.textContent).toBe("Instant");
    expect(w.getAttribute("style")).toContain(`color:${MDFC_FLIPSIDE_BACK.word.colorHex}`);
    const l = line(back)!;
    expect(l.getAttribute("style")).toContain(`color:${MDFC_FLIPSIDE_BACK.line.colorHex}`);
    expect(Array.from(l.querySelectorAll("i.ms")).map((i) => i.className)).toEqual([expect.stringMatching(/ms-2/), expect.stringMatching(/ms-u/)]);
    // The back's own cost in its name bar: three pips ({3}{U}{U}) outside the strip.
    const costPips = Array.from(back!.querySelectorAll("[data-pip]")).filter((i) => !l.contains(i));
    expect(costPips.length).toBeGreaterThanOrEqual(3);
    expect(back!.querySelector('[data-testid="color-indicator"]')).toBeNull();
    expect(back!.querySelectorAll("[data-frame-overlay]")).toHaveLength(0);
    expect(back!.innerHTML).toContain("m15mdfcback/");
  });

  it("the land pair: the pathway's front and back each carry the other's mana line, no cost on either", () => {
    const { front, back } = preview({ template: "m15mdfclandfront", cardType: "land", cost: null, rulesText: "{T}: Add {U}.", backFace: { ...BACK, title: "Murkwater Pathway", rules_text: "{T}: Add {B}.", color_identity: ["black"] } });
    expect(word(front)?.textContent).toBe("Land");
    expect(Array.from(line(front)!.querySelectorAll("i.ms")).map((i) => i.className)).toEqual([expect.stringMatching(/ms-tap/), expect.stringMatching(/ms-b/)]);
    expect(word(back)?.textContent).toBe("Land");
    expect(back!.innerHTML).toContain("m15mdfclandback/");
    // No cost pips outside the strips and the rules boxes (the mana
    // ability's own pips print in the box).
    for (const face of [front, back!]) {
      const l = line(face)!;
      const box = face.querySelector('[data-testid="rules-box"]');
      expect(Array.from(face.querySelectorAll("[data-pip]")).filter((i) => !l.contains(i) && !box?.contains(i))).toHaveLength(0);
    }
  });

  it("the word alone when the other face has no cost and no mana line; nothing without a back face; a transform front draws no strip", () => {
    const bare = preview({ backFace: { ...BACK, card_type: "creature", subtypes: ["Human", "Wizard"], rules_text: "Flying", power: "1", toughness: "1", frame_style: { template: "m15mdfcback" } } });
    expect(word(bare.front)?.textContent).toBe("Wizard");
    expect(line(bare.front)).toBeNull();
    const alone = preview({ backFace: null });
    expect(word(alone.front)).toBeNull();
    expect(line(alone.front)).toBeNull();
    const legacy = preview({ template: "m15" });
    expect(word(legacy.front)).toBeNull();
  });
});
