import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ADVENTURE_PAGE_PAD_PX,
  SECOND_FACE_PAD_PX,
  adventureRulesLayout,
  drawnStatInk,
  fromTopWhenOverflowing,
  mainRulesLayout,
  rulesDraw,
  rulesWordText,
  secondFaceRulesLayout,
  walkerSizePct,
  type RulesDraw,
} from "@/lib/cards/rules-box";
import {
  RULES_TARGETS,
  fitRulesLayout,
  inkEntersRect,
  rulesTargetFor,
  layoutRulesAt,
  linePositions,
  rectPx,
  statInkRect,
  type RulesLayout,
  type RulesLayoutInput,
  type RulesPlacement,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import { SPLIT_TEXTBOX_BORDER_PX, getFrameProfile, type FrameProfile, type Rect } from "@/lib/cards/template-layout";
import { RULES_BOX_PAD_PX, RULES_SIZE_PX } from "@/lib/cards/typography";
import { FRAME_TEMPLATE_VALUES } from "@/types/card";
import { EOE_30, TLA_112, plainText } from "@/tests/unit/cards/fixtures/rules-texts";

// ---------------------------------------------------------------------------
// lib/cards/rules-box.ts — what each rules consumer hands the ONE rules layout
// (layout v33, TODO 3.29): its box, padding, alignment and the keep-outs of
// the stat badges the card draws; and the geometry both renderers draw a
// fitted layout with (RulesBox / RulesBoxBake).
// ---------------------------------------------------------------------------

const PORTRAIT = 7 / 5;
const aspectOf = (p: FrameProfile) => (p.orientation === "landscape" ? 5 / 7 : 7 / 5);

/** Whether any line of `layout` puts ink in `keepOut` at `target` — glyph
 *  by glyph, as the fit judges it. */
function hits(layout: RulesLayout, keepOut: Rect, target: RulesTarget = "hd"): boolean {
  return inkEntersRect(layout, keepOut, target);
}

/** The first text of growing length whose layout, fitted WITHOUT keep-outs,
 *  runs a line into `keepOut`. */
function textReaching(input: (text: string) => RulesLayoutInput, keepOut: Rect): string {
  for (let chars = 60; chars < 1400; chars += 10) {
    const text = plainText(chars);
    const bare = fitRulesLayout({ ...input(text), keepOuts: [] });
    if (!bare.clipped && RULES_TARGETS.some((t) => hits(bare, keepOut, t))) return text;
  }
  throw new Error("no text reaches the keep-out");
}

describe("the main box on every template", () => {
  it("gives M15 and its skins the prints' margins (4 / 0 HD px), split its border's, the text-box tokens theirs, every other box its default", () => {
    const TOKEN_TEXT = [
      "m15tokentext", "m15tokenartifacttext",
      // TODO 4.48: the full-art tokens' box, CC's 8.6 / 82.8 %W with the same
      // 2 px (the textless height never draws it).
      "m20token", "m20tokentext", "m20tokentall", "m20tokenartifact", "m20tokenartifacttext", "m20tokenartifacttall",
    ];
    const withPrintMargins = FRAME_TEMPLATE_VALUES.filter(
      (t) => t !== "split" && !TOKEN_TEXT.includes(t) && getFrameProfile(t).rules.padPx,
    );
    expect(getFrameProfile("split").rules.padPx).toEqual({ left: 57, right: 54, top: 18, bottom: 18 });
    // TODO 4.49 (b): the 2014–19 text-box token prints set their rules from
    // x 130 to 1372 in CC's 129–1371 px box: 2 px either side, none above.
    for (const t of TOKEN_TEXT) expect(getFrameProfile(t).rules.padPx, t).toEqual({ x: 2, y: 0 });
    expect([...withPrintMargins].sort()).toEqual(
      ["m15", "m15artifact", "m15devoid", "m15land", "m15snow", "m15snowland", "nyx"].sort(),
    );
    for (const t of withPrintMargins) expect(getFrameProfile(t).rules.padPx, t).toEqual({ x: 4, y: 0 });
    // Borderless and extended art spread M15's rules slot but keep 9 / 18.
    for (const t of ["m15borderless", "m15borderlessartifact", "extendedart"] as const) {
      expect(getFrameProfile(t).rules.padPx, t).toBeUndefined();
      const layout = mainRulesLayout({ layout: getFrameProfile(t), rulesText: "Flying", aspect: PORTRAIT, show: {} });
      expect(layout.input.padPx).toEqual(RULES_BOX_PAD_PX);
    }
  });

  it("hands the layout the slot's box, ceiling, alignment and flavor bar", () => {
    for (const t of FRAME_TEMPLATE_VALUES) {
      const p = getFrameProfile(t);
      const layout = mainRulesLayout({ layout: p, rulesText: "Flying", flavorText: "Up.", aspect: aspectOf(p), show: {} });
      expect(layout.input.rect, t).toBe(p.rules.rect);
      // (A walker drawn in the plain box takes walkerSizePct — below.)
      expect(layout.input.sizePct, t).toBe(p.rules.sizePct);
      expect(layout.input.vAlign, t).toBe(p.rules.vAlign ?? "start");
      expect(layout.input.divider, t).toBe(p.flavorDivider !== false);
      expect(layout.orientation, t).toBe(p.orientation === "landscape" ? "landscape" : "portrait");
    }
  });

  it("fits the round-9 print references on the real M15 box, the plate drawn", () => {
    const m15 = getFrameProfile("m15");
    const fit = (text: string) => mainRulesLayout({ layout: m15, rulesText: text, aspect: PORTRAIT, show: { pt: true } });
    // The prints: 59.85 and 60.6 px. With the M15 box's print margins
    // (4 / 0 — the line box's own air above the ascenders is the prints'
    // top margin) EOE #30 takes the 60 px step the first cut's 6 px padding
    // missed by 3 px.
    const eoe = fit(EOE_30);
    expect(eoe.sizePx).toBe(60);
    expect(eoe.blocks.map((b) => b.lines.length)).toEqual([2, 3, 4]);
    expect(fit(TLA_112).sizePx).toBe(62);
    // A short text prints at the 9 pt ceiling.
    expect(fit("Flying, vigilance").sizePx).toBe(RULES_SIZE_PX.standard);
  });

  it("keeps the lines out of the P/T plate's ink — only on a card that draws the plate", () => {
    const m15 = getFrameProfile("m15");
    const plate = statInkRect(m15.pt!);
    const input = (text: string): RulesLayoutInput =>
      mainRulesLayout({ layout: m15, rulesText: text, aspect: PORTRAIT, show: { pt: true } }).input;
    const text = textReaching(input, plate);
    const kept = mainRulesLayout({ layout: m15, rulesText: text, aspect: PORTRAIT, show: { pt: true } });
    const bare = mainRulesLayout({ layout: m15, rulesText: text, aspect: PORTRAIT, show: { pt: false } });
    expect(bare.input.keepOuts).toEqual([]);
    expect(kept.input.keepOuts).toEqual([plate]);
    expect(kept.sizePx).toBeLessThan(bare.sizePx);
    for (const t of RULES_TARGETS) expect(hits(kept, plate, t), t).toBe(false);
    expect(RULES_TARGETS.some((t) => hits(bare, plate, t))).toBe(true);
  });

  it("keeps a plain-box walker's text out of its loyalty shield (the 0.78 / 0.88 fit rect is gone)", () => {
    // A planeswalker with no abilities (flavor only) draws the plain box,
    // top-aligned, over the shield's corner of the rules rect.
    const pw = getFrameProfile("m15pw");
    const shield = statInkRect(pw.loyalty!);
    const input = (flavor: string): RulesLayoutInput =>
      mainRulesLayout({ layout: pw, rulesText: null, flavorText: flavor, aspect: PORTRAIT, show: { loyalty: true } }).input;
    const flavor = textReaching(input, shield);
    const kept = mainRulesLayout({ layout: pw, rulesText: null, flavorText: flavor, aspect: PORTRAIT, show: { loyalty: true } });
    expect(kept.input.keepOuts).toEqual([shield]);
    expect(kept.clipped).toBe(false);
    for (const t of RULES_TARGETS) expect(hits(kept, shield, t), t).toBe(false);
    // The fit uses the whole rect (no narrowed fit box): a text that stays
    // clear of the shield prints at the walker ceiling.
    const short = mainRulesLayout({ layout: pw, rulesText: null, flavorText: "Short.", aspect: PORTRAIT, show: { loyalty: true } });
    expect(short.sizePx).toBe(RULES_SIZE_PX.compact);
    expect(linePositions(short, "hd").interior.width).toBe(
      rectPx(pw.rules.rect, "portrait", PORTRAIT, "hd").width - 2 * RULES_BOX_PAD_PX.x,
    );
  });

  it("caps a walker's text at the walker ceiling; any other card on the planeswalker frame keeps 68 px (never below v32's 67)", () => {
    const pw = getFrameProfile("m15pw");
    expect(walkerSizePct(pw)).toBe(RULES_SIZE_PX.compact / 1500);
    expect(pw.rules.sizePct).toBe(RULES_SIZE_PX.reduced / 1500);
    const walker = mainRulesLayout({ layout: pw, rulesText: "Flying", aspect: PORTRAIT, show: { loyalty: true } });
    const other = mainRulesLayout({ layout: pw, rulesText: "Flying", aspect: PORTRAIT, show: { pt: true } });
    expect(walker.sizePx).toBe(RULES_SIZE_PX.compact);
    expect(other.sizePx).toBe(RULES_SIZE_PX.reduced);
    // An override that lowers the rules size lowers the walkers with it; one
    // that raises it never lifts them past the cap.
    expect(walkerSizePct({ ...pw, rules: { ...pw.rules, sizePct: 0.03 } })).toBe(0.03);
    expect(walkerSizePct({ ...pw, rules: { ...pw.rules, sizePct: 0.06 } })).toBe(RULES_SIZE_PX.compact / 1500);
    // A frame without ability rows: the rules slot's size.
    expect(walkerSizePct(getFrameProfile("m15"))).toBe(getFrameProfile("m15").rules.sizePct);
  });

  it("sets a text too long for its box even at the floor from the box's top: the clip takes the tail, never the first line", () => {
    const token = getFrameProfile("m15token");
    expect(token.rules.vAlign).toBe("center");
    const long = `This land enters tapped. ${plainText(900)}`;
    const clipped = mainRulesLayout({ layout: token, rulesText: long, aspect: PORTRAIT, show: {} });
    expect(clipped.clipped).toBe(true);
    expect(clipped.sizePx).toBe(RULES_SIZE_PX.floor);
    expect(clipped.input.vAlign).toBe("start");
    for (const t of RULES_TARGETS) {
      const placed = linePositions(clipped, t);
      // The first line sits at the top of the interior, whole, inside the box.
      expect(placed.lines[0].top, t).toBe(placed.interior.top + placed.insetTop);
      expect(placed.lines[0].inkTop, t).toBeGreaterThanOrEqual(placed.box.top);
      expect(rulesDraw(clipped, t).vAlign).toBe("start");
    }
    // A text that fits keeps the slot's alignment; so does a layout clipped
    // only by a keep-out (it fits the box).
    const short = mainRulesLayout({ layout: token, rulesText: "This land enters tapped.", aspect: PORTRAIT, show: {} });
    expect(short.input.vAlign).toBe("center");
    const unfitted = fitRulesLayout({ ...clipped.input, vAlign: "center" });
    expect(fromTopWhenOverflowing(unfitted).input.vAlign).toBe("start");
    expect(fromTopWhenOverflowing({ ...unfitted, checks: { hd: { ...unfitted.checks.hd, overflowPx: 0 }, default: { ...unfitted.checks.default, overflowPx: 0 } } }).input.vAlign).toBe("center");
  });

  it("judges a keep-out glyph by glyph: a word with no descender just above the plate clears it", () => {
    const m15 = getFrameProfile("m15");
    const plate = statInkRect(m15.pt!);
    let found = false;
    // A last line ending in "tokens." — no descender — whose line band (0.20
    // em below the baseline for every letter) dips into the plate while its
    // glyphs (0.02 em) stay above it.
    for (let chars = 100; chars < 900 && !found; chars += 4) {
      const text = `${plainText(chars)} tokens.`;
      for (const s of [76, 74, 72, 70, 68, 66, 64, 62, 60]) {
        const at = layoutRulesAt({ ...mainRulesLayout({ layout: m15, rulesText: text, aspect: PORTRAIT, show: { pt: true } }).input }, s);
        if (at.checks.hd.overflowPx > 0 || at.checks.default.overflowPx > 0) continue;
        const placed = linePositions(at, "hd");
        const k = rectPx(plate, "portrait", PORTRAIT, "hd");
        const last = placed.lines[placed.lines.length - 1];
        const bandHits = placed.lines.some((l) => l.inkRight > k.left && l.inkLeft < k.right && l.inkBottom > k.top && l.inkTop < k.bottom);
        if (bandHits && !inkEntersRect(at, plate, "hd") && !inkEntersRect(at, plate, "default") && last.inkBottom > k.top) {
          // The band alone would have stepped the text down; the glyphs don't.
          expect(at.checks.hd.keepOutHit).toBe(false);
          expect(at.checks.default.keepOutHit).toBe(false);
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("keeps a battle's text out of its defense disc when it draws one", () => {
    const battle = getFrameProfile("battle");
    const aspect = aspectOf(battle);
    const disc = statInkRect(battle.defense!);
    const shown = mainRulesLayout({ layout: battle, rulesText: plainText(300), aspect, show: { defense: true } });
    const hidden = mainRulesLayout({ layout: battle, rulesText: plainText(300), aspect, show: { defense: false } });
    expect(shown.input.keepOuts).toEqual([disc]);
    expect(hidden.input.keepOuts).toEqual([]);
    for (const t of RULES_TARGETS) expect(hits(shown, disc, t), t).toBe(false);
  });

  it("draws the landscape box on the 2100 px HD card", () => {
    const battle = getFrameProfile("battle");
    const layout = mainRulesLayout({ layout: battle, rulesText: "Flying", aspect: 5 / 7, show: {} });
    expect(layout.orientation).toBe("landscape");
    expect(layout.sizePx).toBe(RULES_SIZE_PX.reduced);
    expect(rulesTargetFor(2100, "landscape")).toBe("hd");
    expect(rulesTargetFor(1050, "landscape")).toBe("default");
    expect(rulesTargetFor(1500, "portrait")).toBe("hd");
    expect(rulesTargetFor(750, "portrait")).toBe("default");
  });
});

describe("the adventure page and the second faces", () => {
  it("fits the adventure page with its own padding, alignment and the plate as a keep-out", () => {
    const adv = getFrameProfile("adventure");
    const layout = adventureRulesLayout({ layout: adv, rulesText: "Draw a card.", aspect: PORTRAIT, show: { pt: true } })!;
    expect(layout.input.rect).toBe(adv.adventure!.rules.rect);
    expect(layout.input.padPx).toEqual(ADVENTURE_PAGE_PAD_PX);
    expect(layout.input.vAlign).toBe("start");
    expect(layout.sizePx).toBe(RULES_SIZE_PX.compact);
    expect(adventureRulesLayout({ layout: getFrameProfile("m15"), rulesText: "x", aspect: PORTRAIT, show: {} })).toBeNull();
    // The creature's own page (the main box) reaches the P/T plate.
    expect(adv.rules.rect.leftPct + adv.rules.rect.widthPct).toBeGreaterThan(statInkRect(adv.pt!).leftPct);
  });

  it("lays a second face out in its own unturned frame, at its padding and alignment", () => {
    for (const t of ["flip", "split", "aftermath"] as const) {
      const p = getFrameProfile(t);
      const layout = secondFaceRulesLayout({ layout: p, rulesText: "Draw a card.", aspect: aspectOf(p), show: {} })!;
      expect(layout.input.rect, t).toBe(p.secondFace!.rules.rect);
      // Split's halves pad past the textbox border inside their boxes (the
      // next test); flip and aftermath take a second face's default.
      expect(layout.input.padPx, t).toEqual(t === "split" ? p.rules.padPx : SECOND_FACE_PAD_PX);
      expect(layout.input.vAlign, t).toBe(p.secondFace!.rules.vAlign ?? "start");
    }
    // Split's right half honours its "start" (it was always centred).
    const split = getFrameProfile("split");
    expect(split.secondFace!.rules.vAlign).toBe("start");
    const right = secondFaceRulesLayout({ layout: split, rulesText: "Draw a card.", aspect: 5 / 7, show: {} })!;
    const placed = linePositions(right, "hd");
    expect(placed.top).toBe(placed.interior.top);
  });

  it("keeps both split halves' text inside the frame's textbox border, at the MSE style's margins", async () => {
    // The border measured on the masters (every colour but white, whose
    // border is the cream's colour; the same MSE half in every colour): the
    // cream — within 28 of the box's own colour on every channel, three px in
    // a row — starts at most 33 HD px inside each half's rect and ends at
    // most 38 px inside its right edge, on every row of the box.
    const split = getFrameProfile("split");
    const halves = [
      { name: "left", rect: split.rules.rect },
      { name: "right", rect: split.secondFace!.rules.rect },
    ];
    const widest = { left: 0, right: 0 };
    for (const color of ["w", "u", "b", "r", "g", "c", "m"].filter((c) => c !== "w")) {
      const { data, info } = await sharp(join(process.cwd(), "public/frames/split", `${color}.png`))
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect([info.width, info.height], color).toEqual([2100, 1500]);
      const px = (x: number, y: number) => [0, 1, 2].map((c) => data[(y * info.width + x) * 3 + c]);
      for (const { rect } of halves) {
        const box = rectPx(rect, "landscape", 5 / 7, "hd");
        const mid = Math.round(box.left + box.width / 2);
        for (let y = box.top; y < box.bottom; y += 4) {
          const ref = Array.from({ length: 100 }, (_, i) => px(mid - 200 + 4 * i, y)).sort(
            (a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]),
          )[50];
          const cream = (x: number) => [x, x + 1, x + 2].every((xx) => px(xx, y).every((v, c) => Math.abs(v - ref[c]) <= 28));
          const creamR = (x: number) => [x, x - 1, x - 2].every((xx) => px(xx, y).every((v, c) => Math.abs(v - ref[c]) <= 28));
          let l = box.left;
          while (!cream(l)) l += 1;
          let r = box.right - 1;
          while (!creamR(r)) r -= 1;
          widest.left = Math.max(widest.left, l - box.left);
          widest.right = Math.max(widest.right, box.right - (r + 1));
        }
      }
    }
    expect(widest).toEqual(SPLIT_TEXTBOX_BORDER_PX);

    // Every line's ink — an italic "f" leading a reminder, an overhanging
    // last glyph — lands inside the cream on both halves, at both targets,
    // at every size the ladder reaches; the column starts the MSE style's
    // 24 px (right: 16) inside the border.
    const texts = [
      "Aftermath (Cast this spell only from your graveyard. Then exile it.)\nEach opponent loses X life. You gain life equal to the life lost this way.",
      "(from your graveyard) (fff jjj of) " + plainText(60),
      plainText(900),
    ];
    const layouts = [
      ...texts.map((t) => mainRulesLayout({ layout: split, rulesText: t, aspect: 5 / 7, show: {} })),
      ...texts.map((t) => secondFaceRulesLayout({ layout: split, rulesText: t, aspect: 5 / 7, show: {} })!),
      ...[64, 52, 42].flatMap((s) => [
        layoutRulesAt(mainRulesLayout({ layout: split, rulesText: texts[1], aspect: 5 / 7, show: {} }).input, s),
        layoutRulesAt(secondFaceRulesLayout({ layout: split, rulesText: texts[1], aspect: 5 / 7, show: {} })!.input, s),
      ]),
    ];
    for (const layout of layouts) {
      for (const target of RULES_TARGETS) {
        const placed = linePositions(layout, target);
        const scale = target === "hd" ? 1 : 0.5;
        const cream = {
          left: placed.box.left + SPLIT_TEXTBOX_BORDER_PX.left * scale,
          right: placed.box.left + placed.box.width - SPLIT_TEXTBOX_BORDER_PX.right * scale,
        };
        expect(placed.interior.left - cream.left, target).toBeGreaterThanOrEqual(24 * scale);
        expect(cream.right - (placed.interior.left + placed.interior.width), target).toBeGreaterThanOrEqual(16 * scale - 0.5);
        for (const line of placed.lines) {
          expect(line.inkLeft, `${layout.sizePx} ${target} line ${line.block}.${line.line}`).toBeGreaterThanOrEqual(cream.left);
          expect(line.inkRight, `${layout.sizePx} ${target} line ${line.block}.${line.line}`).toBeLessThanOrEqual(cream.right);
        }
      }
    }
  });

  it("turns the flip face's P/T into its own frame", () => {
    const flip = getFrameProfile("flip");
    const face = flip.secondFace!;
    // Drawn, the upside-down P/T sits where its rect is (turned about its
    // own centre by 180°).
    const [pt] = drawnStatInk(flip, { secondFacePt: true }, PORTRAIT);
    expect(pt.leftPct).toBeCloseTo(face.pt!.rect.leftPct, 9);
    expect(pt.topPct).toBeCloseTo(face.pt!.rect.topPct, 9);
    expect(drawnStatInk(flip, { secondFacePt: false }, PORTRAIT)).toEqual([]);
    // In the face's unturned frame it is mirrored through the box's centre.
    const layout = secondFaceRulesLayout({ layout: flip, rulesText: "x", aspect: PORTRAIT, show: { secondFacePt: true } })!;
    const [k] = layout.input.keepOuts!;
    const box = face.rules.rect;
    const centre = { x: box.leftPct + box.widthPct / 2, y: box.topPct + box.heightPct / 2 };
    expect(k.leftPct + k.widthPct / 2).toBeCloseTo(2 * centre.x - (pt.leftPct + pt.widthPct / 2), 9);
    expect(k.topPct + k.heightPct / 2).toBeCloseTo(2 * centre.y - (pt.topPct + pt.heightPct / 2), 9);
  });
});

/** Every line top, flowed from a draw's box, padding, headroom and margins
 *  the way the renderers' flex boxes stack them. */
function flowedTops(d: RulesDraw, placed: RulesPlacement): number[] {
  const { box } = placed;
  const interiorHeight = box.height - d.pad.top - d.pad.bottom;
  let total = d.insetTop + d.insetBottom;
  for (const b of d.blocks) {
    total += b.kind === "blank" ? b.marginTop + b.height : (b.bar ? b.bar.above + b.bar.thickness + b.bar.below : b.marginTop) + b.lines.length * d.linePx;
  }
  const offset = d.vAlign === "center" ? (interiorHeight - total) / 2 : d.vAlign === "end" ? interiorHeight - total : 0;
  let y = box.top + d.pad.top + offset + d.insetTop;
  const tops: number[] = [];
  for (const b of d.blocks) {
    if (b.kind === "blank") {
      y += b.marginTop + b.height;
      continue;
    }
    y += b.bar ? b.bar.above + b.bar.thickness + b.bar.below : b.marginTop;
    for (let i = 0; i < b.lines.length; i += 1) {
      tops.push(y);
      y += d.linePx;
    }
  }
  return tops;
}

describe("rulesDraw — the geometry both renderers draw", () => {
  const texts: [string, string | null, string | null][] = [
    ["paragraphs", "Flying\nWhen this creature enters, draw a card.\n{T}: Add {G}.", null],
    ["blank lines", "Flying\n\nScry 2.\n\n\nDraw a card.", null],
    ["flavor with bar", EOE_30, "\"The line holds.\"\n—Captain"],
    ["flavor only", null, "Once upon a time."],
  ];
  for (const template of ["m15", "retro", "m15pw", "battle"] as const) {
    it(`flows every line to its placement on ${template}, at both targets`, () => {
      const p = getFrameProfile(template);
      for (const [name, rules, flavor] of texts) {
        const layout = mainRulesLayout({ layout: p, rulesText: rules, flavorText: flavor, aspect: aspectOf(p), show: { pt: true } });
        for (const t of RULES_TARGETS) {
          const placed = linePositions(layout, t);
          const d = rulesDraw(layout, t);
          const tops = flowedTops(d, placed);
          expect(tops.length, `${name} ${t}`).toBe(placed.lines.length);
          tops.forEach((y, i) => expect(y, `${name} ${t} line ${i}`).toBeCloseTo(placed.lines[i].top, 9));
          // The padding is the interior's inset (side headroom included).
          expect(placed.box.left + d.pad.left).toBe(placed.interior.left);
          expect(placed.box.top + d.pad.top).toBe(placed.interior.top);
          // A line's px, the runs' line height exactly its box.
          expect(d.fontPx * d.lineHeight).toBeCloseTo(d.linePx, 9);
          expect(d.fontPx).toBe(layout.sizePx * (t === "hd" ? 1 : 0.5));
        }
      }
    });
  }

  it("splits the flavor gap around the 1 px bar, or keeps the no-bar gap", () => {
    const withBar = mainRulesLayout({ layout: getFrameProfile("m15"), rulesText: "Flying", flavorText: "Up.", aspect: PORTRAIT, show: {} });
    const [, flavor] = rulesDraw(withBar, "hd").blocks;
    expect(flavor).toMatchObject({ kind: "flavor", marginTop: 0, bar: { above: 30, below: 30, thickness: 1 } });
    const [, small] = rulesDraw(withBar, "default").blocks;
    expect(small).toMatchObject({ bar: { above: 15, below: 15, thickness: 1 } });
    const noBar = mainRulesLayout({ layout: getFrameProfile("retro"), rulesText: "Flying", flavorText: "Up.", aspect: PORTRAIT, show: {} });
    expect(rulesDraw(noBar, "hd").blocks[1]).toMatchObject({ kind: "flavor", marginTop: 42, bar: null });
    // Paragraphs: the fixed 24 px (12 at 750).
    const paras = mainRulesLayout({ layout: getFrameProfile("m15"), rulesText: "Flying\nTrample", aspect: PORTRAIT, show: {} });
    expect(rulesDraw(paras, "hd").blocks[1]).toMatchObject({ kind: "rules", marginTop: 24 });
    expect(rulesDraw(paras, "default").blocks[1]).toMatchObject({ kind: "rules", marginTop: 12 });
  });

  it("draws U+2212 as the hyphen-minus MPlantin has, in both renderers", () => {
    expect(rulesWordText("−2/−2")).toBe("-2/-2");
    expect(rulesWordText("Draw")).toBe("Draw");
  });
});

describe("side ink — a glyph past its advance never meets the clip", () => {
  const m15 = getFrameProfile("m15");
  const at = (rulesText: string, flavorText: string | null, sizePx: number) =>
    layoutRulesAt({ ...mainRulesLayout({ layout: m15, rulesText, flavorText, aspect: PORTRAIT, show: {} }).input }, sizePx);

  it("moves the column in past a line-starting italic f / j / p (0.13 / 0.13 / 0.07 em left of it)", () => {
    // Flavor lines that start with "faith" and "justice".
    const layout = at("Flying", "Born with wings of light and a sword of faith, she is the embodiment of divine justice.", 76);
    const starts = layout.blocks[1].lines.map((l) => (l.runs[0][0] as { v: string }).v.charAt(0));
    expect(starts.some((c) => "fjp".includes(c))).toBe(true);
    for (const t of RULES_TARGETS) {
      const placed = linePositions(layout, t);
      for (const l of placed.lines) expect(l.inkLeft, t).toBeGreaterThanOrEqual(placed.box.left);
    }
    expect(layout.sideInsets.hd.left).toBeGreaterThan(0);
  });

  it("keeps a roman f that ends a line (0.10 em right of its advance) inside the box", () => {
    for (let words = 6; words < 40; words += 1) {
      const text = `${plainText(600).split(" ").slice(0, words).join(" ")} of`;
      const layout = at(text, null, 76);
      for (const t of RULES_TARGETS) {
        const placed = linePositions(layout, t);
        for (const l of placed.lines) expect(l.inkRight, `${words} ${t}`).toBeLessThanOrEqual(placed.box.left + placed.box.width);
      }
    }
  });

  it("needs none with the default padding at a typical size", () => {
    const layout = mainRulesLayout({ layout: getFrameProfile("retro"), rulesText: plainText(200), aspect: PORTRAIT, show: {} });
    expect(layout.sideInsets).toEqual({ hd: { left: 0, right: 0 }, default: { left: 0, right: 0 } });
  });
});
