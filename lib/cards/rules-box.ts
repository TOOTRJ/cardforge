// ---------------------------------------------------------------------------
// The rules BOXES both renderers draw (layout v33, TODO 3.29): which text,
// box, padding, alignment and keep-outs each consumer hands the ONE rules
// layout (lib/cards/rules-layout.ts), and the box, paragraph and line
// geometry a renderer draws a fitted layout with at one target. Pure — the
// live preview (components/cards/card-preview.tsx RulesBox, in cqw of the
// HD target) and the Satori bake (lib/render/card-image.tsx RulesBoxBake,
// in the target's px) draw from the same numbers:
//
//   box       — the slot rect, overflow hidden, padded by `pad`, the block
//               aligned by `vAlign` (flex, like every slot);
//   column    — insetTop / insetBottom of headroom around the lines (a first
//               line's accented capital), then the blocks;
//   blocks    — each `marginTop` below the previous one: a paragraph, a blank
//               source line (its own height), or the flavor block (its gap
//               split around a 1 px bar on a frame that prints one);
//   lines     — a nowrap flex row `linePx` tall, its runs (the words and pips
//               that never part, rules-text.ts groupTightRuns) side by side,
//               each after the first `wordGapPx` to the right, a pip after a
//               pip `pipGapPx`.
//
// Every margin is read off linePositions() — the placement the fit checked —
// so what is drawn is what was measured.
// ---------------------------------------------------------------------------

import {
  RULES_TARGETS,
  fitRulesLayout,
  keepOutInBoxFrame,
  linePositions,
  statInkRect,
  statKeepOuts,
  type RulesLayout,
  type RulesTarget,
} from "@/lib/cards/rules-layout";
import type { RulesItem } from "@/lib/cards/rules-text";
import type { FrameProfile, Rect, SlotAlign, TextSlot } from "@/lib/cards/template-layout";
import { RULES_BOX_PAD_PX } from "@/lib/cards/typography";

/** The adventure page's padding, HD px: the old 0.6 % / 1.0 % of the card. */
export const ADVENTURE_PAGE_PAD_PX = { x: 9, y: 15 } as const;

/** A second face's padding (flip, aftermath), HD px: the old 1.2 % / 0.8 %
 *  of a portrait card. Split's halves set their own (template-layout.ts
 *  SPLIT_RULES_PAD_PX: their boxes hold the textbox border). */
export const SECOND_FACE_PAD_PX = { x: 18, y: 12 } as const;

/** Which stat badges the card DRAWS — the renderers' gates (showPT /
 *  showLoyalty / showDefense, and a second face's showPT), and the holofoil
 *  stamp's arch while the stamp is drawn (TODO 4.9c: ResolvedHoloStamp
 *  .keepOut, card percents). Only a drawn badge keeps text out. */
export type DrawnStats = {
  pt?: boolean;
  loyalty?: boolean;
  defense?: boolean;
  secondFacePt?: boolean;
  /** The stamp's keep-out rect over the notch's arch, or null / absent
   *  when no stamp is drawn (lib/cards/holo-stamp.ts
   *  M15_HOLO_STAMP_KEEP_OUT: x 655–845 px from the arch top at 1905 past
   *  the box's bottom). Glyph-level like the badges — the rules rect never
   *  shrinks, so a short block never moves. */
  stamp?: Rect | null;
  /** The modal flipside strip's painted rect (TODO 5.1b,
   *  FlipsideSlots.keepOut), or null / absent on every other body: the
   *  strip is cut into the text box's paper, so the lines keep out of it
   *  the same way — a long text ends above it or its last lines stop at
   *  the chevron, as the prints set them. */
  strip?: Rect | null;
  /** The transform front's reverse P/T digits (TODO 5.1a; a rules FLOAT
   *  since 5.1d, lib/cards/stat-fit.ts endAlignedStatKeepOut): the BACK's
   *  P/T drawn end-aligned in the grey tab at the text box's bottom right
   *  — their ink footprint while they are drawn, null / absent otherwise
   *  (the tab prints empty when the back prints no P/T, and no other body
   *  has the slot). The lines whose rows meet it break short of the digits,
   *  as the prints set them (RulesLayoutInput.floats) — a keep-out there
   *  could only shrink the text, and the digits sit too far up the box for
   *  any size to clear them. */
  reversePt?: Rect | null;
};

/** The rects the rules lines wrap round (RulesLayoutInput.floats): the
 *  reverse P/T's digits while drawn. */
export function drawnFloats(show: DrawnStats): Rect[] {
  return show.reversePt ? [show.reversePt] : [];
}

/**
 * Where the card's drawn stat badges put ink, in card percents: the front's
 * P/T plate, loyalty shield and defense badge (statKeepOuts), and a second
 * face's P/T — turned with its value about its own centre, as the renderers
 * draw it. A rules box keeps its lines out of every one it meets (turned into
 * its own frame for a rotated box, rulesKeepOuts).
 */
export function drawnStatInk(layout: FrameProfile, show: DrawnStats, aspect: number): Rect[] {
  const out = statKeepOuts(layout, show);
  // The holofoil stamp's arch (4.9c), beside the badges, only while drawn.
  if (show.stamp) out.push(show.stamp);
  // The modal strip (5.1b): painted on every modal face, text or not.
  if (show.strip) out.push(show.strip);
  const face = layout.secondFace;
  if (show.secondFacePt && face?.pt) {
    // A plate (flip's bottom creature, layout v38) is drawn UNTURNED at its
    // own box in both renderers — its ink sits where the plate is; a value
    // with no plate turns with its face about its own centre, so its
    // footprint on the card is its box turned.
    out.push(
      face.pt.plateAssetPathTemplate
        ? statInkRect(face.pt)
        : keepOutInBoxFrame(statInkRect(face.pt), face.pt.rect, -face.rotation, aspect),
    );
  }
  return out;
}

/** The drawn badges a box turned by `rotation` must keep out of, in its own
 *  (unturned) frame. A badge the box never meets stays clear of it there. */
export function rulesKeepOuts(badges: readonly Rect[], box: Rect, rotation: number, aspect: number): Rect[] {
  return badges.map((k) => keepOutInBoxFrame(k, box, rotation, aspect));
}

type BoxInput = {
  layout: FrameProfile;
  rulesText: string | null | undefined;
  flavorText?: string | null | undefined;
  /** Card height ÷ width: 7/5 portrait, 5/7 landscape. */
  aspect: number;
  show: DrawnStats;
};

function fitSlot(
  slot: TextSlot,
  { layout, rulesText, flavorText, aspect, show }: BoxInput,
  defaults: { pad: { x: number; y: number }; rotation: number; sizePct?: number },
): RulesLayout {
  return fromTopWhenOverflowing(
    fitRulesLayout({
      rulesText,
      flavorText,
      rect: slot.rect,
      aspect,
      sizePct: defaults.sizePct ?? slot.sizePct,
      lineHeight: slot.lineHeight,
      padPx: slot.padPx ?? defaults.pad,
      vAlign: slot.vAlign ?? "start",
      ...(slot.alignSingleLine ? { alignSingleLine: slot.alignSingleLine } : {}),
      ...(slot.paragraphGapMinPx !== undefined ? { paragraphGapMinPx: slot.paragraphGapMinPx } : {}),
      divider: layout.flavorDivider !== false,
      // The frame's symbol style: the inline pip's shadow (TODO 4.8.0).
      ...(layout.symbolStyle ? { symbolStyle: layout.symbolStyle } : {}),
      keepOuts: rulesKeepOuts(drawnStatInk(layout, show, aspect), slot.rect, defaults.rotation, aspect),
      ...(drawnFloats(show).length ? { floats: rulesKeepOuts(drawnFloats(show), slot.rect, defaults.rotation, aspect) } : {}),
    }),
  );
}

/**
 * A text too long for its box even at the floor (the layout clips) is set
 * from the box's TOP whatever the slot's vAlign: the clip then takes the
 * tail — the flavor, the last lines — and never the first rules line. A
 * centred box (M15's, the token's) cut such a text at both ends: "This land
 * enters tapped." sliced through on the long token lands (layout v33
 * review). A layout that fits keeps its alignment.
 */
export function fromTopWhenOverflowing(layout: RulesLayout): RulesLayout {
  const overflows = RULES_TARGETS.some((t) => layout.checks[t].overflowPx > 0);
  if (!layout.clipped || !overflows || (layout.input.vAlign ?? "start") === "start") return layout;
  return { ...layout, input: { ...layout.input, vAlign: "start" } };
}

/**
 * A planeswalker's text ceiling on a frame with ability rows: the rules
 * slot's, capped at the rows' `maxSizePct` (M15PW: 64 px — the walker
 * prints set at most 7.5 pt). The rows always take it, and so does a walker
 * drawn in the plain box (its loyalty shield drawn); any other card on the
 * frame keeps the rules slot's own ceiling (M15PW's 68 px, the v32 8 pt it
 * replaced — a non-walker on the planeswalker frame never shrinks).
 */
export function walkerSizePct(layout: Pick<FrameProfile, "rules" | "loyaltyRows">): number {
  const cap = layout.loyaltyRows?.maxSizePct;
  return cap === undefined ? layout.rules.sizePct : Math.min(layout.rules.sizePct, cap);
}

/** The main rules box's layout (rules + flavor, every template): the
 *  profile's rules slot, its padding (M15's print margins, else 9 / 18) and
 *  alignment, the flavor bar where the frame prints one, and every drawn
 *  stat badge as a keep-out — a walker drawn in the plain box keeps out of
 *  its loyalty shield this way, at the walker ceiling (walkerSizePct). */
export function mainRulesLayout(input: BoxInput): RulesLayout {
  return fitSlot(input.layout.rules, input, {
    pad: RULES_BOX_PAD_PX,
    rotation: 0,
    sizePct: input.show.loyalty ? walkerSizePct(input.layout) : undefined,
  });
}

/** The adventure page's layout (the left storybook page of an Adventure
 *  frame: the back face's rules). Null on a frame without one. */
export function adventureRulesLayout(input: BoxInput): RulesLayout | null {
  const slot = input.layout.adventure?.rules;
  return slot ? fitSlot(slot, input, { pad: ADVENTURE_PAGE_PAD_PX, rotation: 0 }) : null;
}

/** A second face's rules layout (flip / split / aftermath), in the face's
 *  own unturned frame — its keep-outs turned into it. Null on a frame
 *  without one. */
export function secondFaceRulesLayout(input: BoxInput): RulesLayout | null {
  const face = input.layout.secondFace;
  return face ? fitSlot(face.rules, input, { pad: SECOND_FACE_PAD_PX, rotation: face.rotation }) : null;
}

// ---------------------------------------------------------------------------
// Drawing geometry
// ---------------------------------------------------------------------------

export type RulesDrawBlock =
  | {
      kind: "rules" | "flavor";
      /** Space above the block (px at the target). */
      marginTop: number;
      /** The flavor bar (1 px): the gap above it and below it. The block's
       *  marginTop is 0 then. */
      bar: { above: number; below: number; thickness: number } | null;
      /** Each line's runs. */
      lines: RulesItem[][][];
      /** Each line's indent from the column's left edge (px at the
       *  target): 0, or a centred single line's (TextSlot.alignSingleLine,
       *  TODO 4.49 (b)). Both renderers draw a non-zero one as the line's
       *  left margin. */
      indents: number[];
    }
  | { kind: "blank"; marginTop: number; height: number };

/** A fitted layout's geometry at one target, in that target's px. */
export type RulesDraw = {
  target: RulesTarget;
  fontPx: number;
  linePx: number;
  /** The runs' CSS line height (× font size): exactly `linePx`. */
  lineHeight: number;
  wordGapPx: number;
  pipPx: number;
  pipGapPx: number;
  /** The pip disc's top in its line box (RulesMetrics.pipTopPx). */
  pipTopPx: number;
  /** The box's padding. */
  pad: { top: number; right: number; bottom: number; left: number };
  insetTop: number;
  insetBottom: number;
  vAlign: SlotAlign;
  blocks: RulesDrawBlock[];
};

/** The px of one layout at `target`, read off its placement (linePositions):
 *  the box's padding, the column's headroom, every block's margin, the bar. */
export function rulesDraw(layout: RulesLayout, target: RulesTarget): RulesDraw {
  const placed = linePositions(layout, target);
  const m = placed.metrics;
  const { box, interior } = placed;
  // Placement tops can be fractional (a centred block); their differences
  // are whole px.
  const gap = (a: number, b: number) => Math.round(a - b);
  let bottom = placed.top + placed.insetTop;
  const blocks = layout.blocks.map((b, bi): RulesDrawBlock => {
    if (b.kind === "blank") {
      const blank = placed.blanks.find((x) => x.block === bi)!;
      const marginTop = gap(blank.top, bottom);
      bottom = blank.top + blank.height;
      return { kind: "blank", marginTop, height: blank.height };
    }
    const lines = placed.lines.filter((l) => l.block === bi);
    const top = lines[0].top;
    const bar =
      b.kind === "flavor" && bi > 0 && placed.bar
        ? { above: gap(placed.bar.top, bottom), below: gap(top, placed.bar.top + m.barPx), thickness: m.barPx }
        : null;
    const marginTop = bar ? 0 : gap(top, bottom);
    bottom = lines[lines.length - 1].top + m.linePx;
    return { kind: b.kind, marginTop, bar, lines: b.lines.map((l) => l.runs), indents: lines.map((l) => l.indent) };
  });
  return {
    target,
    fontPx: m.fontPx,
    linePx: m.linePx,
    lineHeight: m.linePx / m.fontPx,
    wordGapPx: m.wordGapPx,
    pipPx: m.pipPx,
    pipGapPx: m.pipGapPx,
    pipTopPx: m.pipTopPx,
    pad: {
      top: interior.top - box.top,
      left: interior.left - box.left,
      right: box.left + box.width - (interior.left + interior.width),
      bottom: box.top + box.height - (interior.top + interior.height),
    },
    insetTop: placed.insetTop,
    insetBottom: placed.insetBottom,
    vAlign: layout.input.vAlign ?? "start",
    blocks,
  };
}

/** A word as both renderers draw it: MPlantin has no U+2212 minus, so it is
 *  set as the hyphen-minus it measures as (rules-metrics.ts) — in the preview
 *  too, where the browser would fall back to another face on a nowrap line. */
export function rulesWordText(v: string): string {
  return v.replace(/−/g, "-");
}

/** Whether a layout draws anything. */
export function hasRulesLines(layout: RulesLayout | null | undefined): layout is RulesLayout {
  return Boolean(layout && layout.blocks.some((b) => b.lines.length > 0));
}
