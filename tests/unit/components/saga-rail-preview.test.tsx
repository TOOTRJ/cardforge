import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardPreview } from "@/components/cards/card-preview";
import { parseChapters, parseSagaIntro } from "@/lib/cards/card-display";
import { rulesDraw } from "@/lib/cards/rules-box";
import { pxBoxRect, sagaRail, sagaRailDrawing, sagaRailPieces } from "@/lib/cards/saga-rail";
import { getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The live-preview half of the saga's printed rail (TODO 4.21c): CardPreview
// draws EXACTLY lib/cards/saga-rail.ts's drawing at the HD bake's px — the
// reminder block and every chapter as rules layouts in their own boxes, each
// badge and divider at its box (the pack's bitmaps, frame pieces under the
// finishes), each numeral in its line box — scaled to the card (percents and
// cqw). The bake half is pinned on real bakes in tests/unit/render/
// walker-saga-bake.test.tsx. Server markup (happy-dom drops cqw lengths).
// ---------------------------------------------------------------------------

const SLOT = getFrameProfile("saga").chapters!;
const cqw = (px: number) => `${((px * 100) / 1500).toFixed(4)}cqw`;
const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)";
const DOM_21 = `${REMINDER}\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.`;
const DOM_122 = `${REMINDER}\nI — This Saga deals 1 damage to each creature without flying.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain. If you do, this Saga deals 3 damage to each creature.`;

const saga = (rulesText: string | null, over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <CardPreview
      title="The First Eruption"
      cost="{2}"
      cardType="enchantment"
      subtypes={["Saga"]}
      colorIdentity={["red"]}
      rulesText={rulesText}
      frameStyle={{ template: "saga" }}
      {...over}
    />,
  );
const drawing = (rules: string) => sagaRailDrawing(sagaRail(SLOT, parseSagaIntro(rules), parseChapters(rules)), "hd");
const pct = (v: number) => `${v}%`;
/** Each `data-saga-piece` element's kind and inline box. */
function pieces(html: string) {
  return [...html.matchAll(/data-saga-piece="(badge|divider)"[^>]*style="([^"]*)"/g)].map((m) => {
    const box = (prop: string) => new RegExp(`(?:^|;)${prop}:([^;]+)`).exec(m[2])?.[1];
    return { kind: m[1], top: box("top"), left: box("left"), width: box("width"), height: box("height"), image: /background-image:url\(([^)]+)\)/.exec(m[2])?.[1] };
  });
}

describe("CardPreview — the saga's printed rail", () => {
  it("draws every badge and divider at the layout's box, as frame pieces under the text", () => {
    const html = saga(DOM_21);
    const d = drawing(DOM_21);
    const want = sagaRailPieces(d, SLOT);
    const got = pieces(html);
    expect(got.map((p) => p.kind)).toEqual(["divider", "divider", "badge", "badge", "badge"]);
    got.forEach((p, i) => {
      expect([p.top, p.left, p.width, p.height]).toEqual([pct(want[i].rect.topPct), pct(want[i].rect.leftPct), pct(want[i].rect.widthPct), pct(want[i].rect.heightPct)]);
    });
    // The pack's bitmaps from the frames bucket (the browser's WebP).
    expect(got[0].image).toContain("saga/chapter/divider.");
    expect(got[2].image).toContain("saga/chapter/badge.");
    for (const p of got) expect(p.image).toMatch(/\.webp/);
    // …in the frame's layer (z 5), before every text layer (z 20).
    expect(html).toMatch(/data-saga-rail-pieces=""[^>]*style="z-index:5"/);
    expect(html.indexOf("data-saga-rail-pieces")).toBeLessThan(html.indexOf('data-testid="rules-box"'));
    // The first badge's box: 118 × 132 px from x 58 at HD.
    const first = d.rows[0].badges[0];
    expect(pxBoxRect(first, d)).toMatchObject({ leftPct: (58 / 1500) * 100, widthPct: (118 / 1500) * 100, heightPct: (132 / 2100) * 100 });
  });

  it("draws the reminder block and each chapter as the layout's lines, at the HD bake's sizes", () => {
    const html = saga(DOM_122);
    const d = drawing(DOM_122);
    const boxes = [...html.matchAll(/data-testid="rules-box" data-rules-size="(\d+)" style="([^"]*)"/g)];
    // The reminder at 62 px, then the three chapters at 64.
    expect(boxes.map((b) => Number(b[1]))).toEqual([62, 64, 64, 64]);
    const layouts = [d.intro!, ...d.rows.map((row) => row.text)];
    boxes.forEach((b, i) => {
      const rect = layouts[i].input.rect;
      expect(b[2]).toContain(`top:${rect.topPct}%`);
      expect(b[2]).toContain(`height:${rect.heightPct}%`);
      // (RulesBox writes its own lengths to three decimals.)
      expect(b[2]).toContain(`font-size:${((rulesDraw(layouts[i], "hd").fontPx * 100) / 1500).toFixed(3)}cqw`);
    });
    const lines = layouts.reduce((n, l) => n + l.blocks.reduce((m, block) => m + block.lines.length, 0), 0);
    expect(html.match(/data-testid="rules-line"/g)).toHaveLength(lines);
    // The reminder is italic throughout.
    const intro = /data-rules-size="62"[\s\S]*?(?=data-testid="rules-box")/.exec(html)![0];
    expect(intro.match(/font-style:italic/g)!.length).toBeGreaterThanOrEqual(15);
  });

  it("draws each numeral in the layout's line box: MPlantin, one em tall, centred on its badge", () => {
    const html = saga(DOM_21);
    const d = drawing(DOM_21);
    const numerals = [...html.matchAll(/data-saga-numeral="([^"]+)" style="([^"]*)"/g)];
    const badges = d.rows.flatMap((row) => row.badges);
    expect(numerals.map((n) => n[1])).toEqual(["I", "II", "III"]);
    numerals.forEach((n, i) => {
      const b = badges[i];
      expect(n[2]).toContain(`left:${((b.left * 100) / 1500).toFixed(4)}%`);
      expect(n[2]).toContain(`top:${((b.labelTop * 100) / 2100).toFixed(4)}%`);
      expect(n[2]).toContain(`width:${((b.width * 100) / 1500).toFixed(4)}%`);
      expect(n[2]).toContain(`height:${cqw(b.fontPx)}`);
      expect(n[2]).toContain(`font-size:${cqw(b.fontPx)}`);
      expect(n[2]).toContain("line-height:1");
      expect(n[2]).toContain("justify-content:center");
      expect(n[2]).toContain("MPlantin");
    });
    expect(badges.every((b) => b.fontPx === 72)).toBe(true);
  });

  it("starts the rows at the rail's own top when the saga has no reminder, with no divider on the first", () => {
    const rules = DOM_21.replace(`${REMINDER}\n`, "");
    const html = saga(rules);
    const d = drawing(rules);
    expect(d.intro).toBeNull();
    expect(pieces(html).map((p) => p.kind)).toEqual(["divider", "badge", "badge", "badge"]);
    const first = /data-testid="rules-box" data-rules-size="\d+" style="([^"]*)"/.exec(html)![1];
    expect(first).toContain(`top:${(237 / 2100) * 100}%`);
    expect(d.rows[0].top).toBe(237);
  });

  it("draws a reminder that outgrew its box where the layout set it: the chapters' column, the rows and the first divider under it", () => {
    // 300 characters: more than the reminder's box holds at the ladder's floor.
    const long = `${REMINDER.slice(0, -1)} Whenever you cast your second spell each turn, put another lore counter on this Saga. If it would leave the battlefield, exile it with three time counters on it instead. Skipped chapters don't trigger.)`;
    const rules = DOM_21.replace(REMINDER, long);
    const html = saga(rules);
    const rail = sagaRail(SLOT, parseSagaIntro(rules), parseChapters(rules));
    const d = sagaRailDrawing(rail, "hd");
    expect(rail.introGrown).toBe(true);
    const boxes = [...html.matchAll(/data-testid="rules-box" data-rules-size="(\d+)" style="([^"]*)"/g)];
    // The reminder at the ladder's floor, in the chapters' column from the
    // rail's top — the layout's box, not the fixed one.
    expect(Number(boxes[0][1])).toBe(42);
    const rect = d.intro!.input.rect;
    expect(rect.leftPct).toBe(SLOT.rect.leftPct);
    expect(rect.heightPct).toBeGreaterThan(SLOT.intro.rect.heightPct);
    for (const [prop, value] of [["top", rect.topPct], ["left", rect.leftPct], ["width", rect.widthPct], ["height", rect.heightPct]] as const) {
      expect(boxes[0][2]).toContain(`${prop}:${value}%`);
    }
    // The first row and its divider under it, lower than the frame's first divider.
    expect(d.rows[0].top).toBeGreaterThan(621);
    expect(boxes[1][2]).toContain(`top:${d.rows[0].text.input.rect.topPct}%`);
    const want = sagaRailPieces(d, SLOT);
    const got = pieces(html);
    expect(got.map((p) => p.kind)).toEqual(["divider", "divider", "badge", "badge", "badge"]);
    got.forEach((p, i) => expect([p.top, p.left]).toEqual([pct(want[i].rect.topPct), pct(want[i].rect.leftPct)]));
    expect(html.match(/data-testid="rules-line"/g)).toHaveLength([d.intro!, ...d.rows.map((row) => row.text)].reduce((n, l) => n + l.blocks.reduce((m, block) => m + block.lines.length, 0), 0));
  });

  it("draws DOM #122's 'Add {R}{R}.' as two red pips and U+2212 as the hyphen the bake draws", () => {
    const html = saga(DOM_122);
    expect(html.match(/data-pip="r"/g)).toHaveLength(2);
    expect(html).not.toContain("{R}");
    const minus = saga("I — Put a −1/−1 counter on target creature.\nII — Draw a card.");
    expect(minus).toContain(">-1/-1<");
    expect(minus).not.toContain("−");
  });

  it("draws a combined marker as ONE badge with its fitted label", () => {
    const rules = `${REMINDER}\nI, II, III, IV, V, VI, VII — Scry 1.\nVIII — You win the game.`;
    const html = saga(rules);
    const d = drawing(rules);
    expect([...html.matchAll(/data-saga-numeral="([^"]+)"/g)].map((m) => m[1])).toEqual(["I–VII", "VIII"]);
    expect(pieces(html).filter((p) => p.kind === "badge")).toHaveLength(2);
    for (const b of d.rows.flatMap((row) => row.badges)) {
      expect(b.fontPx).toBeLessThan(72);
      expect(html).toContain(`font-size:${cqw(b.fontPx)}`);
    }
  });

  it("shows the editor's hint on an empty rail, and nothing of the rail on a textless override", () => {
    const empty = saga(null);
    expect(empty).toContain("Add chapters as I — / II — / III — lines.");
    expect(empty).not.toContain("data-saga-piece");
    expect(saga(DOM_21)).not.toContain("Add chapters as");
    const textless = saga(DOM_21, { profileOverrides: { saga: { textless: true } } });
    expect(textless).not.toContain("data-saga-piece");
    expect(textless).not.toContain("data-saga-numeral");
  });
});
