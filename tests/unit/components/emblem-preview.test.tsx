// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { mainRulesLayout, rulesDraw } from "@/lib/cards/rules-box";
import { EMBLEM_SCRYFALL_CROP_PX, getFrameProfile } from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The preview half of TODO 4.52's emblem frame: CardPreview draws what the
// bake draws (tests/unit/render/emblem-bake.test.tsx measures the bake) —
// "Emblem" on the type bar, the name and type text moved by the profile's
// print offsets (the same dy the bake rounds to whole px), ONE rules line
// centred by the layout's whole HD px of indent (the one layout, rulesDraw),
// two or more from the left, and no cost or P/T whatever the card holds.
// Read from the server markup (happy-dom drops the cqw lengths a live
// element's style would hold).
// ---------------------------------------------------------------------------

const EMBLEM = getFrameProfile("emblem");

function preview(
  over: {
    rulesText?: string;
    cost?: string | null;
    power?: string | null;
    subtypes?: string[];
    setIconCode?: string | null;
    cardType?: "emblem" | "creature";
  } = {},
) {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Kaito, Bane of Nightmares"
      cardType={over.cardType ?? "emblem"}
      setIconCode={over.setIconCode ?? null}
      supertype={null}
      subtypes={over.subtypes ?? []}
      colorIdentity={["colorless"]}
      rulesText={over.rulesText ?? "Ninjas you control get +1/+1."}
      cost={over.cost ?? null}
      power={over.power ?? null}
      toughness={over.power ?? null}
      rarity="common"
      frameStyle={{ template: "emblem" }}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    html,
    doc,
    lines: Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="rules-line"]')),
    typeLine: doc.querySelector<HTMLElement>('[data-testid="type-line"]'),
  };
}

const cqwOf = (value: number) => `${(value * 100).toFixed(3)}cqw`;
const hdCqw = (px: number) => `${((px / RULES_HD_WIDTH.portrait) * 100).toFixed(3)}cqw`;
const styleOf = (el: Element | null) => el?.getAttribute("style") ?? "";
const marginLeft = (el: Element) => /(?:^|;)\s*margin-left:\s*([^;]+)/.exec(styleOf(el))?.[1].trim() ?? "";

describe("CardPreview — the emblem frame (TODO 4.52)", () => {
  it("prints \"Emblem\" on the type bar, moved by the profile's print offset", () => {
    const { typeLine } = preview();
    expect(typeLine?.textContent).toBe("Emblem");
    expect(EMBLEM.type.dy).toBeCloseTo(-2 / 1500, 12);
    expect(styleOf(typeLine)).toContain(`translateY(${cqwOf(EMBLEM.type.dy!)})`);
    // The optional subtype of the 2014–19 / AFR style.
    // (displayLine sets a display line's spaces as no-break spaces.)
    expect(preview({ subtypes: ["Kaito"] }).typeLine?.textContent?.replace(/\s/g, " ")).toBe("Emblem — Kaito");
  });

  it("moves the name by its print offset too (3 px up at HD)", () => {
    const { doc } = preview();
    const name = Array.from(doc.querySelectorAll<HTMLElement>("span[title]")).find(
      (el) => el.getAttribute("title") === "Kaito, Bane of Nightmares",
    );
    expect(name).toBeDefined();
    expect(EMBLEM.title.dy).toBeCloseTo(-3 / 1500, 12);
    expect(styleOf(name!)).toContain(`translateY(${cqwOf(EMBLEM.title.dy!)})`);
  });

  it("indents ONE rules line by the layout's HD px — the bake's", () => {
    const { lines } = preview();
    expect(lines).toHaveLength(1);
    const layout = mainRulesLayout({ layout: EMBLEM, rulesText: "Ninjas you control get +1/+1.", aspect: 7 / 5, show: {} });
    const block = rulesDraw(layout, "hd").blocks[0];
    const indent = block.kind === "blank" ? 0 : block.indents[0];
    // TDSK #17 starts its ink at x 263: the box starts at 129 + 2.
    expect(indent).toBeGreaterThan(100);
    expect(marginLeft(lines[0])).toBe(hdCqw(indent));
  });

  it("draws two or more lines from the left, with no margin", () => {
    const { lines } = preview({
      rulesText: "Whenever a player casts a spell, you create a 2/1 blue Ninja creature token.",
    });
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(marginLeft(line)).toBe("");
  });

  // Owner evidence 2026-09-29: the set symbol told a screen reader "common
  // rarity" on an emblem, which has none (CR 114) — its stored "common"
  // only inks the symbol, as it still does.
  it("names no rarity on the set symbol — a Keyrune glyph or the default mark — while inking it the same", () => {
    const glyph = (html: string) => new DOMParser().parseFromString(html, "text/html").querySelector("i.ss");
    const emblem = glyph(preview({ setIconCode: "fdn" }).html);
    expect(emblem?.getAttribute("aria-label")).toBe("Set symbol");
    const creature = glyph(preview({ setIconCode: "fdn", cardType: "creature" }).html);
    expect(creature?.getAttribute("aria-label")).toBe("common rarity");
    expect(styleOf(emblem)).toMatch(/color:/);
    expect(/color:\s*([^;]+)/.exec(styleOf(emblem))?.[1]).toBe(/color:\s*([^;]+)/.exec(styleOf(creature))?.[1]);
    // The default mark names the set, never a rarity.
    const { html } = preview();
    expect(html).toContain('aria-label="PipGlyph set"');
    expect(html).not.toMatch(/rarity"/);
  });

  it("draws no cost and no P/T, whatever the card holds", () => {
    const { html } = preview({ cost: "{2}{U}{U}", power: "2" });
    expect(html).not.toMatch(/ms-cost/);
    expect(html).not.toContain("/pt/");
  });

  it("windows the art exactly where Scryfall's emblem art_crop printed it, at its printed size, and runs it under the spark's tail", () => {
    const px = (r: { topPct: number; leftPct: number; widthPct: number; heightPct: number }) => ({
      x0: (r.leftPct / 100) * 1500,
      y0: (r.topPct / 100) * 2100,
      x1: ((r.leftPct + r.widthPct) / 100) * 1500,
      y1: ((r.topPct + r.heightPct) / 100) * 2100,
    });
    const slot = px(EMBLEM.artSlot);
    const crop = EMBLEM_SCRYFALL_CROP_PX;
    // The crop's own box (603 × 576 at 72.5 / 124 of the 744 × 1040 scan),
    // at scale 1: an imported art_crop lands on its print pixel for pixel.
    // (Owner evidence 2026-09-29: grown up to 232 px, aspect kept, the box
    // drew the art 1.6–1.8 % larger than TFDN #24 / #25, TDSK #17, TBLB #30
    // and TFRA #16.)
    expect(crop.width / crop.height).toBeCloseTo(603 / 576, 2);
    expect(slot.x0).toBeCloseTo(crop.x, 6);
    expect(slot.y0).toBeCloseTo(crop.y, 6);
    expect(slot.x1).toBeCloseTo(crop.x + crop.width, 6);
    expect(slot.y1).toBeCloseTo(crop.y + crop.height, 6);
    // It covers the master's clear spark (215–1284 px across, down to the
    // type bar's outline at 1407): the top of its centre ray, above the
    // crop, keeps CC's shadow down to 250 px in the master (the recipe's
    // EMBLEM_RAY_SHADOW_RECUT; tests/unit/frames/emblem-master.test.ts).
    expect(slot.y0).toBeGreaterThan(250);
    expect(slot.y0).toBeLessThan(251);
    expect(slot.y1).toBeGreaterThanOrEqual(1407);
    expect(slot.x0).toBeLessThanOrEqual(215);
    expect(slot.x1).toBeGreaterThanOrEqual(1285);
    // CC's artBounds is the layer under the whole frame (the see-through
    // master's art-window rule, 7.6, holds it to every translucent pixel):
    // the tail (α 204) shows the art faintly down to 1896 px, as the prints
    // do.
    expect(EMBLEM.underFrameArt).toEqual({ rect: { topPct: 4.96, leftPct: 14.2, widthPct: 71.6, heightPct: 85.48 } });
    const under = px(EMBLEM.underFrameArt!.rect);
    expect(under.y0).toBeLessThanOrEqual(233);
    expect(under.x0).toBeLessThanOrEqual(731);
    expect(under.x1).toBeGreaterThanOrEqual(769);
    expect(under.y1).toBeGreaterThanOrEqual(1896);
  });
});
