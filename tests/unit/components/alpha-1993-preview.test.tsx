// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { CardPip } from "@/components/cards/mana-cost-glyphs";
import { copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { costRowHdPx } from "@/lib/cards/render-tiers";
import { SYMBOL_STYLES } from "@/lib/cards/symbol-style";
import { footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { TYPE_FACES } from "@/lib/cards/type-faces";
import { ALPHA_ARTIST_SIZE_PCT, ALPHA_COST_DISC_PCT, ALPHA_PT_SIZE_PCT, ALPHA_TYPE_SIZE_PCT } from "@/lib/cards/typography";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// The 1993 frame in the PREVIEW (TODO 4.10c, layout v48) — the bake's twin,
// from the same profile data and the same shared layouts: the type line, the
// printed `Illus.` credit and the P/T in MPlantin at the prints' sizes, the
// © slot on the border (the mark on display, the footer text on a
// subscriber's clean preview), flat discs 12 px apart, the five colour
// symbols as the style's images and the tilted-T tap. The bake half:
// tests/unit/render/alpha-1993-bake.test.tsx; in Chromium at 750 and HD: the
// PR's parity run.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const COLOR: Record<string, ColorIdentity[]> = { w: ["white"], u: ["blue"], b: ["black"], r: ["red"], g: ["green"], c: ["colorless"], m: ["white", "blue"] };
const alpha = getFrameProfile("agclassic");
/** "#rrggbb" or "rgb(r, g, b)" → [r, g, b]. */
function rgb(value: string): number[] {
  const m = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return m.slice(1).map((h) => parseInt(h, 16));
  return (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}
const unquoted = (family: string) => family.replace(/["']/g, "");
const text = (s: Element) => s.textContent?.replace(/\s+/g, " ") ?? "";
/** Sizes are read off the SERVER markup: happy-dom drops the units it
 *  doesn't know (cqw among them) from an element's style. `element` matches
 *  the element's opening tag and captures its style attribute. */
function hdPxOf(element: RegExp, prop: string, key = "r"): number {
  const html = renderToStaticMarkup(
    <CardPreview title="Ink Probe" cost="{X}{R}{R}" cardType="creature" subtypes={["Zombie"]} colorIdentity={COLOR[key]} rulesText="{T}: Add {G}." power="2" toughness="2" artistCredit="Douglas Schuler" frameStyle={{ template: "agclassic" }} brandMark />,
  );
  const style = element.exec(html)?.[1];
  if (style === undefined) throw new Error(`no element matches ${String(element)}`);
  const value = new RegExp(`(?:^|;)${prop}:([^;]+)`).exec(style)?.[1] ?? "";
  expect(value.endsWith("cqw"), `${prop}: ${value}`).toBe(true);
  return (Number.parseFloat(value) * 1500) / 100;
}
const FOOTER_TAG = /<div data-testid="card-footer" style="([^"]*)"/;
const TYPE_TAG = /<div style="([^"]*)"><span data-testid="type-line"/;
const PT_TAG = /<span class="relative" style="([^"]*)">2\/2</;
const COST_TAG = /<span[^>]*aria-label="Cost [^"]*"[^>]*style="([^"]*)"/;

function renderOn(template: "agclassic" | "alphaland", key: string, over: Partial<Parameters<typeof CardPreview>[0]> = {}) {
  const isLand = template === "alphaland";
  const { container } = render(
    <CardPreview
      title="Ink Probe"
      cost={isLand ? null : "{X}{R}{R}"}
      cardType={isLand ? "land" : "creature"}
      subtypes={isLand ? [] : ["Zombie"]}
      colorIdentity={COLOR[key]}
      rulesText="{T}: Add {G}."
      power={isLand ? null : "2"}
      toughness={isLand ? null : "2"}
      artistCredit="Douglas Schuler"
      frameStyle={{ template }}
      brandMark
      {...over}
    />,
  );
  const spans = [...container.querySelectorAll("span")];
  return {
    container,
    footer: container.querySelector<HTMLElement>('[data-testid="card-footer"]')!,
    type: spans.find((s) => text(s).startsWith(isLand ? "Land" : "Creature — Zombie")) as HTMLElement,
    pt: spans.find((s) => s.textContent === "2/2") as HTMLElement | undefined,
    mark: container.querySelector<HTMLElement>("[data-brand-mark]"),
    slotText: container.querySelector<HTMLElement>('[data-copyright-slot="text"]'),
    cost: container.querySelector<HTMLElement>('[role="img"][aria-label^="Cost"]'),
    pips: [...container.querySelectorAll<HTMLElement>("[data-pip]")],
  };
}

describe("CardPreview — the 1993 lettering", () => {
  it("the credit is the printed `Illus. <artist>`, mixed case, in MPlantin at 70 px — in the bake's ink on every key", () => {
    for (const key of Object.keys(COLOR)) {
      const { footer } = renderOn("agclassic", key);
      expect(text(footer), key).toBe("Illus. Douglas Schuler");
      expect(footer.style.textTransform).toBe("none");
      expect(unquoted(footer.style.fontFamily)).toBe(unquoted(TYPE_FACES.body.previewFamily));
      expect(hdPxOf(FOOTER_TAG, "font-size", key)).toBeCloseTo(ALPHA_ARTIST_SIZE_PCT * 1500, 1);
      expect(footer.style.justifyContent).toBe("space-between");
      const ink = footerInk(alpha.footer!, key);
      expect(rgb(footer.style.color), key).toEqual(rgb(ink.colorHex));
      expect(footer.style.textShadow.includes("0.035em"), key).toBe(key !== "w");
      cleanup();
    }
  });

  it("a card with no artist draws NO footer line — no `Illus.`, no `Unknown` — on both templates; the P/T and the mark stay (owner, round 44)", () => {
    for (const template of ["agclassic", "alphaland"] as const) {
      for (const none of [null, "", "   "]) {
        const { container, mark } = renderOn(template, template === "alphaland" ? "c" : "w", { artistCredit: none });
        expect(container.querySelector('[data-testid="card-footer"]'), template).toBeNull();
        expect(container.textContent).not.toMatch(/Illus|Unknown/);
        expect(mark).not.toBeNull();
        cleanup();
      }
    }
    // Another frame still says so behind its prefix.
    const { container } = render(<CardPreview title="Ink Probe" cardType="creature" colorIdentity={["red"]} frameStyle={{ template: "m15" }} artistCredit={null} />);
    expect(container.querySelector('[data-testid="card-footer"]')?.textContent).toMatch(/Unknown/);
  });

  it("the name and the type line start where the prints start them: the bake's rects, 104 px and 150 px (owner, round 44)", () => {
    const { type, container } = renderOn("agclassic", "w");
    const name = [...container.querySelectorAll("span")].find((s) => text(s) === "Ink Probe") as HTMLElement;
    const html = container.innerHTML;
    expect(html).toContain(`left: ${alpha.title.rect.leftPct}%`);
    expect(html).toContain(`left: ${alpha.type.rect.leftPct}%`);
    expect((alpha.title.rect.leftPct / 100) * 1500).toBeCloseTo(104, 6);
    expect((alpha.type.rect.leftPct / 100) * 1500).toBeCloseTo(150, 6);
    expect(name).toBeDefined();
    expect(type).toBeDefined();
  });

  it("the type line and the P/T are MPlantin at the prints' sizes; the name stays Beleren", () => {
    const { type, pt, container } = renderOn("agclassic", "r");
    const band = type.parentElement as HTMLElement;
    expect(unquoted(band.style.fontFamily)).toBe(unquoted(TYPE_FACES.body.previewFamily));
    expect(hdPxOf(TYPE_TAG, "font-size")).toBeCloseTo(ALPHA_TYPE_SIZE_PCT * 1500, 1);
    expect(pt).toBeDefined();
    expect(unquoted(pt!.style.fontFamily)).toBe(unquoted(TYPE_FACES.body.previewFamily));
    expect(hdPxOf(PT_TAG, "font-size")).toBeCloseTo(ALPHA_PT_SIZE_PCT * 1500, 1);
    expect(rgb(pt!.style.color)).toEqual(rgb(slotInk(alpha.pt!, "r").colorHex));
    expect(pt!.style.textShadow).toContain("0.035em");
    // Set against the rect's right end.
    expect((pt!.parentElement as HTMLElement).style.justifyContent).toBe("flex-end");
    const name = [...container.querySelectorAll("span")].find((s) => text(s) === "Ink Probe") as HTMLElement;
    expect(unquoted((name.parentElement as HTMLElement).style.fontFamily)).toBe(unquoted(TYPE_FACES.display.previewFamily));
  });
});

describe("CardPreview — the © slot on the border", () => {
  it("display: the mark through the slot, in its standard white on every key — and no custom text on the credit line", () => {
    for (const key of Object.keys(COLOR)) {
      const { mark, footer, slotText } = renderOn("agclassic", key);
      expect(mark, key).not.toBeNull();
      expect(mark!.dataset.brandMark).toBe("copyright");
      expect(mark!.style.color.replace(/\s+/g, "")).toBe("rgba(255,255,255,0.82)");
      expect(slotText).toBeNull();
      expect(footer.children).toHaveLength(1);
      expect(copyrightSlotLayout(alpha, key, { kind: "display" })).toMatchObject({ ink: { kind: "light" } });
      cleanup();
    }
  });

  it("a clean preview: the footer text in the slot (MPlantin, the strip's silver), never beside the credit; the mark is gone", () => {
    const { mark, slotText, footer } = renderOn("agclassic", "w", { brandMark: false, footerWatermark: "Proxy Press" });
    expect(mark).toBeNull();
    expect(slotText).not.toBeNull();
    expect(text(slotText!)).toBe("Proxy Press");
    expect(unquoted(slotText!.style.fontFamily)).toBe(unquoted(TYPE_FACES.body.previewFamily));
    expect(rgb(slotText!.style.color)).toEqual([0xb0, 0xb4, 0xb4]);
    expect(text(footer)).toBe("Illus. Douglas Schuler");
    cleanup();
    const land = renderOn("alphaland", "g", { brandMark: false, footerWatermark: "Proxy Press" });
    expect(text(land.slotText!)).toBe("Proxy Press");
  });
});

describe('CardPreview — symbolStyle "original"', () => {
  it("the cost row: the bake's 72 px discs with the style's 12 px gap", () => {
    const { cost } = renderOn("agclassic", "r");
    const { discPx, gapPx } = costRowHdPx(ALPHA_COST_DISC_PCT, "portrait", SYMBOL_STYLES.original);
    expect([discPx, gapPx]).toEqual([72, 12]);
    expect(cost).not.toBeNull();
    expect(hdPxOf(COST_TAG, "font-size")).toBeCloseTo(72, 2);
    expect(hdPxOf(COST_TAG, "column-gap")).toBeCloseTo(12, 2);
  });

  it("colour pips are the style's IMAGES (flat, one disc), X and the tilted-T tap the font's glyphs — in the cost and the rules text", () => {
    const { pips } = renderOn("agclassic", "r");
    expect(pips.map((p) => p.dataset.pip)).toEqual(["x", "r", "r", "tap-3ed", "g"]);
    for (const pip of pips) {
      const image = pip.querySelector("img");
      const isColour = ["r", "g"].includes(pip.dataset.pip!);
      expect(Boolean(image), pip.dataset.pip).toBe(isColour);
      // Flat everywhere: no shadow on the disc or the image.
      expect(pip.style.boxShadow).toBe("");
      if (image) {
        expect(image.getAttribute("src")).toMatch(new RegExp(`/manaoriginal/${pip.dataset.pip}(\\.[0-9a-f]{12})?\\.png$`));
        expect(image.style.borderRadius).toBe("50%");
        expect(image.style.boxShadow).toBe("");
        expect(image.style.width).toBe("1.3em");
        expect(pip.className).not.toContain("ms");
      } else {
        expect(pip.className).toContain(`ms-${pip.dataset.pip}`);
        expect(pip.className).not.toContain("ms-cost");
      }
    }
  });

  it("an owner's custom pip still wins over the style's image (CardPip: the card filters the URLs it may draw — tests/unit/media/media-urls.test.ts)", () => {
    const own = render(<CardPip suffix="r" discPx={72} symbols={SYMBOL_STYLES.original} overrideSrc="https://example.test/own-r.png" />);
    expect([...own.container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["https://example.test/own-r.png"]);
    cleanup();
    const styled = render(<CardPip suffix="r" discPx={72} symbols={SYMBOL_STYLES.original} />);
    expect(styled.container.querySelector("img")!.getAttribute("src")).toMatch(/\/manaoriginal\/r(\.[0-9a-f]{12})?\.png$/);
    cleanup();
    // The same pip in a style without images is the font's glyph.
    const modern = render(<CardPip suffix="r" discPx={72} symbols={SYMBOL_STYLES.modern} />);
    expect(modern.container.querySelector("img")).toBeNull();
    expect(modern.container.querySelector(".ms-r")).not.toBeNull();
  });

  it("another frame keeps the font's symbols and M15's shadow", () => {
    const { container } = render(
      <CardPreview title="Probe" cost="{X}{R}" cardType="creature" colorIdentity={["red"]} rulesText="{T}: Add {R}." frameStyle={{ template: "tarkirdragon" }} />,
    );
    expect([...container.querySelectorAll("img")].some((img) => /manaoriginal/.test(img.getAttribute("src") ?? ""))).toBe(false);
    expect([...container.querySelectorAll<HTMLElement>("[data-pip]")].map((p) => p.dataset.pip)).toEqual(["x", "r", "tap", "r"]);
  });
});
