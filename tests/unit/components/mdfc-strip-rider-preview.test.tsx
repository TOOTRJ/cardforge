// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { MDFC_STRIP_RIDER_BACK, MDFC_STRIP_RIDER_FRONT, MDFC_STRIP_RIDER_LAND_FRONT } from "@/lib/cards/template-layout";
import type { CardBackFace, ColorIdentity, FrameStyle } from "@/types/card";

// ---------------------------------------------------------------------------
// The preview half of TODO 5.1c (the bake half: tests/unit/render/
// mdfc-strip-rider-bake.test.tsx): CardPreview draws the OTHER face's strip
// piece in the overlay layer (z 5, under the strip's texts at z 22) from
// this face's own strip folder, at the slot's rect — only when the other
// face's key differs from the master's own (a mono card draws none); the
// crown's piece comes before it in DOM order (paint order for the layer's
// absolutely placed siblings). Read from the server markup.
// ---------------------------------------------------------------------------

const BACK: CardBackFace = {
  title: "Echoing Equation",
  cost: "{3}{U}{U}",
  card_type: "sorcery",
  subtypes: [],
  rules_text: "Choose target creature you control.",
  frame_style: { template: "m15mdfcback" },
  color_identity: ["blue"],
};

function preview(frameStyle: FrameStyle, over: { backFace?: CardBackFace | null; colors?: ColorIdentity[]; cost?: string | null; cardType?: "creature" | "land" | "sorcery"; supertype?: string | null; rulesText?: string } = {}) {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Augmenter Pugilist"
      cardType={over.cardType ?? "creature"}
      supertype={over.supertype ?? null}
      subtypes={["Troll", "Druid"]}
      colorIdentity={over.colors ?? ["green"]}
      rulesText={over.rulesText ?? "Trample"}
      cost={over.cost === undefined ? "{1}{G}{G}" : over.cost}
      power="3"
      toughness="3"
      rarity="rare"
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
const rider = (root: Element | null) => root?.querySelector<HTMLElement>('[data-frame-overlay="mdfcStrip"]') ?? null;
const layer = (root: Element | null) => root?.querySelector<HTMLElement>("[data-frame-overlays]") ?? null;
const word = (root: Element | null) => root?.querySelector<HTMLElement>('[data-testid="flipside-word"]') ?? null;

describe("CardPreview — the modal strip rider (TODO 5.1c)", () => {
  it("a green front // blue back: the front wears the blue piece from its own folder at the slot's rect, under the strip's texts; the back the green one", () => {
    const { front, back } = preview({ template: "m15mdfcfront" });
    expect(overlays(front)).toEqual(["mdfcStrip:u"]);
    const r = rider(front)!;
    expect(r.getAttribute("style")).toContain("m15mdfcfront/strip/u.webp");
    expect(r.getAttribute("style")).toContain(`left:${MDFC_STRIP_RIDER_FRONT.rect.leftPct}%`);
    expect(r.getAttribute("style")).toContain(`top:${MDFC_STRIP_RIDER_FRONT.rect.topPct}%`);
    expect(r.getAttribute("style")).toContain(`width:${MDFC_STRIP_RIDER_FRONT.rect.widthPct}%`);
    expect(r.getAttribute("style")).toContain("background-size:100% 100%");
    // The layer sits at the master's z (5), the strip's texts above it (22).
    expect(layer(front)!.getAttribute("style")).toContain("z-index:5");
    expect(word(front)!.getAttribute("style")).toContain("z-index:22");
    expect(word(front)!.textContent).toBe("Sorcery");
    expect(back).not.toBeNull();
    expect(overlays(back)).toEqual(["mdfcStrip:g"]);
    expect(rider(back)!.getAttribute("style")).toContain("m15mdfcback/strip/g.webp");
    expect(word(back)!.textContent).toBe("Druid");
  });

  it("a mono-colour card draws none on either face; nor a legacy back, a transform front or a plain frame", () => {
    const mono = preview({ template: "m15mdfcfront" }, { colors: ["blue"], cost: "{1}{U}{U}" });
    expect(overlays(mono.front)).toEqual([]);
    expect(overlays(mono.back)).toEqual([]);
    expect(word(mono.front)!.textContent).toBe("Sorcery"); // the texts still print
    const following = preview({ template: "m15mdfcfront" }, { backFace: { ...BACK, color_identity: undefined } });
    expect(overlays(following.front)).toEqual([]);
    // A legacy back (no body) under a plain front: no block on either face
    // (the flip is today's, on the front's template).
    const legacy = preview({ template: "m15" }, { backFace: { ...BACK, frame_style: undefined } });
    expect(overlays(legacy.front)).toEqual([]);
    expect(overlays(legacy.back)).toEqual([]);
    const transform = preview({ template: "m15dfcfront" }, { backFace: { ...BACK, cost: "", frame_style: { template: "m15dfcback" } } });
    expect(overlays(transform.front)).toEqual(["dfcIcon:default"]);
    expect(overlays(transform.back)).toEqual([]);
    const plain = preview({ template: "m15" });
    expect(overlays(plain.front)).toEqual([]);
  });

  it("the land pair: a pathway's faces each carry the other's colour; a two-colour land back is the land grey on a spell front", () => {
    const pathway = preview({ template: "m15mdfclandfront" }, { cardType: "land", cost: null, colors: ["green"], rulesText: "{T}: Add {G}.", backFace: { ...BACK, title: "Boulderloft Pathway", cost: "", card_type: "land", rules_text: "{T}: Add {W}.", frame_style: { template: "m15mdfclandback" }, color_identity: ["white"] } });
    expect(overlays(pathway.front)).toEqual(["mdfcStrip:w"]);
    expect(rider(pathway.front)!.getAttribute("style")).toContain("m15mdfclandfront/strip/w.webp");
    expect(rider(pathway.front)!.getAttribute("style")).toContain(`left:${MDFC_STRIP_RIDER_LAND_FRONT.rect.leftPct}%`);
    expect(overlays(pathway.back)).toEqual(["mdfcStrip:g"]);
    expect(rider(pathway.back)!.getAttribute("style")).toContain("m15mdfclandback/strip/g.webp");
    const morass = preview({ template: "m15mdfcfront", twoColor: true }, { cardType: "sorcery", cost: "{B/R}{B/R}", colors: ["black", "red"], backFace: { ...BACK, title: "Sanguine Morass", cost: "", card_type: "land", rules_text: "{T}: Add {B} or {R}.", frame_style: { template: "m15mdfclandback" }, color_identity: ["black", "red"] } });
    expect(morass.html).toContain("m15mdfcfront/br-h.");
    expect(overlays(morass.front)).toEqual(["mdfcStrip:l"]);
    expect(rider(morass.front)!.getAttribute("style")).toContain("m15mdfcfront/strip/l.webp");
    // The hybrid-dressed front's strip on the land back: the land grey, the land body's own c piece.
    expect(overlays(morass.back)).toEqual(["mdfcStrip:c"]);
    expect(rider(morass.back)!.getAttribute("style")).toContain("m15mdfclandback/strip/c.webp");
  });

  it("a Legendary pair card: the crown first, then the rider; a two-colour other face is gold; a split pair's own strip is gold already", () => {
    const valki = preview({ template: "m15mdfcfront", crown: true }, { supertype: "Legendary", colors: ["black"], cost: "{1}{B}", backFace: { ...BACK, title: "Tibalt, Cosmic Impostor", cost: "{5}{B}{R}", color_identity: ["black", "red"] } });
    expect(overlays(valki.front)).toEqual(["crown:b", "mdfcStrip:m"]);
    expect(rider(valki.front)!.getAttribute("style")).toContain("m15mdfcfront/strip/m.webp");
    expect(overlays(valki.back)).toEqual(["mdfcStrip:b"]);
    expect(rider(valki.back)!.getAttribute("style")).toContain(MDFC_STRIP_RIDER_BACK.assetPathTemplate.replace("{key}.png", "b.webp").replace("/frames/", ""));
    const pair = preview({ template: "m15mdfcfront", crown: true, twoColor: true }, { supertype: "Legendary", colors: ["white", "blue"], cost: "{2}{W}{U}", backFace: { ...BACK, cost: "{3}{W}{U}", supertype: "Legendary", color_identity: ["white", "blue"] } });
    expect(pair.html).toContain("m15mdfcfront/wu.");
    expect(overlays(pair.front)).toEqual(["crown:wu"]);
    expect(overlays(pair.back)).toEqual(["crown:wu"]);
  });
});
