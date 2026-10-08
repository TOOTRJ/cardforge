// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CardPreview } from "@/components/cards/card-preview";
import { copyrightSlotLayout } from "@/lib/cards/copyright-slot";
import { bandTextStyle, footerInk, getFrameProfile, slotInk } from "@/lib/cards/template-layout";
import { TYPE_FACES } from "@/lib/cards/type-faces";
import type { ColorIdentity } from "@/types/card";

// ---------------------------------------------------------------------------
// The 1997 frame in the PREVIEW (TODO 4.10a, layout v46) — the bake's twin,
// from the same profile data and the same shared layouts: white ink with
// the prints' hard shadow, the type line and the artist line in MPlantin,
// the centred `Illus.` footer, the © slot (the mark on display, the footer
// text on a subscriber's clean preview), flat discs and the 1997 tap. The
// bake half: tests/unit/render/retro-1997-bake.test.tsx; in Chromium at 750
// and HD: the PR's parity run.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const COLOR: Record<string, ColorIdentity[]> = { w: ["white"], u: ["blue"], b: ["black"], r: ["red"], g: ["green"], c: ["colorless"], m: ["white", "blue"] };
const retro = getFrameProfile("retro");
const land = getFrameProfile("retroland");
/** "#rrggbb" or "rgb(r, g, b)" → [r, g, b]. */
function rgb(value: string): number[] {
  const m = value.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (m) return m.slice(1).map((h) => parseInt(h, 16));
  return (value.match(/\d+/g) ?? []).slice(0, 3).map(Number);
}
/** A font-family list as the DOM may re-serialise it (quotes dropped). */
const unquoted = (family: string) => family.replace(/["']/g, "");
const text = (s: Element) => s.textContent?.replace(/\s+/g, " ") ?? "";

function renderOn(template: "retro" | "retroland", key: string, over: Partial<Parameters<typeof CardPreview>[0]> = {}) {
  const isLand = template === "retroland";
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
    name: spans.find((s) => text(s) === "Ink Probe") as HTMLElement,
    type: spans.find((s) => text(s).startsWith(isLand ? "Land" : "Creature — Zombie")) as HTMLElement,
    pt: spans.find((s) => s.textContent === "2/2") as HTMLElement | undefined,
    mark: container.querySelector<HTMLElement>("[data-brand-mark]"),
    slotText: container.querySelector<HTMLElement>('[data-copyright-slot="text"]'),
    pips: pipsOf(container),
  };
}

/** Each pip the card draws (CardPip marks its own with `data-pip`): the
 *  mana-font suffix it draws, and whether its disc has a shadow. */
function pipsOf(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-pip]")].map(
    (el) => `${el.getAttribute("data-pip")} ${el.style.boxShadow ? "shadow" : "flat"}`,
  );
}

describe("CardPreview — the 1997 ink (the same ink maps as the bake)", () => {
  it.each(Object.keys(COLOR))("retro %s: white with the prints' shadow on the name, the type line, the P/T and the artist line", (key) => {
    const { name, type, pt, footer } = renderOn("retro", key);
    const title = bandTextStyle(retro.title, key);
    expect(rgb(name.style.color)).toEqual([240, 243, 239]);
    expect(name.style.textShadow).toBe(title.textShadow);
    expect(rgb(type.style.color)).toEqual([240, 243, 239]);
    expect(type.style.textShadow).toBe(bandTextStyle(retro.type, key).textShadow);
    const ptInk = slotInk(retro.pt!, key);
    expect(rgb(pt!.style.color)).toEqual(rgb(ptInk.colorHex));
    expect(pt!.style.textShadow).toBe(ptInk.shadowCss);
    const artist = footerInk(retro.footer!, key, retro);
    expect(rgb(footer.style.color)).toEqual([240, 243, 239]);
    expect(footer.style.textShadow).toBe(artist.shadowCss);
  });

  it("the type line and the artist line are MPlantin, the name Beleren", () => {
    const { name, type, footer } = renderOn("retro", "r");
    const family = (el: HTMLElement | null): string => (el ? el.style.fontFamily || family(el.parentElement) : "");
    expect(family(name)).toContain("CardDisplay");
    expect(family(type).startsWith('"MPlantin"') || family(type).startsWith("MPlantin")).toBe(true);
    expect(family(footer).startsWith('"MPlantin"') || family(footer).startsWith("MPlantin")).toBe(true);
    expect(unquoted(family(footer))).toBe(unquoted(TYPE_FACES.body.previewFamily));
  });
});

describe("CardPreview — the 1997 footer and its © slot", () => {
  it("line 1 is `Illus. <artist>`, centred, mixed case", () => {
    const { footer } = renderOn("retro", "g");
    expect(text(footer)).toBe("Illus. Douglas Shuler");
    expect(footer.style.justifyContent).toBe("center");
    expect(footer.style.textTransform).toBe("none");
  });

  it.each(Object.keys(COLOR))("display, retro %s: the mark sits in the slot (never on the border) — dark and flat on the white frame, the standard white elsewhere", (key) => {
    const { mark, container, slotText } = renderOn("retro", key);
    expect(container.querySelectorAll("[data-brand-mark]")).toHaveLength(1);
    expect(mark!.dataset.brandMark).toBe("copyright");
    const layout = copyrightSlotLayout(retro, key, { kind: "display" })!;
    if (layout.kind !== "brand") throw new Error("expected the mark");
    expect(parseFloat(mark!.style.right)).toBeCloseTo(100 - layout.anchor.rightPct, 6);
    expect(parseFloat(mark!.style.top)).toBeCloseTo(layout.anchor.topPct, 6);
    if (key === "w") {
      expect(rgb(mark!.style.color)).toEqual([0x17, 0x12, 0x0c]);
      expect(mark!.style.textShadow).toBe("");
      expect(mark!.querySelector("path")!.getAttribute("fill")).toBe("#17120c");
    } else {
      expect(mark!.style.color.replace(/\s+/g, "")).toBe("rgba(255,255,255,0.82)");
      expect(mark!.style.textShadow).not.toBe("");
    }
    expect(mark!.textContent).toContain("pipglyph.com");
    expect(slotText).toBeNull();
  });

  it("a clean preview (no brand mark) prints the footer text in the slot — the line's ink, MPlantin, no shadow — and nothing without one", () => {
    for (const key of ["w", "r"]) {
      const { slotText, mark, footer } = renderOn("retro", key, { brandMark: false, footerWatermark: "Red Jester's Cube" });
      expect(mark).toBeNull();
      expect(slotText!.textContent).toBe("Red Jester's Cube");
      const layout = copyrightSlotLayout(retro, key, { kind: "download", footerText: "Red Jester's Cube" })!;
      if (layout.kind !== "text") throw new Error("expected the footer text");
      expect(parseFloat(slotText!.style.left)).toBeCloseTo(layout.xPct, 6);
      expect(parseFloat(slotText!.style.top)).toBeCloseTo(layout.topPct, 6);
      expect(rgb(slotText!.style.color)).toEqual(key === "w" ? [0x17, 0x12, 0x0c] : [240, 243, 239]);
      expect(slotText!.style.textShadow).toBe("");
      expect(unquoted(slotText!.style.fontFamily)).toBe(unquoted(TYPE_FACES.body.previewFamily));
      // The artist line is still the only text of line 1 (the custom text
      // is NOT beside it, where a start-aligned footer puts it).
      expect(text(footer)).toBe("Illus. Douglas Shuler");
      cleanup();
    }
    const { slotText, mark } = renderOn("retro", "r", { brandMark: false, footerWatermark: null });
    expect(slotText).toBeNull();
    expect(mark).toBeNull();
  });

  it("retroland: the same lines, the mark white on all seven keys", () => {
    for (const key of Object.keys(COLOR)) {
      const { mark, footer } = renderOn("retroland", key);
      expect(text(footer)).toBe("Illus. Douglas Shuler");
      expect(mark!.dataset.brandMark).toBe("copyright");
      expect(mark!.style.color.replace(/\s+/g, "")).toBe("rgba(255,255,255,0.82)");
      expect(copyrightSlotLayout(land, key, { kind: "display" })).toMatchObject({ ink: { kind: "light" } });
      cleanup();
    }
  });

  it("another frame is untouched: its mark on the border, its custom text beside the artist", () => {
    const { container } = render(
      <CardPreview title="Probe" cost="{1}{W}" cardType="creature" colorIdentity={["white"]} artistCredit="Ada" frameStyle={{ template: "m15" }} brandMark={false} footerWatermark="Press" />,
    );
    expect(container.querySelector('[data-copyright-slot="text"]')).toBeNull();
    expect(text(container.querySelector('[data-testid="card-footer"]')!)).toContain("Press");
  });
});

describe('CardPreview — symbolStyle "1997"', () => {
  it("draws flat discs (no shadow) in the cost and the rules text, and the 1997 tap", () => {
    const { pips } = renderOn("retro", "r");
    expect(pips).toEqual(["x flat", "r flat", "tap-4ed flat", "r flat"]);
    cleanup();
    // The same card on the Dragon Wing frame keeps M15's shadowed COST
    // discs and tap — its rules pips are flat too since layout v49 (the
    // M15-era prints shadow the cost alone). (The 2003 frame, this test's
    // first twin, has its own style since TODO 4.10b and the Alpha frame,
    // its second, since TODO 4.10c:
    // tests/unit/components/modern-2003-preview.test.tsx, alpha-1993-preview).
    const { container } = render(
      <CardPreview title="Probe" cost="{X}{R}" cardType="creature" colorIdentity={["red"]} rulesText="{T}: Add {R}." frameStyle={{ template: "tarkirdragon" }} />,
    );
    expect(pipsOf(container)).toEqual(["x shadow", "r shadow", "tap flat", "r flat"]);
  });
});
