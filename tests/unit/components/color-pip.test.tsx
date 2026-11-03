// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  ColorPip,
  ColorPips,
  FrameKeyPip,
  MULTICOLOR_PIP_BACKGROUND,
  PIP_COLORS,
  pipColorName,
  pipColorOfIdentity,
  toPipColor,
  type PipColor,
} from "@/components/cards/color-pip";
import { CardPip } from "@/components/cards/mana-cost-glyphs";
import { MANA_GEM_BG, manaGemSpec } from "@/lib/cards/mana-gem";
import { symbolStyle } from "@/lib/cards/symbol-style";
import { COLOR_IDENTITY_VALUES } from "@/types/card";

// ---------------------------------------------------------------------------
// TODO UI1: a card's or deck's colours on the UI are the card's OWN pips —
// ONE component (components/cards/color-pip.tsx) over the renderer's
// CardPip / manaGemSpec, never a second drawing:
//   * every colour has its accessible name; a row is one image named by its
//     colours; a decorative pip has no name and no role;
//   * W U B R G C draw EXACTLY what CardPip draws for the card's symbol in
//     the default ("modern") style — {C} is the colourless diamond;
//   * multicolour is the split disc taken to five, in the discs' own fills.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const NAMES: Record<PipColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
  M: "Multicolor",
};

describe("ColorPip — names", () => {
  it.each(PIP_COLORS)("%s is an image named by its colour", (color) => {
    render(<ColorPip color={color} />);
    expect(screen.getByRole("img", { name: NAMES[color] })).toBeTruthy();
    expect(pipColorName(color)).toBe(NAMES[color]);
  });

  it("a decorative pip has no role and no name, and hides its drawing", () => {
    const { container } = render(<ColorPip color="W" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.getAttribute("aria-hidden")).toBe("true");
    expect(outer.getAttribute("aria-label")).toBeNull();
  });

  it("a row is ONE image named by its colours, its pips hidden", () => {
    render(<ColorPips colors={["W", "U", "M"]} />);
    const row = screen.getByRole("img", { name: "White, Blue, Multicolor" });
    expect(row.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByRole("img")).toHaveLength(1);
  });

  it("a row takes the surface's own words when given", () => {
    render(<ColorPips colors={["B", "G"]} label="Colors: Black, Green" />);
    expect(screen.getByRole("img", { name: "Colors: Black, Green" })).toBeTruthy();
  });

  it("an empty row draws nothing", () => {
    const { container } = render(<ColorPips colors={[]} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ColorPip — the renderer's own pip", () => {
  const modern = symbolStyle(undefined);

  it.each(["W", "U", "B", "R", "G", "C"] as const)("%s is CardPip's drawing of the card's symbol", (color) => {
    for (const size of [16, 18, 20] as const) {
      const suffix = color.toLowerCase();
      const ui = renderToStaticMarkup(<ColorPip color={color} size={size} />);
      const card = renderToStaticMarkup(<CardPip suffix={suffix} discPx={size} symbols={modern} />);
      expect(ui).toContain(card);
      // manaGemSpec's colour for the symbol, never a UI token of its own.
      const gem = manaGemSpec(suffix, size, modern);
      expect(gem.kind).toBe("solid");
      if (gem.kind === "solid") expect(card).toContain(`background-color:${gem.bg}`);
    }
  });

  it("colourless is the card's {C} — the colourless symbol on the grey disc", () => {
    const { container } = render(<ColorPip color="C" />);
    const pip = container.querySelector("[data-pip]") as HTMLElement;
    expect(pip.dataset.pip).toBe("c");
    expect(pip.className).toContain("ms-c");
  });

  it("never takes mana-font's off-card `.ms-cost` look", () => {
    const html = renderToStaticMarkup(
      <>
        {PIP_COLORS.map((c) => (
          <ColorPip key={c} color={c} />
        ))}
      </>,
    );
    expect(html).not.toContain("ms-cost");
  });

  it("multicolour is one disc of the five discs' own fills, WUBRG", () => {
    const { container } = render(<ColorPip color="M" size={20} />);
    const disc = container.querySelector('[data-pip="multicolor"]') as HTMLElement;
    expect(disc).toBeTruthy();
    const order = (["w", "u", "b", "r", "g"] as const).map((key) => MULTICOLOR_PIP_BACKGROUND.indexOf(MANA_GEM_BG[key]));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(MULTICOLOR_PIP_BACKGROUND.startsWith("conic-gradient(")).toBe(true);
    const outer = container.querySelector('[role="img"]') as HTMLElement;
    expect((outer.firstElementChild as HTMLElement).style.width).toBe("20px");
  });
});

describe("colour vocabularies", () => {
  it("every colour identity word has its pip and its name", () => {
    for (const identity of COLOR_IDENTITY_VALUES) {
      const color = pipColorOfIdentity(identity);
      expect(PIP_COLORS).toContain(color);
      expect(pipColorName(color).toLowerCase()).toBe(identity);
    }
  });

  it("a letter or frame key reads as its pip; anything else as none", () => {
    expect(toPipColor("w")).toBe("W");
    expect(toPipColor("m")).toBe("M");
    expect(toPipColor("C")).toBe("C");
    expect(toPipColor("a")).toBeNull();
    expect(toPipColor("wu")).toBeNull();
  });

  it("a frame key the pips don't name keeps the room, blank", () => {
    const { container } = render(<FrameKeyPip colorKey="a" size={16} />);
    const blank = container.firstElementChild as HTMLElement;
    expect(blank.getAttribute("aria-hidden")).toBe("true");
    expect(blank.querySelector("[data-pip]")).toBeNull();
    expect(blank.style.width).toBe("16px");
    cleanup();
    const { container: known } = render(<FrameKeyPip colorKey="g" />);
    expect(known.querySelector('[data-pip="g"]')).toBeTruthy();
  });
});
