// @vitest-environment happy-dom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardPreview } from "@/components/cards/card-preview";
import { mainRulesLayout, rulesDraw } from "@/lib/cards/rules-box";
import {
  M20_TOKEN_PILL_INTERIOR_PX,
  M20_TOKEN_SYMBOL_CENTRE_PX,
  M20_TOKEN_TITLE_BOX_PX,
  bandTextStyle,
  getFrameProfile,
} from "@/lib/cards/template-layout";
import { RULES_HD_WIDTH } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The preview half of TODO 4.48 / 4.50's full-art token (the bake half is
// tests/unit/render/m20-token-bake.test.tsx): CardPreview draws the same
// type line, symbol box, rules and name ink the bake draws, from the same
// profile — the textless height keeps its type line but draws no rules (3.24's
// `textless` with `textlessTypeLine`), a single rules line is indented by the
// layout's whole HD px (rulesDraw), and the name is dark only on the white
// pill. Read from the server markup (happy-dom drops the cqw lengths a live
// element's style would hold).
// ---------------------------------------------------------------------------

function render(template: string, rulesText: string | null, colour = "white", supertype = "Creature") {
  const html = renderToStaticMarkup(
    <CardPreview
      title="Soldier"
      cardType="token"
      supertype={supertype}
      subtypes={["Soldier"]}
      colorIdentity={[colour as "white"]}
      rulesText={rulesText}
      power="1"
      toughness="1"
      rarity="common"
      frameStyle={{ template: template as "m20token" }}
    />,
  );
  const doc = new DOMParser().parseFromString(html, "text/html");
  return {
    html,
    typeLine: doc.querySelector('[data-testid="type-line"]'),
    rulesBox: doc.querySelector('[data-testid="rules-box"]'),
    lines: Array.from(doc.querySelectorAll<HTMLElement>('[data-testid="rules-line"]')),
  };
}

const cqw = (px: number) => `${((px / RULES_HD_WIDTH.portrait) * 100).toFixed(3)}cqw`;
const marginLeft = (el: Element) => /(?:^|;)\s*margin-left:\s*([^;]+)/.exec(el.getAttribute("style") ?? "")?.[1].trim() ?? "";

describe("CardPreview — the full-art token (TODO 4.48 / 4.50)", () => {
  it.each(["m20token", "m20tokenartifact"])("%s: the textless height prints its type line and no rules, even with text", (template) => {
    const { typeLine, rulesBox, lines } = render(template, "Flying");
    expect(typeLine?.textContent).toMatch(/Token\sCreature\s—\sSoldier/);
    expect(rulesBox).toBeNull();
    expect(lines).toHaveLength(0);
  });

  it.each(["m20tokentext", "m20tokenartifacttext", "m20tokentall", "m20tokenartifacttall"])(
    "%s: indents ONE rules line by the layout's HD px — the bake's",
    (template) => {
      const { lines } = render(template, "Flying");
      expect(lines).toHaveLength(1);
      const layout = mainRulesLayout({ layout: getFrameProfile(template), rulesText: "Flying", aspect: 7 / 5, show: { pt: true } });
      const block = rulesDraw(layout, "hd").blocks[0];
      const indent = block.kind === "blank" ? 0 : block.indents[0];
      expect(indent).toBeGreaterThan(500);
      expect(marginLeft(lines[0])).toBe(cqw(indent));
    },
  );

  it("draws two or more lines from the left, with no margin", () => {
    const { lines } = render("m20tokentext", "Flying\nVigilance\nLifelink");
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(marginLeft(line)).toBe("");
  });

  it("prints the name dark on the plain white pill only: white on every other pill and on the artifact templates' silver", () => {
    for (const template of ["m20token", "m20tokentext", "m20tokentall"]) {
      const p = getFrameProfile(template);
      expect(bandTextStyle(p.title, "w"), template).toEqual({ color: "#17120c" });
      for (const k of ["u", "b", "r", "g", "c", "m"]) expect(bandTextStyle(p.title, k), `${template} ${k}`).toEqual({});
      expect(p.title.colorHex).toBe("#ffffff");
      expect(render(template, null, "white").html).toContain("color:#17120c");
    }
    for (const template of ["m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"]) {
      const p = getFrameProfile(template);
      expect(p.title.inkByColorKey, template).toBeUndefined();
      expect(p.title.colorHex).toBe("#ffffff");
    }
  });

  it.each([
    ["m20token", "textless"],
    ["m20tokentext", "regular"],
    ["m20tokentall", "tall"],
  ] as const)("%s: the type band on its pill, the symbol box centred where the prints centre theirs", (template, height) => {
    for (const t of [template, template.replace("m20token", "m20tokenartifact")]) {
      const p = getFrameProfile(t);
      const pill = M20_TOKEN_PILL_INTERIOR_PX[height];
      const band = p.type.rect;
      // The band IS the pill's interior (HD px), from CC's 8.54 %W to the
      // symbol box's right edge.
      expect((band.topPct / 100) * 2100, t).toBeCloseTo(pill.top, 9);
      expect(((band.topPct + band.heightPct) / 100) * 2100, t).toBeCloseTo(pill.bottom + 1, 9);
      expect([band.leftPct, band.widthPct]).toEqual([8.54, 83.59]);
      // CC's 0.12 W × 0.041 H box, right edge 92.13 %W, centred on the
      // prints' 1775 / 1476 / 1241.5 px.
      const sym = p.symbolRect!;
      expect([sym.leftPct, sym.widthPct, sym.heightPct]).toEqual([80.13, 12, 4.1]);
      expect(((sym.topPct + sym.heightPct / 2) / 100) * 2100, t).toBeCloseTo(M20_TOKEN_SYMBOL_CENTRE_PX[height], 6);
    }
    expect(M20_TOKEN_SYMBOL_CENTRE_PX).toEqual({ textless: 1775, regular: 1476, tall: 1241.5 });
  });

  it("puts the P/T on M15's plate box with M15's value box, the digits 3.5 px higher, and the artifact templates on M15's artifact plates", () => {
    const m15 = getFrameProfile("m15").pt!;
    for (const t of ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"]) {
      const pt = getFrameProfile(t).pt!;
      expect(pt.plateRect, t).toEqual(m15.plateRect);
      expect(pt.rect, t).toEqual(m15.rect);
      expect(((pt.valueDyEm! - m15.valueDyEm!) * 75)).toBeCloseTo(-3.5, 9);
      expect(pt.plateAssetPathTemplate, t).toBe(t.includes("artifact") ? "/frames/m15artifact/pt/{color}.png" : "/frames/m15/pt/{color}.png");
    }
  });

  it("puts the name band on whole px at both bake targets, so the preview and the bake centre the same box", () => {
    // CC's name box is 109.62 + 114.03 px at HD (54.81 + 57.015 at 750): the
    // browser and Satori round a box between pixels differently, and the
    // 750 px preview's name sat 2 px above the bake's (measured on real
    // screenshots vs bakes, 2026-09-29; the arch token's whole-px box: 1).
    expect(M20_TOKEN_TITLE_BOX_PX).toEqual({ top: 110, height: 114 });
    for (const t of ["m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall"]) {
      const { rect } = getFrameProfile(t).title;
      for (const cardHeight of [2100, 1050]) {
        for (const px of [(rect.topPct / 100) * cardHeight, (rect.heightPct / 100) * cardHeight]) {
          expect(Math.abs(px - Math.round(px)), `${t} @${cardHeight}: ${px}`).toBeLessThan(1e-9);
        }
      }
      // Still CC's box, to the nearest even row.
      expect(Math.abs((rect.topPct / 100) * 2100 - 0.0522 * 2100)).toBeLessThanOrEqual(1);
      expect(Math.abs((rect.heightPct / 100) * 2100 - 0.0543 * 2100)).toBeLessThanOrEqual(1);
      expect([rect.leftPct, rect.widthPct]).toEqual([8.54, 82.92]);
    }
  });

  it("runs the art to the black ring (CC's bounds with 7.6's overscan), no scrim, no cost", () => {
    for (const t of ["m20token", "m20tokentext", "m20tokentall"]) {
      const p = getFrameProfile(t);
      expect(p.artSlot).toEqual({ topPct: 2.8, leftPct: 3.9, widthPct: 92.2, heightPct: 89.6 });
      expect(p.rules.backdropHex).toBeUndefined();
      expect(p.hideCost).toBe(true);
    }
  });
});
