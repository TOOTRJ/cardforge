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
// Printed Alpha cards letter the P/T and "Illus." line in dark ink on the
// white frame and in embossed silver on every other colour (owner decision
// 2026-09-25). The name and type line take that silver only where the dark
// ink all but vanishes — the black frame and the brown colourless ARTIFACT
// card ("a") — and stay dark on every other frame, the land frame included
// (owner decision 2026-09-25, TODO 4.31). The ink is a per-frame-master map
// on the slot, resolved by slotInk() / footerInk() / bandTextStyle() on
// frameMasterKey's master — the preview half is pinned here, the bake half
// on real bakes in tests/unit/render/bake-followups.test.ts.
// ---------------------------------------------------------------------------

afterEach(cleanup);

/** Frame master → a card that paints it. "a" (the Alpha artifact card) is a
 *  colourless Artifact Creature, so it keeps a P/T like the others. */
const MASTER_CARD: Record<string, { colorIdentity: ColorIdentity[]; supertype?: string }> = {
  w: { colorIdentity: ["white"] },
  u: { colorIdentity: ["blue"] },
  b: { colorIdentity: ["black"] },
  r: { colorIdentity: ["red"] },
  g: { colorIdentity: ["green"] },
  c: { colorIdentity: ["colorless"] },
  a: { colorIdentity: ["colorless"], supertype: "Artifact" },
  m: { colorIdentity: ["white", "blue"] },
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
      supertype={MASTER_CARD[key].supertype ?? null}
      subtypes={["Vampire"]}
      colorIdentity={MASTER_CARD[key].colorIdentity}
      power="4"
      toughness="4"
      artistCredit="Douglas Schuler"
      frameStyle={{ template }}
    />,
  );
  const spans = [...container.querySelectorAll("span")];
  const pt = spans.find((s) => s.textContent === "4/4") as HTMLElement;
  // The display lines' words are joined by no-break spaces (displayLine).
  const text = (s: Element) => s.textContent?.replace(/\s+/g, " ") ?? "";
  const footer = spans.find((s) => text(s) === "Art: Douglas Schuler")?.parentElement as HTMLElement;
  const name = spans.find((s) => text(s) === "Ink Probe") as HTMLElement;
  const type = spans.find((s) => text(s).endsWith("Creature — Vampire")) as HTMLElement;
  const cost = container.querySelector('[aria-label="Cost {3}{B}"]') as HTMLElement | null;
  const frame = container.querySelector<HTMLElement>("[data-frame-key]");
  return { pt, footer, name, type, cost, frame };
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

  it("the footer never draws its own shadowCss without the on-art opt-in", () => {
    const footer: TextSlot = { ...stat, inkByColorKey: undefined } as TextSlot;
    expect(footer.shadowCss).toBeTruthy();
    expect(footerInk(footer, "b")).toEqual({ colorHex: "#111111", shadowCss: undefined });
    expect(footerInk(footer, "b", getFrameProfile("m15"))).toEqual({ colorHex: "#111111", shadowCss: undefined });
    // The borderless full-art basic prints it on the art (4.39): outlined.
    const fullartland = getFrameProfile("fullartland");
    expect(footerInk(fullartland.footer!, "r", fullartland).shadowCss).toBeTruthy();
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
    // An entry without a shadow sets the colour only: the text keeps the
    // band's own shadowCss (inherited from the band), unlike slotInk.
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

  it("agclassic: the name and type line take the P/T's silver on the black frame and the artifact card only", () => {
    const layout = getFrameProfile("agclassic");
    for (const k of ["b", "a"]) {
      const ink = slotInk(layout.pt!, k);
      expect(bandTextStyle(layout.title, k), k).toEqual({ color: ink.colorHex, textShadow: ink.shadowCss });
      expect(bandTextStyle(layout.type, k), k).toEqual({ color: ink.colorHex, textShadow: ink.shadowCss });
    }
    // White prints dark; on our blue the silver read worse than the dark ink
    // and on red and green it changed little; gold and the grey colourless
    // card were never printed. All keep the band's dark ink.
    for (const k of ["w", "u", "r", "g", "c", "m"]) {
      expect(bandTextStyle(layout.title, k), k).toEqual({});
      expect(bandTextStyle(layout.type, k), k).toEqual({});
    }
  });

  it("agclassic: the P/T and artist line keep their silver; the artifact card takes the print's artifact grey", () => {
    const layout = getFrameProfile("agclassic");
    // The grey colourless card keeps the mid-tone silver it had (contrast
    // on the grey), the artifact card the print's darker artifact grey.
    expect(slotInk(layout.pt!, "c").colorHex).toBe("#b0b4b4");
    expect(slotInk(layout.pt!, "a").colorHex).toBe("#7e888c");
    expect(footerInk(layout.footer!, "a")).toEqual(slotInk(layout.pt!, "a"));
    expect(slotInk(layout.pt!, "a").shadowCss).toContain("0.035em");
  });
});

describe("CardPreview — Alpha ink (the same slotInk/footerInk/bandTextStyle as the bake)", () => {
  it.each(["w", "u", "b", "r", "g", "c", "a", "m"])("agclassic %s", (key) => {
    const layout = getFrameProfile("agclassic");
    const { pt, footer, name, type, cost, frame } = renderAlpha("agclassic", key);
    // The master painted: the colour's own, the artifact card for "a".
    expect(frame?.dataset.frameKey).toBe(key);
    expect(frame?.style.backgroundImage).toContain(`/frames/agclassic/${key}.webp`);
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
    // Name and type line: the span carries bandTextStyle's ink (b, a);
    // without an entry the span adds nothing and the band's dark ink stands.
    expect(Boolean(bandTextStyle(layout.title, key).color)).toBe(key === "b" || key === "a");
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

  it("alphaland's brown land frame takes the same silver P/T and artist line on every key, white included", () => {
    const layout = getFrameProfile("alphaland");
    const inks = new Set<string>();
    for (const key of ["w", "u", "b", "r", "g", "c", "a", "m"]) {
      const { pt, footer, name, type, frame } = renderAlpha("alphaland", key);
      // One land frame per colour: an artifact paints the colour's own.
      const colourKey = key === "a" ? "c" : key;
      expect(frame?.dataset.frameKey).toBe(colourKey);
      expect(rgb(pt.style.color)).toEqual(rgb(slotInk(layout.pt!, colourKey).colorHex));
      expect(rgb(footer.style.color)).toEqual(rgb(footerInk(layout.footer!, colourKey).colorHex));
      // The name and "Land" stay dark: the silver read no better on our
      // brown (owner decision 2026-09-25, silver name on the black frame
      // only) — the span adds nothing to the band's dark ink.
      for (const span of [name, type]) {
        expect(span.style.color).toBe("");
        expect(span.style.textShadow).toBe("");
        expect(rgb((span.parentElement as HTMLElement).style.color)).toEqual(rgb(layout.title.colorHex));
      }
      inks.add(slotInk(layout.pt!, colourKey).colorHex);
      cleanup();
    }
    expect(inks.size).toBe(1);
  });
});
