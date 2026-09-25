// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity } from "@/types/card";
import {
  footerInk,
  getFrameProfile,
  slotInk,
  type FrameProfile,
  type StatSlot,
  type TextSlot,
} from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Printed Alpha cards letter the P/T and the "Illus." line in dark ink on the
// white frame and in embossed silver on every other colour (owner decision
// 2026-09-25). The ink is a per-frame-colour map on the slot, resolved by
// slotInk() / footerInk() — the preview half is pinned here, the bake half on
// real bakes in tests/unit/render/bake-followups.test.ts.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const COLOR: Record<string, ColorIdentity[]> = {
  w: ["white"],
  u: ["blue"],
  b: ["black"],
  r: ["red"],
  g: ["green"],
  c: ["colorless"],
  m: ["white", "blue"],
};

/** "#rrggbb" or "rgb(r, g, b)" → [r, g, b]. */
function rgb(value: string): number[] {
  const m = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return m.slice(1).map((h) => parseInt(h, 16));
  return (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}

function renderAlpha(template: "agclassic" | "alphaland", key: string) {
  const { container } = render(
    <CardPreview
      title="Ink Probe"
      cardType="creature"
      colorIdentity={COLOR[key]}
      power="4"
      toughness="4"
      artistCredit="Douglas Schuler"
      frameStyle={{ template }}
    />,
  );
  const spans = [...container.querySelectorAll("span")];
  const pt = spans.find((s) => s.textContent === "4/4") as HTMLElement;
  const footer = spans.find((s) => s.textContent === "Art: Douglas Schuler")?.parentElement as HTMLElement;
  return { pt, footer };
}

describe("slotInk / footerInk", () => {
  const stat: StatSlot = {
    rect: { topPct: 0, leftPct: 0, widthPct: 1, heightPct: 1 },
    sizePct: 0.04,
    colorHex: "#111111",
    shadowCss: "1px 1px 0 #000",
    inkByColorKey: { b: { colorHex: "#cccccc", shadowCss: "0.1em 0.1em 0 #000" }, r: { colorHex: "#dddddd" } },
  };

  it("an entry replaces colour AND shadow; a missing key keeps the slot's own", () => {
    expect(slotInk(stat, "b")).toEqual({ colorHex: "#cccccc", shadowCss: "0.1em 0.1em 0 #000" });
    expect(slotInk(stat, "r")).toEqual({ colorHex: "#dddddd", shadowCss: undefined });
    expect(slotInk(stat, "w")).toEqual({ colorHex: "#111111", shadowCss: "1px 1px 0 #000" });
    expect(slotInk({ ...stat, inkByColorKey: undefined }, "b")).toEqual({ colorHex: "#111111", shadowCss: "1px 1px 0 #000" });
  });

  it("the footer never draws its own shadowCss (FULLARTLAND declares one it has never shown)", () => {
    const footer: TextSlot = { ...stat, inkByColorKey: undefined } as TextSlot;
    expect(footerInk(footer, "b")).toEqual({ colorHex: "#111111", shadowCss: undefined });
    const fullartland = getFrameProfile("fullartland").footer!;
    expect(fullartland.shadowCss).toBeTruthy();
    expect(footerInk(fullartland, "r").shadowCss).toBeUndefined();
  });

  it("only the Alpha frame and its land twin carry an ink map", () => {
    // Every other template resolves to exactly the colour it had before.
    const keys = ["w", "u", "b", "r", "g", "c", "m"];
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p: FrameProfile = getFrameProfile(t);
      const inked = Boolean(p.pt?.inkByColorKey || p.footer?.inkByColorKey);
      expect(inked, t).toBe(t === "agclassic" || t === "alphaland");
      if (!inked) {
        for (const k of keys) {
          if (p.pt) expect(slotInk(p.pt, k)).toEqual({ colorHex: p.pt.colorHex, shadowCss: p.pt.shadowCss });
          if (p.footer) expect(footerInk(p.footer, k)).toEqual({ colorHex: p.footer.colorHex, shadowCss: undefined });
        }
      }
    }
  });
});

describe("CardPreview — Alpha ink (the same slotInk/footerInk as the bake)", () => {
  it.each(["w", "u", "b", "r", "g", "c", "m"])("agclassic %s", (key) => {
    const layout = getFrameProfile("agclassic");
    const { pt, footer } = renderAlpha("agclassic", key);
    const ptInk = slotInk(layout.pt!, key);
    const footInk = footerInk(layout.footer!, key);
    expect(rgb(pt.style.color)).toEqual(rgb(ptInk.colorHex));
    expect(rgb(footer.style.color)).toEqual(rgb(footInk.colorHex));
    const light = rgb(ptInk.colorHex).reduce((a, b) => a + b, 0) / 3 > 120;
    expect(light).toBe(key !== "w");
    if (light) {
      // The embossed dark lower-right edge, in em so it scales with the card.
      expect(pt.style.textShadow).toContain("0.035em");
      expect(footer.style.textShadow).toContain("0.035em");
    } else {
      expect(pt.style.textShadow).toBe("");
      expect(footer.style.textShadow).toBe("");
      expect(ptInk.colorHex).toBe(layout.pt!.colorHex);
    }
  });

  it("alphaland's brown land frame takes the same silver on every key, white included", () => {
    const layout = getFrameProfile("alphaland");
    const inks = new Set<string>();
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      const { pt, footer } = renderAlpha("alphaland", key);
      expect(rgb(pt.style.color)).toEqual(rgb(slotInk(layout.pt!, key).colorHex));
      expect(rgb(footer.style.color)).toEqual(rgb(footerInk(layout.footer!, key).colorHex));
      inks.add(slotInk(layout.pt!, key).colorHex);
      cleanup();
    }
    expect(inks.size).toBe(1);
  });
});
