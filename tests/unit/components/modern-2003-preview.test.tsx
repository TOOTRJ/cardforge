// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { FOOTER_BRUSH_PATH, FOOTER_BRUSH_VIEWBOX } from "@/lib/cards/footer-brush";
import { footerInk, getFrameProfile } from "@/lib/cards/template-layout";
import { TYPE_FACES } from "@/lib/cards/type-faces";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// The 2003 frame in the PREVIEW (TODO 4.10b, layout v47) — the bake's twin,
// from the same profile data and the same shared layouts: dark ink with no
// shadow, the footer white on the black frame and on lands (4.23a's map),
// the brush before a mixed-case artist, the © slot from its left end (the
// mark on display, the footer text on a subscriber's clean preview), cost
// discs with the shadow straight down and flat pips in the rules text. The
// bake half: tests/unit/render/modern-2003-bake.test.tsx; in Chromium at 750
// and HD: the PR's parity run.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const COLOR: Record<string, ColorIdentity[]> = { w: ["white"], u: ["blue"], b: ["black"], r: ["red"], g: ["green"], c: ["colorless"], m: ["white", "blue"] };
const modern = getFrameProfile("modern");
const land = getFrameProfile("modernland");
/** "#rrggbb" or "rgb(r, g, b)" → [r, g, b]. */
function rgb(value: string): number[] {
  const m = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return m.slice(1).map((h) => parseInt(h, 16));
  return (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}
const unquoted = (family: string) => family.replace(/["']/g, "");
const text = (s: Element) => s.textContent?.replace(/\s+/g, " ") ?? "";

function renderOn(template: "modern" | "modernland", key: string, over: Partial<Parameters<typeof CardPreview>[0]> = {}) {
  const isLand = template === "modernland";
  const { container } = render(
    <CardPreview
      title="Ink Probe"
      cost={isLand ? null : "{X}{R}"}
      cardType={isLand ? "land" : "creature"}
      subtypes={isLand ? [] : ["Zombie"]}
      colorIdentity={COLOR[key]}
      rulesText="{T}: Add {R}."
      power={isLand ? null : "2"}
      toughness={isLand ? null : "2"}
      artistCredit="Douglas Shuler"
      frameStyle={{ template }}
      brandMark
      {...over}
    />,
  );
  const spans = [...container.querySelectorAll("span")];
  return {
    container,
    footer: container.querySelector<HTMLElement>('[data-testid="card-footer"]')!,
    brush: container.querySelector<SVGSVGElement>("[data-footer-brush]"),
    name: spans.find((s) => text(s) === "Ink Probe") as HTMLElement,
    pt: spans.find((s) => s.textContent === "2/2") as HTMLElement | undefined,
    mark: container.querySelector<HTMLElement>("[data-brand-mark]"),
    slotText: container.querySelector<HTMLElement>('[data-copyright-slot="text"]'),
    pips: [...container.querySelectorAll<HTMLElement>(".ms.ms-cost")],
  };
}

describe("CardPreview — the 2003 footer (the same footerInk and © slot as the bake)", () => {
  it.each(Object.keys(COLOR))("modern %s: the bare credit in mixed case after the brush, in the master's ink, no shadow", (key) => {
    const { footer, brush } = renderOn("modern", key);
    const ink = footerInk(modern.footer!, key, modern);
    expect(rgb(footer.style.color)).toEqual(rgb(ink.colorHex));
    expect(ink.colorHex).toBe(key === "b" ? "#ffffff" : modern.footer!.colorHex);
    expect(footer.style.textShadow).toBe("");
    expect(footer.style.textTransform).toBe("none");
    expect(text(footer)).toBe("Douglas Shuler");
    expect(unquoted(footer.style.fontFamily)).toBe(unquoted(TYPE_FACES.display.previewFamily));
    // The brush: our own path at the profile's rect, in the same ink.
    expect(brush).not.toBeNull();
    expect(brush!.getAttribute("viewBox")).toBe(FOOTER_BRUSH_VIEWBOX);
    expect(brush!.getAttribute("preserveAspectRatio")).toBe("none");
    const path = brush!.querySelector("path")!;
    expect(path.getAttribute("d")).toBe(FOOTER_BRUSH_PATH);
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(rgb(path.getAttribute("fill")!)).toEqual(rgb(ink.colorHex));
    const r = modern.footerBrush!.rect;
    expect(brush!.style.left).toBe(`${r.leftPct}%`);
    expect(brush!.style.top).toBe(`${r.topPct}%`);
    expect(brush!.style.width).toBe(`${r.widthPct}%`);
    expect(brush!.style.height).toBe(`${r.heightPct}%`);
  });

  it.each(Object.keys(COLOR))("modernland %s: white on the one brown land frame — the artist and the brush", (key) => {
    const { footer, brush } = renderOn("modernland", key);
    expect(rgb(footer.style.color)).toEqual([255, 255, 255]);
    expect(rgb(brush!.querySelector("path")!.getAttribute("fill")!)).toEqual([255, 255, 255]);
    expect(footerInk(land.footer!, key, land).colorHex).toBe("#ffffff");
  });

  it("DISPLAY: the mark sits in the © slot from its left end — dark and flat where the print's line is dark, the standard white on the black frame and on lands — and not on the border", () => {
    for (const [template, key] of [["modern", "w"], ["modern", "g"], ["modern", "b"], ["modernland", "c"]] as const) {
      const profile = template === "modern" ? modern : land;
      const { mark, container } = renderOn(template, key);
      const layout = copyrightSlotLayout(profile, key, { kind: "display" })!;
      expect(layout.kind).toBe("brand");
      if (layout.kind !== "brand") continue;
      expect(mark, `${template}/${key}`).not.toBeNull();
      expect(mark!.getAttribute("data-brand-mark")).toBe("copyright");
      expect(container.querySelectorAll("[data-brand-mark]")).toHaveLength(1);
      expect(mark!.style.right).toBe(`${100 - layout.anchor.rightPct}%`);
      const flat = layout.ink.kind === "flat";
      expect(flat, `${template}/${key}`).toBe(template === "modern" && key !== "b");
      if (flat) {
        expect(rgb(mark!.style.color)).toEqual(rgb(profile.copyrightSlot!.colorHex));
        expect(mark!.style.textShadow).toBe("");
      } else {
        expect(mark!.style.textShadow).not.toBe("");
      }
      cleanup();
    }
  });

  it("a subscriber's CLEAN preview: the footer text prints in the © slot — never at the end of the artist line", () => {
    const { slotText, footer, mark } = renderOn("modern", "w", { brandMark: false, footerWatermark: "Printed for the kitchen table" });
    const layout = copyrightSlotLayout(modern, "w", { kind: "download", footerText: "Printed for the kitchen table" })!;
    expect(layout.kind).toBe("text");
    if (layout.kind !== "text") return;
    expect(mark).toBeNull();
    expect(slotText).not.toBeNull();
    expect(text(slotText!)).toBe("Printed for the kitchen table");
    expect(slotText!.style.left).toBe(`${layout.xPct}%`);
    expect(layout.xPct).toBe(modern.copyrightSlot!.startPct);
    expect(unquoted(slotText!.style.fontFamily)).toBe(unquoted(TYPE_FACES.body.previewFamily));
    // Line 1 is the artist alone.
    expect(text(footer)).toBe("Douglas Shuler");
    expect(footer.querySelectorAll("span")).toHaveLength(1);
  });
});

describe('CardPreview — symbolStyle "2003"', () => {
  it("the cost discs carry the shadow straight down on the glyph itself (no mana-font shadow class); the rules pips are flat; {T} is the modern arrow", () => {
    const { pips } = renderOn("modern", "r");
    expect(pips.map((el) => el.className)).toEqual(["ms ms-cost ms-x", "ms ms-cost ms-r", "ms ms-cost ms-tap", "ms ms-cost ms-r"]);
    // The two cost pips…
    // (The bake's one layer in em of the pip's glyph — previewDiscShadowCss:
    // 6 px under a 68 px disc whose glyph is 50 px, nothing to the left.)
    for (const pip of pips.slice(0, 2)) expect(pip.style.boxShadow.replace(/\s+/g, " ")).toBe("0.0000em 0.1200em 0 #000");
    // …and the two in the rules text.
    for (const pip of pips.slice(2)) expect(pip.style.boxShadow).toBe("");
  });

  it("the name, the type line and the P/T are the frame's dark ink with no shadow", () => {
    const { name, pt } = renderOn("modern", "b");
    expect(rgb(name.style.color || getComputedStyle(name).color)).toEqual(rgb(modern.title.colorHex));
    expect(name.style.textShadow).toBe("");
    expect(pt).toBeDefined();
    expect(pt!.style.textShadow).toBe("");
  });
});
