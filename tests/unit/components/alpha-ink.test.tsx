// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { FRAME_TEMPLATE_VALUES, type ColorIdentity } from "@/types/card";
import {
  bandTextStyle,
  footerInk,
  getFrameProfile,
  slotInk,
  type FrameProfile,
  type StatSlot,
  type TextSlot,
} from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// Printed Alpha cards letter the name, type line, P/T and "Illus." line in
// dark ink on the white frame and in embossed silver on every other colour
// (owner decision 2026-09-25 for the P/T + "Illus." line; the name and type
// line followed with the colourless re-source, TODO 4.31). The ink is a
// per-frame-colour map on the slot, resolved by slotInk() / footerInk() /
// bandTextStyle() — the preview half is pinned here, the bake half on real
// bakes in tests/unit/render/bake-followups.test.ts.
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
      cost="{3}{B}"
      cardType="creature"
      subtypes={["Vampire"]}
      colorIdentity={COLOR[key]}
      power="4"
      toughness="4"
      artistCredit="Douglas Schuler"
      frameStyle={{ template }}
    />,
  );
  const spans = [...container.querySelectorAll("span")];
  const pt = spans.find((s) => s.textContent === "4/4") as HTMLElement;
  // The display lines' words are joined by no-break spaces (displayLine).
  const byText = (text: string) => spans.find((s) => s.textContent?.replace(/\s+/g, " ") === text);
  const footer = byText("Art: Douglas Schuler")?.parentElement as HTMLElement;
  const name = byText("Ink Probe") as HTMLElement;
  const type = byText("Creature — Vampire") as HTMLElement;
  const cost = container.querySelector('[aria-label="Cost {3}{B}"]') as HTMLElement | null;
  return { pt, footer, name, type, cost };
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

  it("bandTextStyle: an entry's colour and shadow for the text span, nothing without one", () => {
    const band: TextSlot = {
      rect: { topPct: 0, leftPct: 0, widthPct: 1, heightPct: 1 },
      sizePct: 0.04,
      colorHex: "#111111",
      shadowCss: "1px 1px 0 #000",
      inkByColorKey: { b: { colorHex: "#cccccc", shadowCss: "0.1em 0.1em 0 #000" }, r: { colorHex: "#dddddd" } },
    };
    expect(bandTextStyle(band, "b")).toEqual({ color: "#cccccc", textShadow: "0.1em 0.1em 0 #000" });
    expect(bandTextStyle(band, "r")).toEqual({ color: "#dddddd" });
    // A missing key adds nothing: the band's own colorHex + shadowCss stand.
    expect(bandTextStyle(band, "w")).toEqual({});
    expect(bandTextStyle({ ...band, inkByColorKey: undefined }, "b")).toEqual({});
  });

  it("only the Alpha frame and its land twin carry an ink map", () => {
    // Every other template resolves to exactly the colour it had before.
    const keys = ["w", "u", "b", "r", "g", "c", "m"];
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p: FrameProfile = getFrameProfile(t);
      const inked = Boolean(
        p.pt?.inkByColorKey || p.footer?.inkByColorKey || p.title.inkByColorKey || p.type.inkByColorKey,
      );
      expect(inked, t).toBe(t === "agclassic" || t === "alphaland");
      if (!inked) {
        for (const k of keys) {
          if (p.pt) expect(slotInk(p.pt, k)).toEqual({ colorHex: p.pt.colorHex, shadowCss: p.pt.shadowCss });
          if (p.footer) expect(footerInk(p.footer, k)).toEqual({ colorHex: p.footer.colorHex, shadowCss: undefined });
          expect(bandTextStyle(p.title, k), `${t} ${k} title`).toEqual({});
          expect(bandTextStyle(p.type, k), `${t} ${k} type`).toEqual({});
        }
      }
    }
  });

  it("agclassic: the name and type line take the P/T's ink on every printed colour; gold keeps dark", () => {
    const layout = getFrameProfile("agclassic");
    for (const k of ["u", "b", "r", "g", "c"]) {
      const ink = slotInk(layout.pt!, k);
      expect(bandTextStyle(layout.title, k), k).toEqual({ color: ink.colorHex, textShadow: ink.shadowCss });
      expect(bandTextStyle(layout.type, k), k).toEqual({ color: ink.colorHex, textShadow: ink.shadowCss });
    }
    // White prints dark; gold (never printed) keeps the dark ink on its
    // lighter title and type bands.
    for (const k of ["w", "m"]) {
      expect(bandTextStyle(layout.title, k), k).toEqual({});
      expect(bandTextStyle(layout.type, k), k).toEqual({});
    }
  });
});

describe("CardPreview — Alpha ink (the same slotInk/footerInk/bandTextStyle as the bake)", () => {
  it.each(["w", "u", "b", "r", "g", "c", "m"])("agclassic %s", (key) => {
    const layout = getFrameProfile("agclassic");
    const { pt, footer, name, type, cost } = renderAlpha("agclassic", key);
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
    // Name and type line: the span carries bandTextStyle's ink; without an
    // entry (w, m) the span adds nothing and the band's dark ink stands.
    for (const [span, slot] of [[name, layout.title], [type, layout.type]] as const) {
      const band = span.parentElement as HTMLElement;
      const want = bandTextStyle(slot, key);
      expect(rgb(band.style.color)).toEqual(rgb(slot.colorHex));
      if (want.color) {
        expect(rgb(span.style.color)).toEqual(rgb(want.color));
        expect(span.style.textShadow).toContain("0.035em");
      } else {
        expect(span.style.color).toBe("");
        expect(span.style.textShadow).toBe("");
      }
      // The emboss stays on the text: the band carries no shadow, so the
      // pips and the set symbol beside it inherit none.
      expect(band.style.textShadow).toBe("");
    }
    expect(cost).not.toBeNull();
    expect(name.parentElement!.contains(cost)).toBe(true);
    expect(cost!.style.textShadow).toBe("");
  });

  it("alphaland's brown land frame takes the same silver on every key, white included", () => {
    const layout = getFrameProfile("alphaland");
    const inks = new Set<string>();
    for (const key of ["w", "u", "b", "r", "g", "c", "m"]) {
      const { pt, footer, name, type } = renderAlpha("alphaland", key);
      expect(rgb(pt.style.color)).toEqual(rgb(slotInk(layout.pt!, key).colorHex));
      expect(rgb(footer.style.color)).toEqual(rgb(footerInk(layout.footer!, key).colorHex));
      // The land print letters its name and "Land" in the same silver.
      for (const span of [name, type]) {
        expect(rgb(span.style.color)).toEqual(rgb(slotInk(layout.pt!, key).colorHex));
        expect(span.style.textShadow).toContain("0.035em");
      }
      inks.add(slotInk(layout.pt!, key).colorHex);
      cleanup();
    }
    expect(inks.size).toBe(1);
  });
});
