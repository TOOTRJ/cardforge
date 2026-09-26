// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { parseLoyaltyAbilities } from "@/lib/cards/card-display";
import { LOYALTY_ROW, layoutLoyaltyRows } from "@/lib/cards/loyalty-rows";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { detachedCostTitleWidthPct } from "@/lib/cards/title-band";

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
    const { rowFractions } = layoutLoyaltyRows({
      abilities: parseLoyaltyAbilities(WALKER_115),
      rect: P.rules.rect,
      baseSizePct: P.rules.sizePct,
      aspect: 7 / 5,
    });
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
    const { sizePct } = layoutLoyaltyRows({
      abilities: parseLoyaltyAbilities(WALKER_115),
      rect: P.rules.rect,
      baseSizePct: P.rules.sizePct,
      aspect: 7 / 5,
    });
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
