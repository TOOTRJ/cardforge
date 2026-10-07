import { describe, expect, it } from "vitest";
import { parseChapters, parseSagaIntro, type SagaChapter } from "@/lib/cards/card-display";
import {
  RULES_TARGETS,
  RULES_TARGET_SCALE,
  blockHeightPx,
  inkEntersRect,
  layoutRulesAt,
  linePositions,
  rectPx,
  rulesLadderPx,
  rulesTargetFor,
  type RulesLayout,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import {
  SAGA_RAIL,
  combinedSagaLabel,
  profileSagaRail,
  sagaLabelSizePx,
  sagaNumerals,
  sagaRail,
  sagaRailAssetPaths,
  sagaRailDrawing,
  sagaRailPieces,
  type SagaRail,
} from "@/lib/cards/saga-rail";
import { SAGA_BADGE_PITCH_PX, SAGA_NUMERAL_SIZE_PX, getFrameProfile } from "@/lib/cards/template-layout";
import { RULES_SIZE_PX, rulesPxToPct } from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// The saga's printed rail (TODO 4.21c = 3.7): lib/cards/saga-rail.ts decides
// the reminder block, where the rows start, each row's height, the ONE text
// size, the badge stacks and their pitch, the combined marker and every
// position at both bake targets — from the geometry on FrameProfile.chapters,
// measured on the prints (Scryfall PNGs at 1500 × 2100) and on Card
// Conjurer's saga pack. Real-pixel checks: tests/unit/render/
// walker-saga-bake.test.tsx; the preview's twin: tests/unit/components/
// saga-rail-preview.test.tsx; the walker rows it shares its row arithmetic
// with, pinned: tests/unit/cards/loyalty-rows-pinned.test.ts.
// ---------------------------------------------------------------------------

const SAGA = getFrameProfile("saga");
const SLOT = SAGA.chapters!;
const ASPECT = 7 / 5;
const REMINDER = "(As this Saga enters and after your draw step, add a lore counter. Sacrifice after III.)";
const hdPx = (pct: number, of: number) => (pct / 100) * of;

const rail = (rules: string) => sagaRail(SLOT, parseSagaIntro(rules), parseChapters(rules));
const chapters = (rows: [numerals: string, text: string][]): SagaChapter[] => rows.map(([marker, text]) => ({ marker, text }));
const linesOf = (layout: RulesLayout) =>
  layout.blocks.flatMap((b) => b.lines.map((l) => l.runs.map((run) => run.map((it) => (it.t === "m" ? `{${it.suffix}}` : it.v)).join("")).join(" ")));
/** A row's natural height at a target, computed apart from the rail: its
 *  text block at the rail's size with the row's padding, or its stack. */
function natural(r: SagaRail, i: number, target: RulesTarget): number {
  const scale = RULES_TARGET_SCALE[target];
  const text = blockHeightPx(r.rows[i].text, target) + 2 * Math.round(SAGA_RAIL.rowPadYPx * scale);
  const count = r.rows[i].labels.length;
  const badge = Math.round((SLOT.badge.heightPct / 100) * Math.round(1500 * scale * ASPECT));
  const stack = count > 0 ? badge + (count - 1) * r.pitchPx * scale : 0;
  return Math.max(text, stack);
}

const DOM_21 = `${REMINDER}\nI, II — Create a 2/2 white Knight creature token with vigilance.\nIII — Knights you control get +2/+1 until end of turn.`;
const DOM_122 = `${REMINDER}\nI — This Saga deals 1 damage to each creature without flying.\nII — Add {R}{R}.\nIII — Sacrifice a Mountain. If you do, this Saga deals 3 damage to each creature.`;
const LTC_58 = `${REMINDER.replace("III", "IV")}\nI, II, III — Create a 3/3 black Wraith creature token with menace. The Ring tempts you.\nIV — For each opponent, gain control of up to one target creature that player controls until end of turn. Untap those creatures. They gain haste until end of turn. The Ring tempts you.`;
const WHO_99 = `${REMINDER.replace("III", "VI")}\nI — Create a Treasure token.\nII, III, IV, V, VI — Create a token that's a copy of target non-Saga token you control.`;
const LTR_174 = `${REMINDER.replace("III", "VI")}\nI, II, III, IV, V, VI — Note a creature type that hasn't been noted for this Saga. When you next cast a creature spell of that type this turn, that creature enters with an additional +1/+1 counter on it.`;
/** A reminder of exactly `chars` characters (the editor takes 400). */
const LONG_REMINDER =
  "(As this Saga enters and after your draw step, add a lore counter. Whenever you cast a historic spell, you may put an additional lore counter on this Saga. If this Saga would leave the battlefield, exile it with three time counters on it instead and it gains suspend. Skipped chapters do not trigger. Players can't remove lore counters from it during their own turn unless a spell or ability says so. Sacrifice after III.)";
const reminderOf = (chars: number) => `${LONG_REMINDER.slice(0, chars - 1).trimEnd()})`;
const LONG =
  "Search your library for any number of creature cards with total mana value 10 or less, put them onto the battlefield, then shuffle. They gain haste until end of turn. At the beginning of the next end step, return them to their owners' hands, then each opponent loses 2 life for each creature returned this way.";

describe("the bake targets", () => {
  it("draws the HD target at the HD bake's width and the 750 px one below it, in both orientations", () => {
    expect(rulesTargetFor(1500, "portrait")).toBe("hd");
    expect(rulesTargetFor(750, "portrait")).toBe("default");
    expect(rulesTargetFor(2100, "landscape")).toBe("hd");
    expect(rulesTargetFor(1050, "landscape")).toBe("default");
  });
});

describe("the rail on the profile — the prints' geometry, HD px", () => {
  it("puts the chapter text in the pack's 525 px column 3 px right of it, from the rail's top to its foot", () => {
    const box = rectPx(SLOT.rect, "portrait", ASPECT, "hd");
    expect([box.left, box.right]).toEqual([203, 728]); // the prints' ink starts at 204–206
    expect([box.top, box.bottom]).toEqual([237, 1759]); // 11.29 %H → the window's bottom edge
    expect(SLOT.sizePct).toBe(rulesPxToPct(RULES_SIZE_PX.compact)); // 64 px, the prints' 7.5 pt
    expect(Math.round(64 * SLOT.lineHeight!)).toBe(62); // …on the prints' 62 px pitch
  });

  it("starts the rows under a reminder at the prints' first divider, 621 px", () => {
    expect(Math.round(hdPx(SLOT.rowsTopPct, 2100))).toBe(621);
  });

  it("gives the reminder its own box and size: x 132–736 from the rail's top, 62 px on a 62 px pitch", () => {
    const box = rectPx(SLOT.intro.rect, "portrait", ASPECT, "hd");
    expect([box.left, box.right, box.top]).toEqual([132, 736, 237]);
    expect(box.bottom).toBeLessThan(621);
    expect(SLOT.intro.sizePct).toBe(rulesPxToPct(62));
    expect(Math.round(62 * SLOT.intro.lineHeight!)).toBe(62);
  });

  it("draws the pack's badge (118 × 132 from x 58, centred on x 117) and divider (x 150–742, 6 px)", () => {
    expect(Math.round(hdPx(SLOT.badge.leftPct, 1500))).toBe(58);
    expect(Math.round(hdPx(SLOT.badge.leftPct + SLOT.badge.widthPct, 1500)) - 58).toBe(118);
    expect(Math.round(hdPx(SLOT.badge.heightPct, 2100))).toBe(132);
    expect(Math.round(hdPx(SLOT.divider.leftPct, 1500))).toBe(150);
    expect(Math.round(hdPx(SLOT.divider.leftPct + SLOT.divider.widthPct, 1500))).toBe(742);
    expect(Math.round(hdPx(SLOT.divider.heightPct, 2100))).toBe(6);
    expect(SLOT.badge.assetPath).toBe("/frames/saga/chapter/badge.png");
    expect(SLOT.divider.assetPath).toBe("/frames/saga/chapter/divider.png");
  });

  it("stacks badges 160 px apart where there is room (DOM #21) down to 138 (LTC #58) — even, so 750 draws half", () => {
    expect(SAGA_BADGE_PITCH_PX).toEqual({ min: 138, max: 160 });
    expect(hdPx(SLOT.badge.pitchPct.min, 2100)).toBeCloseTo(138, 9);
    expect(hdPx(SLOT.badge.pitchPct.max, 2100)).toBeCloseTo(160, 9);
    expect(SAGA_NUMERAL_SIZE_PX % 2).toBe(0);
    expect(SLOT.badge.numeralSizePct * 1500).toBeCloseTo(SAGA_NUMERAL_SIZE_PX, 9);
  });
});

describe("where the rows start", () => {
  it("under the reminder block when the saga has one: 621 → 1759 px", () => {
    const r = rail(DOM_21);
    expect(r.intro).not.toBeNull();
    const box = rectPx(r.rowsRect, "portrait", ASPECT, "hd");
    expect([box.top, box.bottom, box.left, box.right]).toEqual([621, 1759, 203, 728]);
  });

  it("from the rail's own top when it has none — no empty reminder band, no generated reminder (owner 2026-09-29)", () => {
    for (const intro of [null, undefined, "", "   "]) {
      const r = sagaRail(SLOT, intro, parseChapters(DOM_21));
      expect(r.intro, JSON.stringify(intro)).toBeNull();
      const box = rectPx(r.rowsRect, "portrait", ASPECT, "hd");
      expect([box.top, box.bottom]).toEqual([237, 1759]);
    }
  });

  it("is the frame's rail or nothing: a profile without a rail has no rail", () => {
    expect(profileSagaRail(getFrameProfile("m15"), { intro: null, chapters: parseChapters(DOM_21) })).toBeNull();
    expect(profileSagaRail(SAGA, null)).toBeNull();
    expect(profileSagaRail(SAGA, { intro: null, chapters: parseChapters(DOM_21) })?.rows).toHaveLength(2);
  });
});

describe("the reminder block", () => {
  it("sets the standard reminder in the prints' four lines, on the prints' baselines (341 / 403 / 465 / 527 px)", () => {
    const { intro } = rail(DOM_21);
    expect(intro!.sizePx).toBe(62);
    expect(linesOf(intro!)).toEqual(["(As this Saga enters", "and after your draw", "step, add a lore counter.", "Sacrifice after III.)"]);
    const placed = linePositions(intro!, "hd");
    expect(placed.lines.map((l) => l.top + placed.metrics.baselinePx.italic)).toEqual([341, 403, 465, 527]);
    // …and at 750: the same lines, half the size.
    expect(linePositions(intro!, "default").metrics.fontPx).toBe(31);
  });

  it("keeps the text's own emphasis, as the prints set it: the reminder italic, a keyword before it roman, pips as pips", () => {
    // DMU #85: "Read ahead (Choose a chapter and start with that many lore
    // counters. …)" — v33 set the whole block italic.
    const { intro } = rail("Read ahead (Choose a chapter. Add {R} after your draw step.)\nI — Draw a card.");
    const items = intro!.blocks.flatMap((b) => b.lines.flatMap((l) => l.runs.flat()));
    const words = items.filter((it) => it.t === "w");
    expect(words.filter((it) => it.t === "w" && !it.em).map((it) => (it.t === "w" ? it.v : ""))).toEqual(["Read", "ahead"]);
    expect(words.filter((it) => it.t === "w" && it.em).length).toBe(words.length - 2);
    expect(items.filter((it) => it.t === "m").map((it) => (it.t === "m" ? it.suffix : ""))).toEqual(["r"]);
    // The standard reminder is one parenthesis: italic throughout.
    const standard = rail(DOM_21).intro!.blocks.flatMap((b) => b.lines.flatMap((l) => l.runs.flat()));
    expect(standard.every((it) => it.t !== "w" || it.em === "reminder")).toBe(true);
  });

  it("steps a long reminder down its own ladder inside its fixed box — and never moves the rows", () => {
    const longer = `${REMINDER.slice(0, -1)} Whenever you cast your second spell each turn, put another lore counter on it.)`;
    const [short, long] = [rail(DOM_21), rail(DOM_21.replace(REMINDER, longer))];
    expect(long.intro!.sizePx).toBeLessThan(62);
    expect(rulesLadderPx(SLOT.intro.sizePct)).toContain(long.intro!.sizePx);
    expect(long.intro!.clipped).toBe(false);
    for (const t of RULES_TARGETS) expect(long.intro!.checks[t].overflowPx).toBeLessThanOrEqual(0);
    expect(long.intro!.input.rect).toEqual(SLOT.intro.rect);
    // The rows: the same box, shares, size and lines.
    expect(long.rowsRect).toEqual(short.rowsRect);
    expect(long.rowFractions).toEqual(short.rowFractions);
    expect(long.sizePx).toBe(short.sizePx);
    expect(long.rows.map((row) => linesOf(row.text))).toEqual(short.rows.map((row) => linesOf(row.text)));
  });

  it("keeps the reminder's lines out of the fold's corner — the frame paints the box's bottom-left", () => {
    // The fold's edge inside the box, HD px: x 133 at y 572, 138 at 580, 144
    // at 588, 151 at 596 — three steps of the curve.
    expect(SLOT.intro.keepOuts!.map((k) => rectPx(k, "portrait", ASPECT, "hd")).map((k) => [k.left, k.right, k.top, k.bottom])).toEqual([
      [0, 138, 572, 580],
      [0, 144, 580, 588],
      [0, 152, 588, 597],
    ]);
    const bare = { ...SLOT, intro: { ...SLOT.intro, keepOuts: undefined } };
    const onFold = (r: SagaRail) => RULES_TARGETS.some((t) => SLOT.intro.keepOuts!.some((k) => inkEntersRect(r.intro!, k, t)));
    let moved = 0;
    for (let chars = 90; chars <= 240; chars += 10) {
      const rules = parseChapters(DOM_21);
      const [free, kept] = [sagaRail(bare, reminderOf(chars), rules), sagaRail(SLOT, reminderOf(chars), rules)];
      // In its fixed box, never on the fold — where the box alone would
      // have put a last line on it, the reminder is a step smaller.
      expect(kept.introGrown, `${chars}`).toBe(false);
      expect(kept.intro!.input.rect, `${chars}`).toEqual(SLOT.intro.rect);
      expect(kept.intro!.clipped, `${chars}`).toBe(false);
      expect(onFold(kept), `${chars}`).toBe(false);
      expect(kept.intro!.sizePx, `${chars}`).toBeLessThanOrEqual(free.intro!.sizePx);
      if (onFold(free)) {
        expect(kept.intro!.sizePx, `${chars}`).toBeLessThan(free.intro!.sizePx);
        moved += 1;
      } else {
        expect(kept.intro!.sizePx, `${chars}`).toBe(free.intro!.sizePx);
      }
    }
    expect(moved).toBeGreaterThan(3);
    // The standard reminder and a read-ahead one never came near it.
    expect(rail(DOM_21).intro!.sizePx).toBe(62);
    expect(sagaRail(bare, parseSagaIntro(DOM_21), parseChapters(DOM_21)).intro!.sizePx).toBe(62);
  });

  it("lets a reminder its box can't hold at the floor OUTGROW it: the floor size, the chapters' column, the rows under it", () => {
    // 300 characters — the editor takes 400, and layout v41 drew every one
    // in full (its intro took the height it needed).
    const r = sagaRail(SLOT, reminderOf(300), parseChapters(DOM_21));
    expect(r.introGrown).toBe(true);
    expect(r.intro!.sizePx).toBe(RULES_SIZE_PX.floor);
    expect(r.intro!.clipped).toBe(false);
    expect(r.intro!.input.vAlign).toBe("start");
    for (const t of RULES_TARGETS) expect(r.intro!.checks[t].overflowPx, t).toBeLessThanOrEqual(0);
    // The chapters' column (203–728 px: clear of the fold and of the
    // ribbon), from the rail's top, on whole even px…
    const box = rectPx(r.intro!.input.rect, "portrait", ASPECT, "hd");
    expect([box.left, box.right, box.top]).toEqual([203, 728, 237]);
    expect(box.height % 2).toBe(0);
    expect(box.bottom).toBeGreaterThan(597);
    // …just as tall as its lines with the rows' padding above and below.
    const placed = linePositions(r.intro!, "hd");
    const last = placed.lines.at(-1)!;
    expect(placed.lines[0].top).toBe(237 + SAGA_RAIL.rowPadYPx);
    expect(placed.metrics.fontPx).toBe(42);
    expect(box.bottom - (last.top + last.height)).toBeGreaterThanOrEqual(SAGA_RAIL.rowPadYPx);
    expect(box.bottom - (last.top + last.height)).toBeLessThanOrEqual(SAGA_RAIL.rowPadYPx + 3);
    // The rows start the frame's gap under it — the fixed box's foot to the
    // first divider, 24 px — at both targets, a divider on the first.
    const rows = rectPx(r.rowsRect, "portrait", ASPECT, "hd");
    expect(rows.top - box.bottom).toBe(24);
    expect(rows.top).toBeGreaterThan(621);
    expect(rows.bottom).toBe(1759);
    const small = { box: rectPx(r.intro!.input.rect, "portrait", ASPECT, "default"), rows: rectPx(r.rowsRect, "portrait", ASPECT, "default") };
    expect(small.rows.top - small.box.bottom).toBe(12);
    for (const t of RULES_TARGETS) {
      const d = sagaRailDrawing(r, t);
      expect(d.rows[0].divider, t).not.toBeNull();
      expect(d.rows[0].top, t).toBe(rectPx(r.rowsRect, "portrait", ASPECT, t).top);
    }
    // The rows fit themselves in what is left: same lines as under the
    // standard reminder, their shares of a shorter box.
    expect(r.clipped).toBe(false);
    expect(r.rowFractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(r.rows.map((row) => linesOf(row.text))).toEqual(rail(DOM_21).rows.map((row) => linesOf(row.text)));
  });

  it("draws a one-paragraph reminder of the editor's 400 characters in full over two, three and six chapters — it grows, the rows give way", () => {
    const six = chapters(["I", "II", "III", "IV", "V", "VI"].map((n) => [n, "Create a 2/2 white Knight creature token with vigilance."]));
    for (const rows of [parseChapters(DOM_21), parseChapters(LTC_58), six]) {
      for (let chars = 90; chars <= 400; chars += 10) {
        const r = sagaRail(SLOT, reminderOf(chars), rows);
        const label = `${chars} characters over ${rows.length} rows`;
        expect(r.intro!.clipped, label).toBe(false);
        for (const t of RULES_TARGETS) expect(r.intro!.checks[t].fits, `${label} (${t})`).toBe(true);
        expect(r.introGrown, label).toBe(chars >= 250);
        expect(r.intro!.input.rect.leftPct, label).toBe(r.introGrown ? SLOT.rect.leftPct : SLOT.intro.rect.leftPct);
        // The rows still hold their badges, in a box that ends at the foot.
        const d = sagaRailDrawing(r, "hd");
        expect(d.rows.at(-1)!.bottom, label).toBe(1759);
        for (const row of d.rows) {
          expect(row.badges[0].top, label).toBeGreaterThanOrEqual(row.top);
          expect(row.badges.at(-1)!.top + 132, label).toBeLessThanOrEqual(row.bottom);
        }
      }
    }
    // Four hundred characters over three short chapters: nothing clips.
    const full = sagaRail(SLOT, reminderOf(400), parseChapters(DOM_122));
    expect([full.introGrown, full.intro!.clipped, full.clipped]).toEqual([true, false, false]);
  });

  it("grows no further than the rows' badges allow: over six chapters fifteen lines, past which it clips from its tail", () => {
    // Six rows keep a badge (132 px) and 2 px each — 804 px of the rail's
    // 1522 — so the reminder's box ends at 929 px: fifteen lines at the
    // floor (42 px on a 42 px pitch, the rows' 14 px above and below). This
    // text fills them at about 450 characters (over ONE chapter it runs to
    // about 900). Inside the editor's 400 a one-paragraph reminder reaches
    // that only over six chapters, with words wide enough for sixteen
    // lines; one with line breaks sooner (below).
    const six = chapters(["I", "II", "III", "IV", "V", "VI"].map((n) => [n, "Draw a card."]));
    const boxOf = (r: SagaRail) => rectPx(r.intro!.input.rect, "portrait", ASPECT, "hd");
    const longerOf = (chars: number) => `${LONG_REMINDER.repeat(2).slice(0, chars - 1).trimEnd()})`;
    expect([LONG_REMINDER.length, longerOf(460).length]).toEqual([422, 460]);
    const fits = sagaRail(SLOT, longerOf(440), six);
    expect([fits.introGrown, fits.intro!.clipped, fits.clipped]).toEqual([true, false, false]);
    expect(linePositions(fits.intro!, "hd").lines).toHaveLength(15);
    expect([boxOf(fits).top, boxOf(fits).bottom]).toEqual([237, 895]);
    const over = sagaRail(SLOT, longerOf(460), six);
    expect([over.introGrown, over.intro!.clipped]).toEqual([true, true]);
    expect(linePositions(over.intro!, "hd").lines).toHaveLength(16);
    expect([boxOf(over).top, boxOf(over).bottom]).toEqual([237, 929]);
    expect(rectPx(over.rowsRect, "portrait", ASPECT, "hd").top).toBe(953);
    for (const row of sagaRailDrawing(over, "hd").rows) expect(row.bottom - row.top).toBeGreaterThanOrEqual(134);
    // The same 460 characters over one chapter: in full.
    expect(sagaRail(SLOT, longerOf(460), chapters([["I", "Draw a card."]])).intro!.clipped).toBe(false);
    // Paragraphs cost their gaps and their short last lines: 400 characters
    // in five of them fit over four chapters, not over six — and never push
    // a row under its badge.
    const paragraphs = reminderOf(400).replace(/\. /g, ".\n");
    expect(paragraphs.split("\n")).toHaveLength(5);
    expect(sagaRail(SLOT, paragraphs, six.slice(0, 4)).intro!.clipped).toBe(false);
    const tight = sagaRail(SLOT, paragraphs, six);
    expect([tight.introGrown, tight.intro!.clipped]).toEqual([true, true]);
    for (const row of sagaRailDrawing(tight, "hd").rows) expect(row.bottom - row.top).toBeGreaterThanOrEqual(134);
  });

  it("does not outgrow its box for a run wider than it — that clips at the box's side, as in every rules box", () => {
    const r = sagaRail(SLOT, `(${"W".repeat(60)})`, parseChapters(DOM_21));
    expect(r.intro!.clipped).toBe(true);
    expect(RULES_TARGETS.every((t) => r.intro!.checks[t].overwideRun && r.intro!.checks[t].overflowPx <= 0)).toBe(true);
    expect(r.introGrown).toBe(false);
    expect(r.intro!.input.rect).toEqual(SLOT.intro.rect);
    expect(rectPx(r.rowsRect, "portrait", ASPECT, "hd").top).toBe(621);
  });

  it("clips only a reminder no rail can hold — from its tail, the rows down to one badge each", () => {
    const r = rail(`(${"Whenever a creature enters, put a lore counter on this Saga and scry 1. ".repeat(40)})\nI — Draw a card.\nII — Draw a card.`);
    expect(r.introGrown).toBe(true);
    expect(r.intro!.sizePx).toBe(RULES_SIZE_PX.floor);
    expect(r.intro!.clipped).toBe(true);
    expect(r.intro!.input.vAlign).toBe("start");
    // The rows keep a badge (and 2 px) each: 268 px of the rail.
    const rows = rectPx(r.rowsRect, "portrait", ASPECT, "hd");
    expect(rows.bottom - rows.top).toBeGreaterThanOrEqual(2 * 134);
    expect(rows.bottom - rows.top).toBeLessThan(2 * 134 + 4);
    expect(r.clipped).toBe(false);
    for (const row of sagaRailDrawing(r, "hd").rows) expect(row.bottom - row.top).toBeGreaterThanOrEqual(132);
  });

  it("takes the whole rail when the saga is ALL reminder (no chapter markers)", () => {
    const r = rail("This saga has no chapter markers at all.");
    expect(r.rows).toEqual([]);
    const box = rectPx(r.intro!.input.rect, "portrait", ASPECT, "hd");
    expect([box.top, box.bottom]).toEqual([237, 1759]);
    // …in the chapters' column (203–728 px), clear of the ribbon the frame
    // paints below the fold (x 66–166): the reminder box's own width starts
    // at 132 px.
    expect([box.left, box.right]).toEqual([203, 728]);
    expect(r.intro!.input.rect.leftPct).toBe(SLOT.rect.leftPct);
    // With chapters the reminder keeps its own box.
    expect(rail(DOM_21).intro!.input.rect).toEqual(SLOT.intro.rect);
  });
});

describe("content-sized rows", () => {
  const SAGAS: Record<string, string> = { DOM_21, DOM_122, LTC_58, WHO_99, LTR_174, "no reminder": DOM_122.replace(`${REMINDER}\n`, "") };

  it("gives every row at least its text with the row's padding, or its stack — in the whole-px rows both bakes draw", () => {
    for (const [name, rules] of Object.entries(SAGAS)) {
      const r = rail(rules);
      expect(r.clipped, name).toBe(false);
      expect(r.rowFractions.reduce((a, b) => a + b, 0), name).toBeCloseTo(1, 9);
      for (const t of RULES_TARGETS) {
        const d = sagaRailDrawing(r, t);
        const box = rectPx(r.rowsRect, "portrait", ASPECT, t);
        expect(d.rows[0].top, name).toBe(box.top);
        expect(d.rows.at(-1)!.bottom, name).toBe(box.bottom);
        d.rows.forEach((row, i) => {
          if (i > 0) expect(row.top, name).toBe(d.rows[i - 1].bottom); // shared edges, no seam
          expect(Number.isInteger(row.top) && Number.isInteger(row.bottom), name).toBe(true);
          expect(row.bottom - row.top, `${name} row ${i} (${t})`).toBeGreaterThanOrEqual(natural(r, i, t));
        });
      }
    }
  });

  it("shares what the rail has left equally between the rows", () => {
    for (const [name, rules] of Object.entries(SAGAS)) {
      const r = rail(rules);
      const d = sagaRailDrawing(r, "hd");
      const box = rectPx(r.rowsRect, "portrait", ASPECT, "hd");
      // Each row's share is the larger of its two targets' needs; the spare
      // height past it is the same for every row (± the whole-px edges).
      const spare = d.rows.map((row, i) => row.bottom - row.top - Math.max(natural(r, i, "hd"), (natural(r, i, "default") / rectPx(r.rowsRect, "portrait", ASPECT, "default").height) * box.height));
      for (const s of spare) expect(Math.abs(s - spare[0]), `${name}: ${spare}`).toBeLessThanOrEqual(1.5);
    }
  });

  it("sets the whole rail at ONE size: the largest ladder step at which every row fits at both targets", () => {
    const dense = rail(`${REMINDER}\nI — ${LONG.slice(0, 220)}\nII — ${LONG.slice(0, 220)}\nIII — Draw a card.`);
    expect(dense.clipped).toBe(false);
    expect(dense.sizePx).toBeLessThan(64);
    expect(rulesLadderPx(SLOT.sizePct)).toContain(dense.sizePx);
    for (const row of dense.rows) expect(row.text.sizePx).toBe(dense.sizePx);
    // One step up, the same texts are taller than the rows' box at a target.
    const up = dense.sizePx + RULES_SIZE_PX.stepPx;
    const taller = RULES_TARGETS.some((t) => {
      const scale = RULES_TARGET_SCALE[t];
      const need = dense.rows.reduce(
        (sum, row) => sum + Math.max(blockHeightPx(layoutRulesAt(row.text.input, up), t) + 2 * Math.round(SAGA_RAIL.rowPadYPx * scale), 132 * scale),
        0,
      );
      return need > rectPx(dense.rowsRect, "portrait", ASPECT, t).height;
    });
    expect(taller).toBe(true);
    // A short saga stays at the ceiling.
    expect(rail(DOM_21).sizePx).toBe(64);
  });

  it("breaks every line for the chapter column at BOTH targets, at the rail's size and pitch", () => {
    const r = rail(LTC_58);
    for (const t of RULES_TARGETS) {
      const column = rectPx(SLOT.rect, "portrait", ASPECT, t).width;
      for (const row of r.rows) {
        const placed = linePositions(row.text, t);
        expect(placed.metrics.linePx).toBe(Math.round(placed.metrics.fontPx * SLOT.lineHeight!));
        for (const line of placed.lines) expect(line.width).toBeLessThanOrEqual(column);
      }
    }
  });

  it("keeps a chapter's own line breaks as paragraphs (the fourth stored production saga's chapter III)", () => {
    const r = sagaRail(SLOT, null, chapters([["III", "opp picks 1 X 1/1 hexproof nurses\n/tap 1 creature a land"]]));
    expect(r.rows[0].text.blocks.map((b) => b.kind)).toEqual(["rules", "rules"]);
    const placed = linePositions(r.rows[0].text, "hd");
    const [first, second] = [placed.lines.filter((l) => l.block === 0), placed.lines.filter((l) => l.block === 1)];
    expect(second[0].top - (first.at(-1)!.top + placed.metrics.linePx)).toBe(24); // the rules standard's paragraph gap
  });

  it("draws real pips, reminder italics and U+2212 as the hyphen MPlantin has", () => {
    const r = rail(DOM_122);
    expect(r.rows.map((row) => row.marker)).toEqual(["I", "II", "III"]);
    const items = r.rows[1].text.blocks[0].lines[0].runs.flat();
    expect(items.filter((it) => it.t === "m").map((it) => (it.t === "m" ? it.suffix : ""))).toEqual(["r", "r"]);
    expect(items.some((it) => it.t === "w" && it.v.includes("{"))).toBe(false);
    const width = (rules: string) => rail(rules).rows[0].text.blocks[0].lines.map((l) => l.widthPx.hd);
    expect(width("I — Put a −1/−1 counter on each creature.")).toEqual(width("I — Put a -1/-1 counter on each creature."));
    const ch = rail("I — Draw a card. (You may play it.)").rows[0].text.blocks.flatMap((b) => b.lines.flatMap((l) => l.runs.flat()));
    expect(ch.filter((it) => it.t === "w" && it.em).map((it) => (it.t === "w" ? it.v : ""))).toEqual(["(You", "may", "play", "it.)"]);
  });
});

describe("the badge stacks", () => {
  it("stacks one badge per numeral, up to the six the prints stack (WHO #99 five, LTR #174 six)", () => {
    expect(rail(DOM_21).rows.map((row) => [row.labels, row.combined])).toEqual([[["I", "II"], false], [["III"], false]]);
    expect(rail(LTC_58).rows[0].labels).toEqual(["I", "II", "III"]);
    expect(rail(WHO_99).rows[1].labels).toEqual(["II", "III", "IV", "V", "VI"]);
    const six = rail(LTR_174);
    expect(six.rows[0].labels).toEqual(["I", "II", "III", "IV", "V", "VI"]);
    expect(six.rows[0].combined).toBe(false);
    expect(six.combinedFallback).toBe(false);
    expect(SAGA_RAIL.maxStack).toBe(6);
  });

  it("never makes a row shorter than its stack: 132 / 292 / 452 px for one, two, three at the roomy pitch", () => {
    const r = sagaRail(SLOT, REMINDER, chapters([["I", "Draw."], ["II,III", "Draw."], ["IV,V,VI", "Draw."]]));
    expect(r.pitchPx).toBe(160);
    expect(r.rows.map((_row, i) => natural(r, i, "hd"))).toEqual([132, 292, 452]);
    expect(r.rows.map((_row, i) => natural(r, i, "default"))).toEqual([66, 146, 226]);
    expect(r.rows.map((_row, i) => natural({ ...r, pitchPx: 138 }, i, "hd"))).toEqual([132, 270, 408]);
    const d = sagaRailDrawing(r, "hd");
    // The one-line texts are shorter than every stack: each row is its
    // stack plus the same share of the spare height (± the whole-px edges).
    const spare = d.rows[0].bottom - d.rows[0].top - 132;
    d.rows.forEach((row, i) => expect(Math.abs(row.bottom - row.top - spare - [132, 292, 452][i])).toBeLessThanOrEqual(1));
    // …and each stack is drawn inside its row, its badges the pitch apart.
    for (const row of d.rows) {
      expect(row.badges[0].top).toBeGreaterThanOrEqual(row.top);
      expect(row.badges.at(-1)!.top + 132).toBeLessThanOrEqual(row.bottom);
      row.badges.slice(1).forEach((b, j) => expect(b.top - row.badges[j].top).toBe(160));
    }
  });

  it("keeps the roomy pitch while the rows have room (DOM #21: 160 px, the print's 159.8)", () => {
    expect(rail(DOM_21).pitchPx).toBe(160);
    expect(rail(WHO_99).pitchPx).toBe(160);
  });

  it("tightens the stacks before the text steps down, and the text steps down only once they are tight", () => {
    // Two three-stacks and a long chapter: at 64 px the rows fit only with
    // the stacks closer than 160 px.
    const squeezed = sagaRail(
      SLOT,
      REMINDER,
      chapters([["I,II,III", "Draw a card."], ["IV,V,VI", "Draw a card."], ["VII", "Create a 2/2 white Knight creature token with vigilance."]]),
    );
    expect(squeezed.clipped).toBe(false);
    expect(squeezed.sizePx).toBe(64);
    expect(squeezed.pitchPx).toBeLessThan(160);
    expect(squeezed.pitchPx).toBeGreaterThanOrEqual(138);
    expect(squeezed.pitchPx % 2).toBe(0);
    // The roomiest pitch that fits: one step roomier, the rows are taller
    // than their box.
    const total = (pitch: number) => {
      const sized = { ...squeezed, pitchPx: pitch };
      return squeezed.rows.reduce((sum, _row, i) => sum + natural(sized, i, "hd"), 0);
    };
    const box = rectPx(squeezed.rowsRect, "portrait", ASPECT, "hd").height;
    expect(total(squeezed.pitchPx)).toBeLessThanOrEqual(box);
    expect(total(squeezed.pitchPx + SAGA_RAIL.pitchStepPx)).toBeGreaterThan(box);
    // Longer text still: tight stacks no longer save 64 px.
    const smaller = sagaRail(
      SLOT,
      REMINDER,
      chapters([["I,II,III", "Draw a card."], ["IV,V,VI", "Draw a card."], ["VII", "Each opponent sacrifices a creature or planeswalker, then discards a card."]]),
    );
    expect(smaller.clipped).toBe(false);
    expect(smaller.sizePx).toBeLessThan(64);
  });

  it("always fits distinct numerals: every way of sharing I–VI between rows is under the rail at the tight pitch", () => {
    const box = { hd: 1138, default: rectPx({ ...SLOT.rect, topPct: SLOT.rowsTopPct, heightPct: SLOT.rect.topPct + SLOT.rect.heightPct - SLOT.rowsTopPct }, "portrait", ASPECT, "default").height };
    const partitions = (n: number, max = n): number[][] =>
      n === 0 ? [[]] : Array.from({ length: Math.min(n, max) }, (_, i) => i + 1).flatMap((k) => partitions(n - k, k).map((rest) => [k, ...rest]));
    for (const parts of partitions(6)) {
      expect(parts.reduce((sum, k) => sum + 132 + (k - 1) * 138, 0), `${parts}`).toBeLessThanOrEqual(box.hd);
      expect(parts.reduce((sum, k) => sum + 66 + (k - 1) * 69, 0), `${parts}`).toBeLessThanOrEqual(box.default);
      let n = 0;
      const rows = chapters(parts.map((k) => [Array.from({ length: k }, () => ["I", "II", "III", "IV", "V", "VI"][n++]).join(","), "Draw a card."]));
      const r = sagaRail(SLOT, REMINDER, rows);
      expect(r.combinedFallback, `${parts}`).toBe(false);
      expect(r.clipped, `${parts}`).toBe(false);
      expect(r.rows.every((row) => !row.combined), `${parts}`).toBe(true);
    }
  });
});

describe("the numerals", () => {
  it("centres a numeral's capitals a px below its badge's centre: its line box 36 px under the badge's top at HD, 18 at 750", () => {
    // 72 px MPlantin: the capitals' centre is 0.4335 em down a one-em line
    // box (31.2 px); the badge's centre + 1 px is 67 px down the badge.
    for (const rules of [DOM_21, LTC_58, LTR_174]) {
      for (const badge of sagaRailDrawing(rail(rules), "hd").rows.flatMap((row) => row.badges)) {
        expect(badge.fontPx).toBe(72);
        expect(badge.labelTop - badge.top).toBe(36);
      }
      for (const badge of sagaRailDrawing(rail(rules), "default").rows.flatMap((row) => row.badges)) {
        expect(badge.fontPx).toBe(36);
        expect(badge.labelTop - badge.top).toBe(18);
      }
    }
  });
});

describe("the combined marker", () => {
  it("names a run by its ends and anything else as the list", () => {
    expect(combinedSagaLabel(["I", "II", "III"])).toBe("I–III");
    expect(combinedSagaLabel(["IV", "V", "VI"])).toBe("IV–VI");
    expect(combinedSagaLabel(["I", "II", "III", "IV", "V", "VI", "VII"])).toBe("I–VII");
    expect(combinedSagaLabel(["I", "III", "V"])).toBe("I,III,V");
    expect(combinedSagaLabel(["II", "I"])).toBe("II,I");
    expect(sagaNumerals("II, III,IV")).toEqual(["II", "III", "IV"]);
    expect(sagaNumerals("")).toEqual([]);
  });

  it("takes every multi-badge row when repeated numerals make stacks the rail can never hold", () => {
    // Validation allows a numeral on several rows: three I–III rows and a
    // IV–VI row are 4 × 408 px of tight stacks — more than the 1138 px
    // under a reminder.
    const rows = chapters([["I,II,III", "Draw."], ["I,II,III", "Draw."], ["I,II,III", "Draw."], ["IV,V,VI", "Draw."], ["VI", "Draw."]]);
    const r = sagaRail(SLOT, REMINDER, rows);
    expect(r.combinedFallback).toBe(true);
    expect(r.rows.map((row) => row.labels)).toEqual([["I–III"], ["I–III"], ["I–III"], ["IV–VI"], ["VI"]]);
    expect(r.rows.map((row) => row.combined)).toEqual([true, true, true, true, false]);
    expect(r.clipped).toBe(false);
    const d = sagaRailDrawing(r, "hd");
    for (const row of d.rows) expect(row.badges).toHaveLength(1);
    // Without a reminder three of them fit the 1522 px rail: stacks again.
    const open = sagaRail(SLOT, null, rows.slice(0, 3));
    expect(open.combinedFallback).toBe(false);
    expect(open.rows.map((row) => row.labels.length)).toEqual([3, 3, 3]);
  });

  it("takes a row with more numerals than a stack holds, alone (a legacy marker past VI)", () => {
    const r = rail(`${REMINDER}\nI, II, III, IV, V, VI, VII — Scry 1.\nVIII — You win.\nII, III — Draw.`);
    expect(r.combinedFallback).toBe(false);
    expect(r.rows.map((row) => [row.labels, row.combined])).toEqual([[["I–VII"], true], [["VIII"], false], [["II", "III"], false]]);
  });

  it("fits a label to the badge's face: I–VI at the numeral's size, a combined or long one stepped down", () => {
    const face = 118 - 2 * SAGA_RAIL.labelInsetPx;
    for (const numeral of ["I", "II", "III", "IV", "V", "VI"]) {
      expect(sagaLabelSizePx(SLOT, numeral), numeral).toBe(SAGA_NUMERAL_SIZE_PX);
      expect(rulesTextWidthEm(numeral, false) * SAGA_NUMERAL_SIZE_PX, numeral).toBeLessThanOrEqual(face);
    }
    for (const label of ["I–III", "IV–VI", "I–VII", "VIII", "I,III,V"]) {
      const size = sagaLabelSizePx(SLOT, label);
      expect(size, label).toBeLessThan(SAGA_NUMERAL_SIZE_PX);
      expect(size % 2, label).toBe(0);
      expect(size, label).toBeGreaterThanOrEqual(SAGA_RAIL.labelMinPx);
      if (size > SAGA_RAIL.labelMinPx) expect(rulesTextWidthEm(label, false) * size, label).toBeLessThanOrEqual(face);
    }
    expect(sagaLabelSizePx(SLOT, "I,II,III,IV,V,VI,VII,VIII")).toBe(SAGA_RAIL.labelMinPx);
  });
});

describe("what the renderers draw (sagaRailDrawing) — whole px at each target", () => {
  it("puts a divider on every row's top edge but a first row at the rail's own top, its dark line on the edge", () => {
    const withIntro = sagaRailDrawing(rail(DOM_122), "hd");
    expect(withIntro.rows.map((row) => row.divider !== null)).toEqual([true, true, true]);
    for (const row of withIntro.rows) expect(row.divider).toEqual({ left: 150, top: row.top - 2, width: 592, height: 6 });
    expect(withIntro.rows[0].divider!.top).toBe(619); // the prints' first divider reads 619–621
    const bare = sagaRailDrawing(rail(DOM_122.replace(`${REMINDER}\n`, "")), "hd");
    expect(bare.rows.map((row) => row.divider !== null)).toEqual([false, true, true]);
    const half = sagaRailDrawing(rail(DOM_122), "default");
    for (const row of half.rows) expect(row.divider).toEqual({ left: 75, top: row.top - 1, width: 296, height: 3 });
  });

  it("centres each stack in its row and lifts it onto the text's leading (0.17 em), never out of the row", () => {
    const r = rail(DOM_21);
    for (const t of RULES_TARGETS) {
      const scale = RULES_TARGET_SCALE[t];
      const d = sagaRailDrawing(r, t);
      const lift = Math.round(SAGA_RAIL.badgeLiftEm * r.sizePx * scale);
      expect(lift).toBe(t === "hd" ? 11 : 5);
      for (const row of d.rows) {
        const extent = row.badges.at(-1)!.top + row.badges[0].height - row.badges[0].top;
        expect(row.badges[0].top).toBe(Math.round((row.top + row.bottom - extent) / 2) - lift);
        for (const b of row.badges) expect([b.left, b.width, b.height]).toEqual(t === "hd" ? [58, 118, 132] : [29, 59, 66]);
      }
    }
    // DOM #21 at HD: the stack's centre 30–31 px above its text's mean
    // baseline, as the print's (880.0 against 880.0 + 31).
    const d = sagaRailDrawing(r, "hd");
    const placed = linePositions(d.rows[0].text, "hd");
    const baselines = placed.lines.map((l) => l.top + placed.metrics.baselinePx.regular);
    const mean = (baselines[0] + baselines.at(-1)!) / 2;
    const centre = (d.rows[0].badges[0].top + d.rows[0].badges[1].top + 132) / 2;
    expect(Math.abs(mean - centre - 31)).toBeLessThanOrEqual(2);
    // A stack as tall as its row has nowhere to go: it stays inside.
    const full = sagaRailDrawing(rail(LTC_58), "hd").rows[0];
    expect(full.badges[0].top).toBeGreaterThanOrEqual(full.top);
    expect(full.badges.at(-1)!.top + 132).toBeLessThanOrEqual(full.bottom);
  });

  it("gives each numeral a one-em line box the badge's width, its capitals centred a px below the badge's centre", () => {
    for (const t of RULES_TARGETS) {
      const scale = RULES_TARGET_SCALE[t];
      const d = sagaRailDrawing(rail(DOM_21), t);
      for (const b of d.rows.flatMap((row) => row.badges)) {
        expect(b.fontPx).toBe(SAGA_NUMERAL_SIZE_PX * scale);
        // MPlantin: the baseline 0.7745 em down a one-em line box, the
        // capitals 0.682 em tall.
        const capCentre = b.labelTop + (0.7745 - 0.341) * b.fontPx;
        expect(Math.abs(capCentre - (b.top + b.height / 2 + SAGA_RAIL.numeralDyPx * scale))).toBeLessThanOrEqual(0.5);
        expect(Number.isInteger(b.labelTop)).toBe(true);
      }
    }
  });

  it("hands each chapter's lines to the renderer in the row's own box at that target", () => {
    const r = rail(LTC_58);
    for (const t of RULES_TARGETS) {
      const d = sagaRailDrawing(r, t);
      d.rows.forEach((row, i) => {
        const box = rectPx(row.text.input.rect, "portrait", ASPECT, t);
        const column = rectPx(SLOT.rect, "portrait", ASPECT, t);
        expect([box.top, box.bottom, box.left, box.right]).toEqual([row.top, row.bottom, column.left, column.right]);
        // The same lines as the rail's (only the box differs), centred.
        expect(row.text.blocks).toBe(r.rows[i].text.blocks);
        expect(row.text.input.vAlign).toBe("center");
        const placed = linePositions(row.text, t);
        expect(placed.lines[0].top).toBeGreaterThanOrEqual(row.top);
        expect(placed.lines.at(-1)!.top + placed.metrics.linePx).toBeLessThanOrEqual(row.bottom);
      });
      expect(d.cardWidth).toBe(t === "hd" ? 1500 : 750);
      expect(d.cardHeight).toBe(t === "hd" ? 2100 : 1050);
    }
  });

  it("lists the bitmaps as frame pieces whose percents round back to their px boxes, dividers then badges", () => {
    const r = rail(DOM_21);
    for (const t of RULES_TARGETS) {
      const d = sagaRailDrawing(r, t);
      const pieces = sagaRailPieces(d, SLOT);
      expect(pieces.map((p) => p.path)).toEqual([SLOT.divider.assetPath, SLOT.divider.assetPath, SLOT.badge.assetPath, SLOT.badge.assetPath, SLOT.badge.assetPath]);
      const boxes = [...d.rows.map((row) => row.divider!), ...d.rows.flatMap((row) => row.badges)];
      pieces.forEach((piece, i) => {
        const box = rectPx(piece.rect, "portrait", ASPECT, t);
        expect([box.left, box.top, box.width, box.height]).toEqual([boxes[i].left, boxes[i].top, boxes[i].width, boxes[i].height]);
      });
    }
  });

  it("names the assets a rail draws — the badge with a marker, the divider with a row edge to mark", () => {
    expect(sagaRailAssetPaths(null)).toEqual([]);
    expect(sagaRailAssetPaths(rail("Only a reminder."))).toEqual([]);
    expect(sagaRailAssetPaths(rail(DOM_21))).toEqual([SLOT.badge.assetPath, SLOT.divider.assetPath]);
    expect(sagaRailAssetPaths(rail("I — Draw a card."))).toEqual([SLOT.badge.assetPath]); // one row, no reminder: no divider
    expect(sagaRailAssetPaths(rail(`${REMINDER}\nI — Draw a card.`))).toEqual([SLOT.badge.assetPath, SLOT.divider.assetPath]);
  });
});

describe("a rail past its floor", () => {
  it("scales the floor's rows alike into the rail and sets a row that can't hold its text from its top", () => {
    const r = sagaRail(SLOT, REMINDER, chapters(["I", "II", "III", "IV", "V", "VI"].map((n) => [n, `${LONG} ${LONG}`])));
    expect(r.clipped).toBe(true);
    expect(r.sizePx).toBe(RULES_SIZE_PX.floor);
    expect(r.rowFractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (const t of RULES_TARGETS) {
      const d = sagaRailDrawing(r, t);
      expect(d.rows.at(-1)!.bottom).toBe(rectPx(r.rowsRect, "portrait", ASPECT, t).bottom);
      for (const row of d.rows) {
        expect(row.text.input.vAlign).toBe("start");
        expect(row.badges[0].top).toBeGreaterThanOrEqual(row.top - 1);
      }
    }
  });

  it("draws nothing for a saga with no text at all", () => {
    const r = sagaRail(SLOT, null, []);
    expect(r.intro).toBeNull();
    expect(sagaRailDrawing(r, "hd").rows).toEqual([]);
    expect(sagaRailPieces(sagaRailDrawing(r, "hd"), SLOT)).toEqual([]);
  });
});
