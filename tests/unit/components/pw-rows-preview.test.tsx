// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { displayLine, parseLoyaltyAbilities } from "@/lib/cards/card-display";
import { LOYALTY_ROW, layoutProfileLoyaltyRows } from "@/lib/cards/loyalty-rows";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FrameTemplate } from "@/types/card";
import { detachedCostTitleWidthPct, fitDetachedCostTitle } from "@/lib/cards/title-band";

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
    expect(rowFractions[2]).toBeGreaterThan(2.5 * rowFractions[0]);
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

  it("sets the rows' text at the layout's size, with the 1.5 em badge box (server markup keeps cqw)", () => {
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
    const { sizePct } = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(WALKER_115), 7 / 5);
    // The opening tags up to the first stripe row: …, the rows' box, the row.
    const firstRow = html.indexOf(`background:${P.loyaltyRows!.stripeAHex}`);
    expect(firstRow).toBeGreaterThan(0);
    const tags = html.slice(0, firstRow).match(/<div style="[^"]*/g)!;
    const box = tags.at(-2)!;
    expect(box).toContain("flex-direction:column");
    expect(box).toContain(`font-size:${cqw(sizePct)}`);
    // The row's badge box: the first div inside the row.
    const rowTag = html.indexOf("<div", firstRow);
    const badge = html.slice(rowTag, html.indexOf(">", rowTag));
    expect(badge).toContain(`width:${cqw(sizePct * LOYALTY_ROW.badgeWidthEm)}`);
    expect(badge).toContain(`height:${cqw(sizePct * LOYALTY_ROW.badgeHeightEm)}`);
  });

  it("wraps only a last ability that would reach the loyalty shield short of it (server markup keeps cqw)", () => {
    // Its ultimate's second-to-last line runs on beside the shield at the
    // full width: the last column ends short of the shield.
    const reaches =
      "+1: Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.\n−3: Return target creature card from your graveyard to your hand.\n−7: Search your library for any number of creature cards, reveal them, put them into your hand, then shuffle. You gain 1 life for each card.";
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
      ).match(/<div style="flex:1;min-width:0[^"]*"/g)!;
    const { lastRowInsetPct } = layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(reaches), 7 / 5);
    expect(lastRowInsetPct).toBeGreaterThan(0.1);
    // Each row's text column: the div after the badge box, flex: 1.
    const columns = columnsOf(reaches);
    expect(columns).toHaveLength(3);
    expect(columns[0]).not.toContain("margin-right");
    expect(columns[1]).not.toContain("margin-right");
    expect(columns[2]).toContain(`margin-right:${cqw(lastRowInsetPct)}`);
    // The 1 / 1 / 5 walker's ultimate stays clear of the shield at the full
    // width (its long lines sit above it): every column keeps the row's
    // width (owner decision 2026-09-26).
    expect(layoutProfileLoyaltyRows(P, parseLoyaltyAbilities(WALKER_115), 7 / 5).lastRowInsetPct).toBe(0);
    const clear = columnsOf(WALKER_115);
    expect(clear).toHaveLength(3);
    for (const column of clear) expect(column).not.toContain("margin-right");
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

  it("caps the name where the bake does: one band gap before the pips", () => {
    const cost = "{1}{R}{W}{B}";
    const title = "Miner the Miner, Damned Delver";
    const { container } = render(
      <CardPreview title={title} cost={cost} cardType="planeswalker" colorIdentity={["red", "white", "black"]} loyalty="5" frameStyle={{ template: "m15pw" }} />,
    );
    const name = container.querySelector(`span[title="${title}"]`) as HTMLElement;
    expect(name.style.maxWidth).toBe(cqw(detachedCostTitleWidthPct(P, cost)!));
    expect(name.style.textOverflow).toBe("ellipsis");
  });

  it("sets a long name at its fitted size, whole (Miner the Miner, Damned Delver)", () => {
    const cost = "{1}{R}{W}{B}";
    const title = "Miner the Miner, Damned Delver";
    const fit = fitDetachedCostTitle(P, title, cost)!;
    expect(fit.sizePct).toBeLessThan(P.title.sizePct);
    const { bandTag, span } = titleBand(title, cost);
    expect(bandTag).toContain(`font-size:${cqw(fit.sizePct)}`);
    // Drawn as one run with no-break spaces, like every display line.
    expect(span.endsWith(`>${displayLine(title)}`)).toBe(true);
  });

  it("past the 5 pt floor draws the cut name with its own '…' (a 14-symbol cost, both frames)", () => {
    const cost = "{W}".repeat(14);
    const title = "Skeptic, the Endlessly Wandering Walker of Worlds";
    for (const template of ["m15pw", "modern"] as const) {
      const fit = fitDetachedCostTitle(getFrameProfile(template), title, cost)!;
      expect(fit.text.endsWith("…")).toBe(true);
      const { bandTag, span } = titleBand(title, cost, template);
      expect(bandTag).toContain(`font-size:${cqw(fit.sizePct)}`);
      // The drawn text is the cut one; the tooltip keeps the whole name.
      expect(span.endsWith(`>${displayLine(fit.text)}`)).toBe(true);
    }
  });

  it("keeps a name that fits at the slot's size", () => {
    const { bandTag, span } = titleBand("Kikyo Zoldyck", "{1}{R}{W}{B}");
    expect(bandTag).toContain(`font-size:${cqw(P.title.sizePct)}`);
    expect(span.endsWith(`>${displayLine("Kikyo Zoldyck")}`)).toBe(true);
  });

  it("leaves an inline cost's name (and a cost-less name) uncapped", () => {
    const { container } = render(
      <CardPreview title="Serra Angel" cost="{3}{W}{W}" cardType="creature" colorIdentity={["white"]} frameStyle={{ template: "m15" }} />,
    );
    expect((container.querySelector('span[title="Serra Angel"]') as HTMLElement).style.maxWidth).toBe("");
    cleanup();
    const { container: noCost } = render(
      <CardPreview title="Probe" cardType="planeswalker" colorIdentity={["white"]} loyalty="3" frameStyle={{ template: "m15pw" }} />,
    );
    expect((noCost.querySelector('span[title="Probe"]') as HTMLElement).style.maxWidth).toBe("");
  });
});
