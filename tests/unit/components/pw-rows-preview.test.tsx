// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { displayLine, parseLoyaltyAbilities } from "@/lib/cards/card-display";
import {
  LOYALTY_ROW,
  LOYALTY_ROW_SIZE_PX,
  layoutProfileLoyaltyRows,
  loyaltyRowPx,
  loyaltyRowsDrawing,
} from "@/lib/cards/loyalty-rows";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FrameTemplate } from "@/types/card";
import { fitTitleBand } from "@/lib/cards/title-band";
import { measuredLinePreviewPct } from "@/lib/cards/render-tiers";

// ---------------------------------------------------------------------------
// The live-preview half of the planeswalker rows fix (TODO 3.13 / 3.3): the
// browser used to grow a long ability's row (flex items default to
// min-height: auto) while the bake's stayed equal, and its badge box was
// 1.6 em tall against the bake's 1.5. Both now draw the rows
// layoutLoyaltyRows computes; the bake half is pinned on a real bake in
// tests/unit/render/pw-rows-bake.test.tsx. Also the name's cap before the
// detached cost (4.31).
// ---------------------------------------------------------------------------

afterEach(cleanup);

const P = getFrameProfile("m15pw");
const norm = (css: string | null | undefined) => (css ?? "").replace(/\s+/g, "");
const cqw = (fraction: number) => `${(fraction * 100).toFixed(3)}cqw`;
/** An HD px length as the preview draws it (lib/cards/rules-layout.ts). */
const hd = (px: number) => `${((px * 100) / 1500).toFixed(4)}cqw`;
const WALKER_115 =
  "+1: Scry 1.\n−2: Draw a card.\n−8: You get an emblem with \"At the beginning of your upkeep, exile the top three cards of your library. Until end of turn, you may play those cards, and you may spend mana as though it were mana of any color to cast them.\"";

function rowsOf(container: HTMLElement) {
  const { stripeAHex, stripeBHex } = P.loyaltyRows!;
  return Array.from(container.querySelectorAll("div")).filter((d) =>
    [norm(stripeAHex), norm(stripeBHex)].includes(norm(d.style.background)),
  );
}

describe("CardPreview — m15pw ability rows", () => {
  it("draws the shared row heights (1 / 1 / 5 lines), never content-grown", () => {
    const { container } = render(
      <CardPreview
        title="Probe"
        cost="{B}"
        cardType="planeswalker"
        colorIdentity={["black"]}
        rulesText={WALKER_115}
        loyalty="4"
        frameStyle={{ template: "m15pw" }}
      />,
    );
    const { rowFractions } = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(WALKER_115), 7 / 5);
    const rows = rowsOf(container);
    expect(rows).toHaveLength(3);
    expect(rowFractions[2]).toBeGreaterThan(2 * rowFractions[0]);
    rows.forEach((row, i) => {
      expect(row.style.height).toBe(`${rowFractions[i] * 100}%`);
      expect(row.style.flex).toMatch(/^(none|0 0 auto)$/);
      expect(row.style.minHeight).toMatch(/^0(px)?$/);
      // The badge stays centred on its own row.
      expect(row.style.alignItems).toBe("center");
    });
    // (happy-dom drops `cqw` lengths: the text size and the badge's 1.5 em
    // box — the LOYALTY_ROW constant both renderers read — are pinned on the
    // server markup below.)
    expect(LOYALTY_ROW.badgeHeightEm).toBe(1.5);
  });

  it("sets the rows' text at the layout's size, with the 1.5 em badge box — the HD bake's px (server markup keeps cqw)", () => {
    const html = renderToStaticMarkup(
      <CardPreview
        title="Probe"
        cost="{B}"
        cardType="planeswalker"
        colorIdentity={["black"]}
        rulesText={WALKER_115}
        loyalty="4"
        frameStyle={{ template: "m15pw" }}
      />,
    );
    const rows = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(WALKER_115), 7 / 5);
    const a = loyaltyRowPx();
    // The badge keeps the anatomy's one size, whatever the text's.
    expect(a.badgeHeight).toBe(Math.round(LOYALTY_ROW_SIZE_PX * LOYALTY_ROW.badgeHeightEm));
    // The row's badge box: the first div inside the first stripe row.
    const firstRow = html.indexOf(`background:${P.loyaltyRows!.stripeAHex}`);
    expect(firstRow).toBeGreaterThan(0);
    const rowTag = html.indexOf("<div", firstRow);
    const badge = html.slice(rowTag, html.indexOf(">", rowTag));
    expect(badge).toContain(`width:${hd(a.badgeWidth)}`);
    expect(badge).toContain(`height:${hd(a.badgeHeight)}`);
    // Each ability's lines at the HD bake's size (RulesLines' box).
    expect(html).toContain(`font-size:${hd(rows.sizePx)}`);
  });

  it("wraps only a last ability that would reach the loyalty shield short of it (server markup keeps cqw)", () => {
    // Its ultimate runs on beside the shield at the full width: the last
    // column ends short of the shield.
    const reaches =
      "+1: Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n−3: Return target creature card from your graveyard to your hand.\n−7: Search your library for up to three creature cards, reveal them, put them into your hand, then shuffle. You gain 1 life for each card.";
    const columnsOf = (rulesText: string) =>
      renderToStaticMarkup(
        <CardPreview
          title="Probe"
          cost="{B}"
          cardType="planeswalker"
          colorIdentity={["black"]}
          rulesText={rulesText}
          loyalty="4"
          frameStyle={{ template: "m15pw" }}
        />,
      ).match(/<div style="display:flex;flex-direction:column;flex-shrink:0;width:[^"]*"/g)!;
    const rows = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(reaches), 7 / 5);
    expect(rows.lastRowInsetPct).toBeGreaterThan(0.1);
    // Each row's text column, the width the lines were broken for: the last
    // one 186 HD px (the shield's 12.4 %) narrower.
    const { text } = loyaltyRowsDrawing(rows, "hd");
    const columns = columnsOf(reaches);
    expect(columns).toHaveLength(3);
    columns.forEach((column, i) => expect(column).toContain(`width:${hd(text[i].column)}`));
    expect(text[0].column - text[2].column).toBe(186);
    // An ultimate that stays clear of the shield at the full width (its long
    // lines sit above it): every column keeps the row's width (owner
    // decision 2026-09-26).
    const clears =
      "+1: Draw a card, then discard a card.\n−2: Draw a card.\n−10: Search your library for any number of creature cards, put them onto the battlefield, then shuffle. They gain haste. Exile them at the beginning of the next end step.";
    const clearRows = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(clears), 7 / 5);
    expect(clearRows.lastRowInsetPct).toBe(0);
    const clearText = loyaltyRowsDrawing(clearRows, "hd").text;
    const clear = columnsOf(clears);
    expect(clear).toHaveLength(3);
    for (const column of clear) expect(column).toContain(`width:${hd(clearText[0].column)}`);
  });

  it("draws exactly the layout's lines, never a wrapping one (server markup)", () => {
    const html = renderToStaticMarkup(
      <CardPreview
        title="Probe"
        cost="{B}"
        cardType="planeswalker"
        colorIdentity={["black"]}
        rulesText={WALKER_115}
        loyalty="4"
        frameStyle={{ template: "m15pw" }}
      />,
    );
    const rows = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(WALKER_115), 7 / 5);
    const lines = html.match(/<div data-rules-line="" style="[^"]*"/g)!;
    const want = rows.text.reduce((n, t) => n + t.blocks.reduce((m, b) => m + b.lines.length, 0), 0);
    expect(lines).toHaveLength(want);
    const m = loyaltyRowsDrawing(rows, "hd").text[0].metrics;
    for (const line of lines) {
      expect(line).toContain("flex-wrap:nowrap");
      expect(line).toContain("white-space:nowrap");
      expect(line).toContain(`height:${hd(m.linePx)}`);
    }
  });

  it("lays out the editor-only hint rows the same way", () => {
    const { container } = render(
      <CardPreview title="New Walker" cardType="planeswalker" colorIdentity={["blue"]} frameStyle={{ template: "m15pw" }} staticInEditor />,
    );
    const rows = rowsOf(container);
    expect(rows).toHaveLength(3);
    const total = rows.reduce((sum, row) => sum + parseFloat(row.style.height), 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

describe("CardPreview — the name before a detached cost", () => {
  /** The title band's opening tag and the name span, from server markup
   *  (happy-dom drops cqw lengths). */
  function titleBand(title: string, cost: string, template: FrameTemplate = "m15pw") {
    const html = renderToStaticMarkup(
      <CardPreview title={title} cost={cost} cardType="planeswalker" colorIdentity={["red", "white", "black"]} loyalty="5" frameStyle={{ template }} />,
    );
    const at = html.lastIndexOf("<span", html.indexOf(` title="${title}"`));
    expect(at).toBeGreaterThan(0);
    const bandTag = html.slice(html.lastIndexOf("<div", at), html.indexOf(">", html.lastIndexOf("<div", at)));
    const span = html.slice(at, html.indexOf("</span>", at));
    return { bandTag, span };
  }

  // Since layout v32 the walker's name is on the measured fit (fitTitleBand;
  // the old detached fit, which Modern keeps, is fitTitleBand's fallback).
  it("caps the name where the bake does: fitTitleBand's room before the pips", () => {
    const cost = "{1}{R}{W}{B}";
    const title = "Miner the Miner, Damned Delver";
    const { container } = render(
      <CardPreview title={title} cost={cost} cardType="planeswalker" colorIdentity={["red", "white", "black"]} loyalty="5" frameStyle={{ template: "m15pw" }} />,
    );
    const name = container.querySelector(`span[title="${title}"]`) as HTMLElement;
    expect(name.style.maxWidth).toBe(cqw(fitTitleBand(P, title, cost)!.widthPct));
    expect(name.style.textOverflow).toBe("ellipsis");
  });

  it("sets a long name at its fitted size, whole (Miner the Miner, Damned Delver)", () => {
    const cost = "{1}{R}{W}{B}";
    const title = "Miner the Miner, Damned Delver";
    const fit = fitTitleBand(P, title, cost)!;
    expect(fit.text).toBe(title);
    expect(fit.sizePct).toBeLessThan(P.title.sizePct);
    const { bandTag, span } = titleBand(title, cost);
    // A measured (family) name the fit shrank shows at the stored HD bake's
    // whole px (layout v32).
    expect(P.title.fit).toBe("measured");
    expect(bandTag).toContain(`font-size:${cqw(measuredLinePreviewPct(fit.sizePct, P.title.sizePct))}`);
    // Drawn as one run with no-break spaces, like every display line.
    expect(span.endsWith(`>${displayLine(title)}`)).toBe(true);
  });

  it("past the 5 pt floor draws the cut name with its own '…' (a 14-symbol cost, both frames)", () => {
    const cost = "{W}".repeat(14);
    const title = "Skeptic, the Endlessly Wandering Walker of Worlds";
    for (const template of ["m15pw", "modern"] as const) {
      const profile = getFrameProfile(template);
      const fit = fitTitleBand(profile, title, cost)!;
      expect(fit.text.endsWith("…")).toBe(true);
      const { bandTag, span } = titleBand(title, cost, template);
      // The family's walker at the HD bake's floor px (42 / 1500); modern's
      // old path at its fitted size.
      const size = profile.title.fit === "measured" ? measuredLinePreviewPct(fit.sizePct, profile.title.sizePct) : fit.sizePct;
      expect(bandTag).toContain(`font-size:${cqw(size)}`);
      // The drawn text is the cut one; the tooltip keeps the whole name.
      expect(span.endsWith(`>${displayLine(fit.text)}`)).toBe(true);
    }
  });

  it("keeps a name that fits at the slot's size", () => {
    const { bandTag, span } = titleBand("Kikyo Zoldyck", "{1}{R}{W}{B}");
    expect(bandTag).toContain(`font-size:${cqw(P.title.sizePct)}`);
    expect(span.endsWith(`>${displayLine("Kikyo Zoldyck")}`)).toBe(true);
  });

  it("leaves an inline cost's name uncapped outside the family; a measured band caps it at its room", () => {
    const serra = (template: FrameTemplate) =>
      (
        render(
          <CardPreview title="Serra Angel" cost="{3}{W}{W}" cardType="creature" colorIdentity={["white"]} frameStyle={{ template }} />,
        ).container.querySelector('span[title="Serra Angel"]') as HTMLElement
      ).style.maxWidth;
    // (modern's detached cost fits its name; agclassic's inline one is the
    // old path. The 1997 frame is measured since TODO 4.10a.)
    expect(serra("agclassic")).toBe("");
    cleanup();
    expect(serra("m15")).toBe(cqw(fitTitleBand(getFrameProfile("m15"), "Serra Angel", "{3}{W}{W}")!.widthPct));
    cleanup();
    const { container: noCost } = render(
      <CardPreview title="Probe" cardType="planeswalker" colorIdentity={["white"]} loyalty="3" frameStyle={{ template: "m15pw" }} />,
    );
    expect((noCost.querySelector('span[title="Probe"]') as HTMLElement).style.maxWidth).toBe(
      cqw(fitTitleBand(P, "Probe", null)!.widthPct),
    );
  });
});
