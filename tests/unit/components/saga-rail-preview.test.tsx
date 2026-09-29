import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { parseChapters, parseSagaIntro } from "@/lib/cards/card-display";
import { layoutSagaRail, sagaBadgeWidthPx, sagaRailMetrics, sagaRailPx } from "@/lib/cards/saga-rail";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The live-preview half of the saga rail's v33 text (TODO 3.29, owner
// decision 2026-09-28: correctness only): ChapterRail draws the intro and
// every chapter as lib/cards/saga-rail.ts's lines, at the HD bake's px, with
// real pips and U+2212 as the hyphen — the bake half is pinned on real bakes
// in tests/unit/render/walker-saga-bake.test.tsx. Server markup (happy-dom
// drops cqw lengths).
// ---------------------------------------------------------------------------

const SLOT = getFrameProfile("saga").chapters!;
const hd = (px: number) => `${((px * 100) / 1500).toFixed(4)}cqw`;
const DOM_122 =
  "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)\nI — This Saga deals 1 damage to each creature without flying.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain. If you do, this Saga deals 3 damage to each creature.";

const saga = (rulesText: string) =>
  renderToStaticMarkup(
    <CardPreview
      title="The First Eruption"
      cost="{2}"
      cardType="enchantment"
      subtypes={["Saga"]}
      colorIdentity={["red"]}
      rulesText={rulesText}
      frameStyle={{ template: "saga" }}
    />,
  );

describe("CardPreview — the saga rail's text (layout v33)", () => {
  it("draws DOM #122's 'Add {R}{R}.' as two red pips, never the braces", () => {
    const html = saga(DOM_122);
    expect(html.match(/class="ms ms-cost ms-shadow ms-r"/g)).toHaveLength(2);
    expect(html).not.toContain("{R}");
  });

  it("draws exactly the layout's lines — the intro's and every chapter's — at the HD bake's sizes", () => {
    const html = saga(DOM_122);
    const rail = layoutSagaRail(SLOT, parseSagaIntro(DOM_122), parseChapters(DOM_122));
    const count = [...(rail.intro ?? []), ...rail.chapters.flatMap((c) => c.blocks)].reduce((n, b) => n + b.lines.length, 0);
    const lines = html.match(/<div data-rules-line="" style="[^"]*"/g)!;
    expect(lines).toHaveLength(count);
    const m = sagaRailMetrics(rail, "hd");
    // v32's sizes: 44 px chapters and 40 px intro at HD (2.933 / 2.667 cqw).
    expect(m.chapter.fontPx).toBe(44);
    expect(m.intro.fontPx).toBe(40);
    expect(html).toContain(`font-size:${hd(44)}`);
    expect(html).toContain(`font-size:${hd(40)}`);
    for (const line of lines) expect(line).toMatch(new RegExp(`height:(${hd(m.chapter.linePx)}|${hd(m.intro.linePx)})`));
  });

  it("gives each marker badge the width its chapter's lines were broken beside", () => {
    const rules = "I — Draw a card.\nII, III, IV — Scry 2.";
    const html = saga(rules);
    const px = sagaRailPx(SLOT, "hd");
    expect(html).toContain(`width:${hd(sagaBadgeWidthPx("I", px))}`);
    expect(html).toContain(`width:${hd(sagaBadgeWidthPx("II,III,IV", px))}`);
    expect(sagaBadgeWidthPx("II,III,IV", px)).toBeGreaterThan(px.badge);
  });

  it("draws U+2212 as the hyphen the bake draws (the advance the lines were measured with)", () => {
    const html = saga("I — Put a −1/−1 counter on target creature.\nII — Draw a card.");
    expect(html).toContain(">-1/-1<");
    expect(html).not.toContain("−");
  });
});
