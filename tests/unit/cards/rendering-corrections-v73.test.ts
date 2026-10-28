import { describe, expect, it } from "vitest";
import { flavorBarArt, isFlavorBarArt } from "@/lib/cards/flavor-bar";
import {
  RULES_TARGETS,
  fitRulesLayout,
  gapBefore,
  hangIndentPx,
  isBulletRun,
  layoutRulesAt,
  linePositions,
  metricsFor,
  runWidthPx,
  type RulesLayoutInput,
} from "@/lib/cards/rules-layout";
import { rulesDraw } from "@/lib/cards/rules-box";
import {
  bakeShadowCss,
  bandTextStyle,
  cardPx,
  getFrameProfile,
  shadowDrawsAsCopies,
  textShadowCopies,
} from "@/lib/cards/template-layout";
import { BRAND_MARK_LIGHT_SHADOW } from "@/lib/cards/copyright-slot";
import { RULES_TEXT } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// Layout v73 — rendering corrections, round 1 (TODO 3.5 / 3.16 / 3.19 /
// 3.22 / 3.25): the shared numbers both renderers draw. The bakes are held
// by tests/unit/render/rendering-corrections-v73-bake.test.tsx, the preview
// by tests/unit/components/rules-lines-preview.test.tsx, the sweep's scope
// by tests/unit/cards/layout-version.test.ts.
// ---------------------------------------------------------------------------

const M15 = getFrameProfile("m15");
const m15 = (rulesText: string, over: Partial<RulesLayoutInput> = {}): RulesLayoutInput => ({
  rulesText,
  rect: M15.rules.rect,
  aspect: 7 / 5,
  sizePct: M15.rules.sizePct,
  padPx: M15.rules.padPx,
  vAlign: M15.rules.vAlign,
  ...over,
});

/** DTK #224 Kolaghan's Command: the TODO's four-mode Command. */
const KOLAGHANS_COMMAND =
  "Choose two —\n• Return target creature card from your graveyard to your hand.\n• Target player discards a card.\n• Destroy target artifact.\n• Kolaghan's Command deals 2 damage to any target.";

describe("3.16 — modal bullets: hung lines, the bullet gap", () => {
  it("knows a bullet mode by its '•' word — never one glued to its word, never spree's '+'", () => {
    expect(isBulletRun([{ t: "w", v: "•" }])).toBe(true);
    expect(isBulletRun([{ t: "w", v: "•Return" }])).toBe(false);
    expect(isBulletRun([{ t: "w", v: "+" }])).toBe(false);
    expect(isBulletRun([{ t: "w", v: "•", em: "reminder" }])).toBe(false);
    expect(isBulletRun(undefined)).toBe(false);
    const layout = layoutRulesAt(m15("Spree (Choose one or more additional costs.)\n+ {1} — Draw a card.\n•Glued.\n• A mode."), 76);
    expect(layout.blocks.map((b) => (b.kind === "rules" && b.bullet ? "bullet" : b.kind))).toEqual(["rules", "rules", "rules", "bullet"]);
  });

  it("hangs a mode's wrapped lines where its first word starts — the bullet's box and a word gap in, at each target", () => {
    const layout = fitRulesLayout(m15(KOLAGHANS_COMMAND));
    expect(layout.clipped).toBe(false);
    const [choose, ret] = layout.blocks;
    expect(choose.kind === "rules" && choose.bullet).toBeFalsy();
    expect(ret.kind === "rules" && ret.bullet).toBe(true);
    expect(ret.lines.length).toBeGreaterThan(1);
    for (const t of RULES_TARGETS) {
      const placed = linePositions(layout, t);
      const m = placed.metrics;
      const hang = runWidthPx(ret.lines[0].runs[0], m) + m.wordGapPx;
      expect(hangIndentPx(ret, 0, m)).toBe(0);
      expect(hangIndentPx(ret, 1, m)).toBe(hang);
      expect(hangIndentPx(choose, 1, m)).toBe(0);
      // The bullet's own box: "•" in MPlantin and the space after it, ≈ 0.55 em
      // — the prints hang 0.52–0.55 em (DTK #224 39 px at 72 px type; MH3 #11
      // 33.5 at 64; TBLB #5 ≈ 50 at 76).
      expect(hang / m.fontPx).toBeGreaterThan(0.45);
      expect(hang / m.fontPx).toBeLessThan(0.65);
      const lines = placed.lines.filter((l) => l.block === 1);
      expect(lines[0].indent).toBe(0);
      for (const l of lines.slice(1)) expect(l.indent, t).toBe(hang);
      // The hung line broke against the shorter column: it ends inside it.
      for (const l of lines) expect(l.left + l.width, t).toBeLessThanOrEqual(placed.interior.left + placed.interior.width);
    }
  });

  it("sets the modes the bullet gap (12 HD px) below the line before them, never an ability's 24 — and the next ability an ability's", () => {
    const layout = fitRulesLayout(m15(`${KOLAGHANS_COMMAND}\nFlashback {2}{B}{R}`));
    for (const t of RULES_TARGETS) {
      const m = linePositions(layout, t).metrics;
      expect(m.bulletGapPx).toBe(t === "hd" ? 12 : 6);
      const gaps = layout.blocks.map((_, i) => gapBefore(layout.blocks, i, m, true));
      expect(gaps).toEqual([0, m.bulletGapPx, m.bulletGapPx, m.bulletGapPx, m.bulletGapPx, m.paragraphGapPx]);
      // What both renderers draw: the same gaps.
      const drawn = rulesDraw(layout, t).blocks.map((b) => b.marginTop);
      expect(drawn.slice(1)).toEqual(gaps.slice(1));
    }
    expect(RULES_TEXT.bulletGapPx).toBe(12);
  });

  it("fits a long Command at a size an ability-gapped one could not (the fit counts the hang and the gap)", () => {
    const long = `${KOLAGHANS_COMMAND}\n• Exile target card from a graveyard.\n• Target creature gets +2/+0 until end of turn.\n• Draw a card, then discard a card.`;
    const now = fitRulesLayout(m15(long));
    const plain = fitRulesLayout(m15(long, { bulletModes: "plain" }));
    expect(now.sizePx).toBeGreaterThanOrEqual(plain.sizePx);
    // "plain" is the v72 layout: no mode is a bullet, every gap an ability's.
    expect(plain.blocks.some((b) => b.kind === "rules" && b.bullet)).toBe(false);
    for (const t of RULES_TARGETS) {
      const m = metricsFor(plain.sizePx, RULES_TEXT.lineHeight, t);
      for (let i = 1; i < plain.blocks.length; i += 1) expect(gapBefore(plain.blocks, i, m, true)).toBe(m.paragraphGapPx);
    }
  });

  it("never hangs a centred block's lines (each is centred on the box), but breaks them as the left-aligned twin does", () => {
    const left = fitRulesLayout(m15(KOLAGHANS_COMMAND));
    const centred = fitRulesLayout(m15(KOLAGHANS_COMMAND, { align: "center" }));
    expect(centred.sizePx).toBe(left.sizePx);
    expect(centred.blocks.map((b) => b.lines.length)).toEqual(left.blocks.map((b) => b.lines.length));
  });

  it("never squeezes the bullet gap wider than a squeezed ability gap", () => {
    const m = { ...metricsFor(76, RULES_TEXT.lineHeight, "hd"), paragraphGapPx: 10 };
    const layout = layoutRulesAt(m15("Choose one —\n• A.\n• B."), 76);
    expect(gapBefore(layout.blocks, 1, m, true)).toBe(10);
  });
});

describe("3.19 — the flavor bar: ≈ 0.2 % of the card's height, 96 % of the column, faded ends", () => {
  it("is 4 HD px (2 at 750) on the v33 hairline's centre line — no flavour line moves", () => {
    const layout = fitRulesLayout(m15("Flying", { flavorText: "Up.", divider: true }));
    for (const t of RULES_TARGETS) {
      const placed = linePositions(layout, t);
      const m = placed.metrics;
      expect(m.barPx).toBe(t === "hd" ? 4 : 2);
      expect(m.flavorBarAbovePx + m.barPx + m.flavorBarBelowPx).toBe(t === "hd" ? 61 : 31);
      // ≈ 0.2 % of the card's height.
      expect(m.barPx / (t === "hd" ? 2100 : 1050)).toBeCloseTo(0.002, 3);
      const bar = placed.bar!;
      expect(bar.height).toBe(m.barPx);
      expect(bar.width / placed.interior.width).toBeCloseTo(0.96, 2);
      expect(bar.left - placed.interior.left).toBe(Math.floor((placed.interior.width - bar.width) / 2));
    }
  });

  it("draws one SVG — the ink faded in over the first and out over the last tenth, 0.3 in the middle", () => {
    const url = flavorBarArt("#17120c", 1195, 4);
    expect(url.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    const svg = decodeURIComponent(url.slice("data:image/svg+xml;utf8,".length));
    expect(svg).toContain('width="1195" height="4" viewBox="0 0 1195 4"');
    expect([...svg.matchAll(/<stop offset="([\d.]+)" stop-color="#17120c" stop-opacity="([\d.]+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2])])).toEqual([
      [0, 0],
      [0.1, 0.3],
      [0.9, 0.3],
      [1, 0],
    ]);
    expect(isFlavorBarArt(url)).toBe(true);
    // As Satori re-encodes it into its SVG.
    expect(isFlavorBarArt(`data:image/svg+xml;base64,${btoa(svg)}`)).toBe(true);
    expect(isFlavorBarArt("data:image/svg+xml;utf8,%3Csvg%3E")).toBe(false);
    // The same string for the same box: one picture per bar, cached.
    expect(flavorBarArt("#17120c", 1195, 4)).toBe(url);
  });
});

describe("3.5 / 3.25 — shadows as card-width fractions, an outline as copies", () => {
  it("writes a shadow length in cqw of a 750 px card, and the bake reads it in px at its width", () => {
    expect(cardPx(1)).toBe("0.13333cqw");
    expect(cardPx(3)).toBe("0.4cqw");
    expect(bakeShadowCss(`0 ${cardPx(1)} ${cardPx(3)} rgba(0,0,0,0.8)`, 750)).toBe("0 1px 3px rgba(0,0,0,0.8)");
    expect(bakeShadowCss(`0 ${cardPx(1)} ${cardPx(3)} rgba(0,0,0,0.8)`, 1500)).toBe("0 2px 6px rgba(0,0,0,0.8)");
    // Landscape: the card's own width.
    expect(bakeShadowCss(`-${cardPx(1)} 0 0 #000`, 2100)).toBe("-2.8px 0 0 #000");
    // Any other length is left as it is.
    expect(bakeShadowCss("0.06em 0.06em 0 #000", 1500)).toBe("0.06em 0.06em 0 #000");
    expect(BRAND_MARK_LIGHT_SHADOW).toBe("0 0.13333cqw 0.4cqw rgba(0,0,0,0.8)");
  });

  it("draws OUTLINE_SHADOW as four copies, in px at the card's width — and its text alone carries it", () => {
    const ghost = getFrameProfile("tarkirghostfire");
    const outline = ghost.title.shadowCss!;
    expect(shadowDrawsAsCopies(outline)).toBe(true);
    expect(textShadowCopies(outline, 70, 1500)).toEqual([
      { dx: 2, dy: 2, color: "#000" },
      { dx: -2, dy: 2, color: "#000" },
      { dx: 2, dy: -2, color: "#000" },
      { dx: -2, dy: -2, color: "#000" },
    ]);
    expect(textShadowCopies(outline, 35, 750)?.map((c) => [c.dx, c.dy])).toEqual([
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ]);
    // A cqw length with no card width can't be read.
    expect(textShadowCopies(outline, 70)).toBeNull();
    // The band never sets it (its pips would inherit it): its text does.
    expect(bandTextStyle(ghost.title, "w")).toEqual({ textShadow: outline });
    expect(bandTextStyle(ghost.type, "w")).toEqual({ textShadow: ghost.type.shadowCss });
    // A blurred two-layer shadow (nyx's SHOWCASE_SHADOW) stays CSS.
    const nyx = getFrameProfile("nyx").title.shadowCss!;
    expect(shadowDrawsAsCopies(nyx)).toBe(false);
    expect(bandTextStyle(getFrameProfile("nyx").title, "w")).toEqual({});
    expect(bakeShadowCss(nyx, 1500)).toBe("0 2px 4px rgba(0,0,0,0.65), 0 0 4px rgba(0,0,0,0.5)");
  });

  it("leaves no px shadow on any profile", () => {
    for (const t of ["m15pw", "m15borderlesspw", "m15borderlesspwtall", "tarkirghostfire", "adventure", "prepare", "fullart", "nyx"]) {
      const json = JSON.stringify(getFrameProfile(t));
      for (const m of json.matchAll(/"shadowCss":"([^"]*)"/g)) expect(m[1], t).not.toMatch(/\dpx/);
    }
  });
});
