import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { setSymbolSize, setSymbolSource } from "@/lib/cards/set-symbol-size";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The set symbol in the live preview (TODO 4.20, layout v32): drawn at
// setSymbolSize's size — the family's box for an icon and the default mark,
// the ink-fitted font for a Keyrune glyph — and a glyph is laid out at its
// table advance (setSymbolSize's drawnWidthPct), the width the bake gives it.
// Read from the server markup (happy-dom drops container-query widths). The
// bake half is measured on real bakes in
// tests/unit/render/set-symbol-bake.test.tsx.
// ---------------------------------------------------------------------------

const cqw = (pct: number) => `${(pct * 100).toFixed(3)}cqw`;

function markup(template: string, symbol: { setIconUrl?: string | null; setIconCode?: string | null }) {
  return renderToStaticMarkup(
    <CardPreview
      title="Probe"
      cost="{W}"
      cardType="instant"
      colorIdentity={["white"]}
      rarity="rare"
      frameStyle={{ template: template as "m15" }}
      {...symbol}
    />,
  );
}

/** The inline style of the one element whose opening tag matches `tag`. */
function styleOf(html: string, tag: RegExp): string {
  const found = html.match(new RegExp(`<${tag.source}[^>]*>`, "g")) ?? [];
  expect(found, String(tag)).toHaveLength(1);
  return /style="([^"]*)"/.exec(found[0] ?? "")?.[1] ?? "";
}

describe("CardPreview — set symbol size", () => {
  it("draws the default mark and an icon in M15's 86 px box (5.74 % of the card's width)", () => {
    expect(styleOf(markup("m15", {}), /svg[^>]*aria-label="PipGlyph set"/)).toContain(
      "width:5.740cqw;height:5.740cqw",
    );
    expect(
      styleOf(markup("m15", { setIconUrl: "https://zkwkisxoqdhdchqyjwdc.supabase.co/storage/v1/object/public/set-covers/11111111-1111-4111-8111-111111111111/icon.png" }), /img[^>]*alt="Set icon"/),
    ).toContain("width:5.740cqw;height:5.740cqw");
  });

  it("gives a Keyrune glyph its ink-fitted font and its table advance as width", () => {
    for (const [template, code] of [
      ["m15", "dom"],
      ["m15", "m20"],
      ["m15pw", "dom"],
      ["saga", "ktk"],
      ["m15fullartland", "dom"],
    ] as const) {
      const size = setSymbolSize(getFrameProfile(template), setSymbolSource(null, code));
      const style = styleOf(markup(template, { setIconCode: code }), new RegExp(`i[^>]*ss-${code}`));
      expect(style, `${template} ${code}`).toContain(`font-size:${cqw(size.sizePct)};width:${cqw(size.drawnWidthPct)}`);
    }
    // DOM on M15: its print's size (layout v36, TODO 4.46) — 0.0596 W (89 px
    // at HD), its ink the print's 88.5 px; an unmeasured tall glyph (XLN)
    // still fills the 86 px box exactly.
    expect(cqw(setSymbolSize(getFrameProfile("m15"), setSymbolSource(null, "dom")).sizePct)).toBe("5.964cqw");
    expect(cqw(setSymbolSize(getFrameProfile("m15"), setSymbolSource(null, "xln")).sizePct)).toBe("5.740cqw");
  });

  it("never shrinks a symbolRect's symbol: the core-set pill (wider than the 12 %W rect, v36) ends at its right edge", () => {
    const p = getFrameProfile("m15pw");
    const size = setSymbolSize(p, setSymbolSource(null, "m21"));
    // 189 px at HD — its print's width, past CC's 180 px (owner round 18).
    expect(size.drawnWidthPct * 100).toBeGreaterThan(p.symbolRect!.widthPct);
    const style = styleOf(markup("m15pw", { setIconCode: "m21" }), /i[^>]*ss-m21/);
    expect(style).toContain(`width:${cqw(size.drawnWidthPct)}`);
    expect(style).toContain("flex-shrink:0");
  });

  it("keeps a frame outside the family at type.sizePct × 1.1 for every source", () => {
    const box = cqw(getFrameProfile("modern").type.sizePct * 1.1);
    expect(box).toBe("3.817cqw");
    expect(styleOf(markup("modern", {}), /svg[^>]*aria-label="PipGlyph set"/)).toContain(`width:${box};height:${box}`);
    expect(styleOf(markup("modern", { setIconCode: "dom" }), /i[^>]*ss-dom/)).toContain(`font-size:${box};`);
  });
});
