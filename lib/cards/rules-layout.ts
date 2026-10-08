// ---------------------------------------------------------------------------
// The ONE rules-text layout (layout v33, TODO 3.29). A pure module — no React,
// no font parsing — that decides, for a rules box and its text:
//
//   * the size: the largest step of the even HD-px ladder
//     (lib/cards/typography.ts RULES_SIZE_PX) at which the text fits;
//   * every line break, rules AND flavor — computed once and checked against
//     BOTH bake targets, so the live preview, the 750 px bake (OG images,
//     live free downloads) and the HD bake draw the same lines;
//   * every vertical position: line boxes at the prints' 0.98 em pitch,
//     fixed paragraph and flavor gaps, the vAlign offset, and the headroom a
//     first line's accented capital needs inside the box's clip.
//
// Both renderers DRAW its lines — neither wraps rules or flavor text itself:
// each line a `nowrap` flex row of its runs (explicit line height, runs
// `flexShrink: 0`, word gaps as `marginLeft` after the first run), in the
// target's whole px from metricsFor(). The preview draws the HD target's px
// in cqw (px × 100 / RULES_HD_WIDTH), so its geometry is the HD bake's.
//
// Units: "HD px" are px of the stored HD bake — a 1500 px wide portrait card,
// 2100 px landscape (one physical scale). The 750 px bake ("default", the
// RENDER_PRESETS key) is exactly half: its font is the HD px ÷ 2 (an even
// ladder size is a whole px there too), and it rounds its own line height,
// gaps, pips and padding, the way Satori lays out on the pixel grid.
//
// Width model — Satori's (node_modules/satori src/text/index.ts): a text
// node measures its advances (each face's own glyph, lib/cards/rules-
// metrics.ts — Latin-1 and Extended-A included; a character the face lacks
// budgeted a full em) and reports Math.ceil of them to Yoga, so a run's
// words each take their CEILED width (wordWidthPx); pips and gaps are whole
// px. The preview gives every word span that same ceiled width, so its runs
// start where the bake's do (the browser would set a word at its exact
// advances and drift up to 9 HD px left along a line). So a line this
// module accepts at a target is at most as wide as its column, drawn, in
// every renderer — and drawn in the same place.
//
// Height model: a line box of L px puts its baseline (L − 0.999 × size) / 2 +
// 0.774 × size below its top (MPlantin's hhea; Satori rounds it to the px,
// and the web font's metric overrides make every browser use hhea too).
// Letters ink at most 0.70 em above and 0.20 em below it; an accented
// capital up to 0.905 em above — ≈ 0.1 em past a 0.98 em line box's top,
// which the box's `overflow: hidden` would cut on a full box with the
// prints' margins (M15's has none vertically). The layout reserves that
// headroom (insetTop) instead. Sideways likewise: a line's first glyph can
// ink left of its origin (an italic "f" 0.13 em, a pip's hard shadow) and
// its last right of its advance (a roman "f" 0.10 em), past a 4 px margin —
// the layout keeps that side headroom (sideInsets) in the interior, so the
// clip never cuts a letter. A keep-out (a stat badge the card draws) is
// judged glyph by glyph — each glyph's own ink where it sits on the line
// (an "x" dips 0.01 em, a "y" 0.20) — never by the line's band, which held
// "tokens." a few px above a P/T plate a size down.
//
// Positions at the 750 px bake: the same lines, but each target rounds its
// OWN px — the line pitch (0.98 of the target's font, rounded: 0.962–0.974
// em at 750 from 52 to 76 px and 1.0 em from 42 to 50, against HD's
// 0.974–0.986), the word gap, each word's ceiled box. Line tops at 750
// drift from HD's (halved) by up to 6 HD px on a public card that fits, and
// a line's later words by up to 20 HD px sideways; each image is consistent
// in itself. (Deriving the 750 positions from HD's instead would re-fit
// every card at 750 — a taller 750 block steps some cards down — so v33
// keeps the per-target rounding the fit checked; layout v33 review.)
// ---------------------------------------------------------------------------

import { plateInkRect } from "@/lib/cards/plate-ink";
import {
  MPLANTIN_LINE_METRICS,
  rulesTextGlyphsEm,
  rulesTextInkEm,
  rulesTextSideInkEm,
  rulesTextWidthEm,
} from "@/lib/cards/rules-metrics";
import { groupTightRuns, tokenizeRulesText, type RulesItem } from "@/lib/cards/rules-text";
import { discShadowPx, symbolStyle, type SymbolStyle } from "@/lib/cards/symbol-style";
import type { FrameProfile, Rect, SlotAlign, StatSlot } from "@/lib/cards/template-layout";
import {
  RULES_BOX_PAD_PX,
  RULES_HD_WIDTH,
  RULES_SIZE_PX,
  RULES_TEXT,
  orientationFromAspect,
  rulesPctToPx,
  rulesPxToPct,
  type CardOrientation,
} from "@/lib/cards/typography";

// ---------------------------------------------------------------------------
// Targets and metrics
// ---------------------------------------------------------------------------

/** The render targets a layout must fit: the HD bake (which the preview's
 *  geometry equals) and the 750 px bake — RENDER_PRESETS' keys. */
export type RulesTarget = "hd" | "default";
export const RULES_TARGETS: readonly RulesTarget[] = ["hd", "default"];

/** Target px per HD px. */
export const RULES_TARGET_SCALE: Readonly<Record<RulesTarget, number>> = { hd: 1, default: 0.5 };

/** The target a bake `cardWidth` px wide draws (RENDER_PRESETS): the HD
 *  bake at RULES_HD_WIDTH, the 750 px one (1050 landscape) below it. */
export function rulesTargetFor(cardWidth: number, orientation: CardOrientation): RulesTarget {
  return cardWidth >= RULES_HD_WIDTH[orientation] ? "hd" : "default";
}

// The bake's hard shadow under an inline pip (lib/render/card-image.tsx
// ManaGem) is the frame's SYMBOL STYLE's (lib/cards/symbol-style.ts, TODO
// 4.8.0): on "modern", max(1, round(disc × 0.07)) down and max(1, round(disc
// × 0.06)) to the left (the preview's .ms-shadow: 0.07 / 0.06 of 1.3 em).
// metricsFor reads it through discShadowPx, so a style with another shadow
// (or none) moves the ink the layout keeps clear with it.

/** One size's rules metrics at one target, in that target's whole px (the
 *  font excepted: an odd HD size is a half px at 750 — the ladder is even). */
export type RulesMetrics = {
  target: RulesTarget;
  /** Target px per HD px. */
  scale: number;
  /** The size in HD px this was computed for. */
  sizePx: number;
  fontPx: number;
  /** Line box height = the line pitch (RULES_TEXT.lineHeight × font). */
  linePx: number;
  /** Gap between two runs on a line (a word space). */
  wordGapPx: number;
  /** Inline pip disc diameter, and the hairline between adjacent pips. */
  pipPx: number;
  pipGapPx: number;
  /** The pip disc's top below its line box's top (layout v36, TODO 3.31):
   *  the disc centred RULES_TEXT.pipCentreEm above the regular baseline, as
   *  the prints centre it on the capitals, rounded to the px. Both renderers
   *  draw the disc at exactly this top — never centred in the line box, which
   *  put its centre 21 px above the baseline at 76 px type against the
   *  prints' 25. May be 0 (or a px negative at the smallest 750 px sizes). */
  pipTopPx: number;
  /** How far a pip's hard shadow reaches below its disc, and left of it. */
  pipShadowPx: number;
  pipShadowLeftPx: number;
  /** Line box to line box between two paragraphs. */
  paragraphGapPx: number;
  /** Rules → flavor: above the bar and again below it. */
  flavorGapPx: number;
  /** Rules → flavor with no bar. */
  flavorGapNoBarPx: number;
  /** The flavor bar's thickness: 1 px at every target (TODO 3.19). */
  barPx: number;
  /** A blank source line's height. */
  blankLinePx: number;
  /** Baseline below a line box's top, per face (whole px, as Satori sets
   *  it; the browser's is within half a px). */
  baselinePx: { regular: number; italic: number };
};

/** Whole target px of an HD px value. */
function targetPx(hdPx: number, scale: number): number {
  return Math.round(hdPx * scale);
}

/**
 * The whole-px rules metrics of `sizePx` (HD px) at `target`: what that
 * renderer draws, and what this module lays out with. `lineHeight` is the
 * slot's (a profile override) or RULES_TEXT's.
 */
export function metricsFor(
  sizePx: number,
  lineHeight: number = RULES_TEXT.lineHeight,
  target: RulesTarget = "hd",
  symbols?: SymbolStyle,
): RulesMetrics {
  const pipShadow = (discPx: number) => discShadowPx(symbolStyle(symbols), discPx);
  const scale = RULES_TARGET_SCALE[target];
  const fontPx = sizePx * scale;
  const linePx = Math.round(fontPx * lineHeight);
  const pipPx = Math.round(fontPx * RULES_TEXT.pipDiscEm);
  const baseline = (face: { ascent: number; descent: number }) =>
    Math.round(face.ascent * fontPx + (linePx - (face.ascent + face.descent) * fontPx) / 2);
  const regularBaseline = baseline(MPLANTIN_LINE_METRICS.regular);
  return {
    target,
    scale,
    sizePx,
    fontPx,
    linePx,
    wordGapPx: Math.round(fontPx * RULES_TEXT.wordGapEm),
    pipPx,
    pipGapPx: Math.max(1, Math.round(fontPx * RULES_TEXT.pipGapEm)),
    pipTopPx: Math.round(regularBaseline - RULES_TEXT.pipCentreEm * fontPx - pipPx / 2),
    pipShadowPx: pipShadow(pipPx).down,
    pipShadowLeftPx: pipShadow(pipPx).left,
    paragraphGapPx: targetPx(RULES_TEXT.paragraphGapPx, scale),
    flavorGapPx: targetPx(RULES_TEXT.flavorGapPx, scale),
    flavorGapNoBarPx: targetPx(RULES_TEXT.flavorGapNoBarPx, scale),
    barPx: 1,
    blankLinePx: Math.round(fontPx * RULES_TEXT.blankLineEm),
    baselinePx: { regular: regularBaseline, italic: baseline(MPLANTIN_LINE_METRICS.italic) },
  };
}

// ---------------------------------------------------------------------------
// Runs, lines and blocks
// ---------------------------------------------------------------------------

/** One drawn line: its unbreakable runs (groupTightRuns) and its width at
 *  each target, as that target draws it. */
export type RulesLine = {
  runs: RulesItem[][];
  widthPx: Readonly<Record<RulesTarget, number>>;
};

/** A paragraph of rules text, a blank source line, or the flavor text (every
 *  flavor source line, wrapped, at the same pitch — the attribution line
 *  included). A layout has at most one flavor block, last. */
export type RulesBlock =
  | { kind: "rules"; lines: RulesLine[] }
  | { kind: "blank"; lines: [] }
  | { kind: "flavor"; lines: RulesLine[] };

/** A word's box as `m`'s target draws it: its advances (italic for any
 *  emphasis) CEILED to the px — Satori's text measure. The bake's word gets
 *  this width from Satori; the preview gives its word span this width
 *  explicitly (the browser would lay it out at the exact advances, and every
 *  run after it would start up to a px per word left of the bake's). */
export function wordWidthPx(item: Extract<RulesItem, { t: "w" }>, m: Pick<RulesMetrics, "fontPx">): number {
  return Math.ceil(rulesTextWidthEm(item.v, Boolean(item.em)) * m.fontPx - 1e-6);
}

/** A run's width as `m`'s target draws it: each word its box (wordWidthPx),
 *  each pip a whole-px disc, adjacent pips a hairline apart. */
export function runWidthPx(run: readonly RulesItem[], m: RulesMetrics): number {
  let w = 0;
  run.forEach((item, i) => {
    if (item.t === "m") {
      w += m.pipPx + (i > 0 && run[i - 1].t === "m" ? m.pipGapPx : 0);
    } else {
      w += wordWidthPx(item, m);
    }
  });
  return w;
}

/** A line's width at `m`'s target: its runs `wordGapPx` apart. */
function lineWidthPx(runs: readonly RulesItem[][], m: RulesMetrics): number {
  return runs.reduce((w, run, i) => w + (i > 0 ? m.wordGapPx : 0) + runWidthPx(run, m), 0);
}

/** A lone em dash after a word — "choose one —", "Landfall —": printed cards
 *  never start a line with it (the vow-63 print sets "choose up to" / "one
 *  —"), so it breaks with the word before it. It stays its own run, a word
 *  gap after that word, as both renderers draw it. */
function gluesToWord(run: readonly RulesItem[], before: readonly RulesItem[] | undefined): boolean {
  const only = run.length === 1 ? run[0] : null;
  return only?.t === "w" && only.v === "—" && before?.[before.length - 1]?.t === "w";
}

/** The runs a flavor source line breaks into: its words, italic. */
function flavorRuns(line: string): RulesItem[][] {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .map((v) => [{ t: "w", v, em: "flavor" }]);
}

/** Greedy line breaking over `runs`, checked at every target: a run moves to
 *  a new line when the line it would join is wider than its column at ANY
 *  target (each with its own whole-px gaps and pips — at s = 50, 58, 66 and
 *  74 the 750 bake's word gap, doubled, is a px wider than the HD one). A run
 *  wider than the column gets a line of its own. A lone em dash that would
 *  start a line takes the word before it along (gluesToWord) — the same
 *  break at both targets, unless the pair is wider than a column itself. */
function breakRuns(
  runs: readonly RulesItem[][],
  metrics: Readonly<Record<RulesTarget, RulesMetrics>>,
  columns: Readonly<Record<RulesTarget, number>>,
  lineColumns?: LineColumns,
  lineOffset = 0,
): RulesLine[] {
  const lines: RulesLine[] = [];
  let current: RulesItem[][] = [];
  let width: Record<RulesTarget, number> = { hd: 0, default: 0 };
  const widthOf = (line: readonly RulesItem[][]) => ({
    hd: lineWidthPx(line, metrics.hd),
    default: lineWidthPx(line, metrics.default),
  });
  // The column of the line being built: a float's narrower one where a
  // float names this line (by its global index), the box's otherwise.
  const columnsAt = (index: number) => lineColumns?.get(lineOffset + index) ?? columns;
  for (const run of runs) {
    const cols = columnsAt(lines.length);
    const next = { hd: 0, default: 0 };
    let overflows = false;
    for (const t of RULES_TARGETS) {
      const m = metrics[t];
      next[t] = width[t] + (current.length > 0 ? m.wordGapPx : 0) + runWidthPx(run, m);
      if (next[t] > cols[t]) overflows = true;
    }
    if (current.length > 1 && overflows && gluesToWord(run, current[current.length - 1])) {
      const pair = [current[current.length - 1], run];
      const pairWidth = widthOf(pair);
      const nextCols = columnsAt(lines.length + 1);
      if (RULES_TARGETS.every((t) => pairWidth[t] <= nextCols[t])) {
        const kept = current.slice(0, -1);
        lines.push({ runs: kept, widthPx: widthOf(kept) });
        current = pair;
        width = pairWidth;
        continue;
      }
    }
    if (current.length > 0 && overflows) {
      lines.push({ runs: current, widthPx: width });
      current = [run];
      width = { hd: runWidthPx(run, metrics.hd), default: runWidthPx(run, metrics.default) };
    } else {
      current.push(run);
      width = next;
    }
  }
  if (current.length > 0) lines.push({ runs: current, widthPx: width });
  return lines;
}

/**
 * The blocks `rulesText` and `flavorText` break into at `sizePx` in a column
 * `columns[target]` px wide at each target — the rules paragraphs (source
 * lines; a blank one is a "blank" block), then the flavor. Texts are trimmed
 * first; blank flavor lines are dropped (as both renderers always did).
 */
export function breakRulesText(
  rulesText: string | null | undefined,
  flavorText: string | null | undefined,
  sizePx: number,
  columns: Readonly<Record<RulesTarget, number>>,
  lineHeight: number = RULES_TEXT.lineHeight,
): RulesBlock[] {
  return breakParsed(parseText(rulesText, flavorText), sizePx, columns, lineHeight);
}

/** A card's text as runs, once for every ladder step: each rules paragraph's
 *  runs (null for a blank source line), then each flavor source line's. */
type ParsedText = { rules: (RulesItem[][] | null)[]; flavor: RulesItem[][][] };

function parseText(rulesText: string | null | undefined, flavorText: string | null | undefined): ParsedText {
  const rules = rulesText?.trim() ?? "";
  return {
    rules: rules ? tokenizeRulesText(rules).map((items) => (items.length === 0 ? null : groupTightRuns(items))) : [],
    flavor: (flavorText?.trim() ?? "")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map(flavorRuns),
  };
}

/** The columns of the lines a float narrows (floatColumnsFor): the global
 *  line index — the rules paragraphs' lines in order, then the flavor's —
 *  to its columns at both targets; a line not named takes the box's. */
type LineColumns = ReadonlyMap<number, Readonly<Record<RulesTarget, number>>>;

function breakParsed(
  parsed: ParsedText,
  sizePx: number,
  columns: Readonly<Record<RulesTarget, number>>,
  lineHeight: number,
  lineColumns?: LineColumns,
): RulesBlock[] {
  const metrics = { hd: metricsFor(sizePx, lineHeight, "hd"), default: metricsFor(sizePx, lineHeight, "default") };
  let offset = 0;
  const blocks: RulesBlock[] = parsed.rules.map((runs) => {
    if (runs === null) return { kind: "blank", lines: [] };
    const lines = breakRuns(runs, metrics, columns, lineColumns, offset);
    offset += lines.length;
    return { kind: "rules", lines };
  });
  if (parsed.flavor.length > 0) {
    const lines = parsed.flavor.flatMap((runs) => {
      const broken = breakRuns(runs, metrics, columns, lineColumns, offset);
      offset += broken.length;
      return broken;
    });
    blocks.push({ kind: "flavor", lines });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// The box
// ---------------------------------------------------------------------------

/** A rules box's padding in HD px: `x` / `y` both sides, or each side. */
export type RulesPadPx =
  | { x: number; y: number }
  | { left: number; right: number; top: number; bottom: number };

type Sides = { left: number; right: number; top: number; bottom: number };

function sides(pad: RulesPadPx): Sides {
  return "x" in pad ? { left: pad.x, right: pad.x, top: pad.y, bottom: pad.y } : pad;
}

/** A card-relative rect as Yoga lays out `slotBox(rect)` at a target: its
 *  edges rounded to the px (so the width is the difference of rounded edges,
 *  not the rounded width). */
export function rectPx(rect: Rect, orientation: CardOrientation, aspect: number, target: RulesTarget) {
  const width = RULES_HD_WIDTH[orientation] * RULES_TARGET_SCALE[target];
  // 1500 × 7/5 is 2099.9999…: the card's height is a whole px.
  const height = Math.round(width * aspect);
  const x0 = (rect.leftPct / 100) * width;
  const y0 = (rect.topPct / 100) * height;
  const left = Math.round(x0);
  const top = Math.round(y0);
  const right = Math.round(x0 + (rect.widthPct / 100) * width);
  const bottom = Math.round(y0 + (rect.heightPct / 100) * height);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export type RulesLayoutInput = {
  rulesText: string | null | undefined;
  flavorText?: string | null | undefined;
  /** The box both renderers draw (card-relative percents) — in its OWN frame
   *  for a rotated second face (the rect before the renderer turns it). */
  rect: Rect;
  /** Card height ÷ card width: 7/5 portrait, 5/7 landscape. */
  aspect: number;
  /** The slot's size (fraction of card width): the ladder's ceiling,
   *  snapped DOWN to the even HD-px grid. */
  sizePct: number;
  /** The slot's line height (a profile override); RULES_TEXT's otherwise. */
  lineHeight?: number;
  /** The box's padding in HD px (default RULES_BOX_PAD_PX). A function of
   *  the size for boxes whose column depends on it (the walker rows' badge
   *  rail); a walker's last-row shield inset is extra `right` padding. */
  padPx?: RulesPadPx | ((sizePx: number) => RulesPadPx);
  /** Vertical alignment of the block in the box; default "start". */
  vAlign?: SlotAlign;
  /** "center": a layout of ONE rules line in all (no flavor, no second
   *  paragraph) sets it centred in the column — TextSlot.alignSingleLine
   *  (TODO 4.49 (b)). Each target indents it by its own whole px
   *  (singleLineIndentPx), and the keep-outs are judged where it lands. */
  alignSingleLine?: "center";
  /** "center": EVERY line of the block — rules, reminder and flavor alike —
   *  is set centred on the box's own centre line (TODO 4.21e: a split
   *  half's short text as MH2 #123, TSR #156 / #161 / #186 and C16 #239 /
   *  #240 print it — each line's centre on the paper's centre). The box's
   *  centre is the middle of the box less its padding, NOT of the column
   *  the side headroom leaves (sideInsets): a line that starts with an
   *  italic "f" must not pull every other line 1 px off the paper's
   *  centre. Each target indents each line by its own whole px
   *  (centredLineIndentPx); the size (fitRulesLayout fits the left-aligned
   *  twin first), the breaks and every vertical position are exactly the
   *  left-aligned layout's — the lines only move sideways — and a line
   *  whose centred place would land on a keep-out or a float is held short
   *  of it (heldLineIndentPx), never a size step. Unset: every
   *  line starts at the left. Card data (FrameStyle.rulesAlign), offered
   *  only where the profile declares FrameProfile.rulesAlignSwitch. */
  align?: "center";
  /** The frame's symbol style (FrameProfile.symbolStyle, TODO 4.8.0): the
   *  inline pip's shadow, which the layout keeps inside the box and out of
   *  the keep-outs. Unset = "modern". */
  symbolStyle?: SymbolStyle;
  /** Whether a flavor block after rules text gets the 1 px bar (M15-era
   *  frames) or the no-bar gap. Default true. */
  divider?: boolean;
  /** Rects (card-relative percents, in the box's frame — see
   *  keepOutInBoxFrame) no line's ink may enter: the stat badges the card
   *  DRAWS (statKeepOuts). A size where one does steps down. */
  keepOuts?: readonly Rect[];
  /** Rects (card-relative percents, in the box's frame) the lines WRAP
   *  ROUND (TODO 5.1d): a line whose box rows meet a float breaks against a
   *  column ending at the float's left edge — the prints' setting round the
   *  transform front's reverse P/T, whose grey digits sit INSIDE the box's
   *  lower rows (80–155 px above its bottom at HD), where no size step could
   *  clear a plain keep-out. A float is a keep-out too (its rect is judged
   *  glyph by glyph like keepOuts', and a size where ink still enters it
   *  steps down); the plate, stamp and strip stay keepOuts — a float never
   *  moves a card that has none. */
  floats?: readonly Rect[];
  /** TextSlot.paragraphGapMinPx (TODO 4.48, the full-art token's tall box):
   *  before a size steps down, fitRulesLayout sets the text at that size with
   *  its paragraph gaps squeezed — RULES_TEXT.paragraphGapPx down to this
   *  (HD px), RULES_SIZE_PX.stepPx at a time — and takes the widest gap
   *  that fits, as the prints do (TBLB #5 keeps 9 pt with 10–13 px gaps).
   *  Unset: the gap never moves (every other box). */
  paragraphGapMinPx?: number;
  /** The paragraph gap (HD px) the layout was placed with — the squeeze's
   *  pick, set by fitRulesLayout; unset, RULES_TEXT.paragraphGapPx. What
   *  linePositions places, so both renderers draw the fitted gap. */
  paragraphGapPx?: number;
};

/** One target's verdict on a layout. */
export type RulesTargetCheck = {
  /** Block height (insets included) − interior height; ≤ 0 fits. */
  overflowPx: number;
  /** A line's ink enters a keep-out. */
  keepOutHit: boolean;
  /** A single run is wider than the column (it can't wrap). */
  overwideRun: boolean;
  fits: boolean;
};

export type RulesLayout = {
  /** Size in HD px (even on the ladder). */
  sizePx: number;
  /** The size as the profile unit (fraction of card width). */
  sizePct: number;
  orientation: CardOrientation;
  lineHeight: number;
  blocks: RulesBlock[];
  /** Drawn at this size, the text overflows its box or runs into a keep-out
   *  at some target. fitRulesLayout returns a clipped layout only at the
   *  floor (it clips there, as it always has — the box keeps overflow
   *  hidden). */
  clipped: boolean;
  checks: Readonly<Record<RulesTarget, RulesTargetCheck>>;
  /** Headroom kept beside the lines at each target, whole px: how far a
   *  line's first glyph inks left of its start (an italic "f", "j", "p"; a
   *  pip's hard shadow) or its last glyph right of its end (a roman "f", an
   *  italic "W") past the box's padding on that side — so the box's clip
   *  never cuts it. Part of the interior's inset (RulesPlacement). */
  sideInsets: Readonly<Record<RulesTarget, SideInset>>;
  /** What the positions are computed from. */
  input: RulesLayoutInput;
};

/** Headroom beside the lines, whole target px. */
export type SideInset = { left: number; right: number };
const NO_SIDE_INSET: SideInset = { left: 0, right: 0 };

function padFor(input: RulesLayoutInput, sizePx: number): Sides {
  const pad = typeof input.padPx === "function" ? input.padPx(sizePx) : (input.padPx ?? RULES_BOX_PAD_PX);
  return sides(pad);
}

// ---------------------------------------------------------------------------
// Placement — where each line lands at a target
// ---------------------------------------------------------------------------

export type RulesLinePlacement = {
  /** Index into layout.blocks, and of the line within its block. */
  block: number;
  line: number;
  /** How far the line starts right of the interior's left edge, whole
   *  target px: 0, a centred single line's indent (singleLineIndentPx), or
   *  a centred block's line's (RulesLayoutInput.align, centredLineIndentPx). */
  indent: number;
  /** The line box, card-absolute target px (top may be fractional: a
   *  centred block's offset is not rounded here; Yoga rounds each box). */
  top: number;
  left: number;
  width: number;
  height: number;
  /** Ink reach of this line's glyphs and pips, card-absolute: above and
   *  below, and left of its start / right of its end (a glyph past its
   *  advance, a pip's shadow). */
  inkTop: number;
  inkBottom: number;
  inkLeft: number;
  inkRight: number;
};

export type RulesPlacement = {
  target: RulesTarget;
  metrics: RulesMetrics;
  /** The box (the clip) and its interior: the box less its padding and the
   *  side headroom (RulesLayout.sideInsets) — where the lines start, and the
   *  column they break in. */
  box: { left: number; top: number; width: number; height: number };
  interior: { left: number; top: number; width: number; height: number };
  /** Headroom reserved above the first line / below the last so their ink
   *  stays inside the box: the ink's reach past the line box less the
   *  padding on that side, whole px. The renderers draw these as padding on
   *  the text column. */
  insetTop: number;
  insetBottom: number;
  /** Lines + gaps, without the insets. */
  blockHeight: number;
  /** Top of the inset-top spacer (the vAlign offset applied). */
  top: number;
  lines: RulesLinePlacement[];
  /** Blank blocks' boxes (a paragraph break's height). */
  blanks: { block: number; top: number; height: number }[];
  /** The flavor bar (1 px), when one is drawn. */
  bar: { top: number; left: number; width: number } | null;
};

/** The ink reach of one line, relative to its line box's top. */
function lineInk(line: RulesLine, m: RulesMetrics): { top: number; bottom: number } {
  let top = Infinity;
  let bottom = -Infinity;
  for (const run of line.runs) {
    for (const item of run) {
      if (item.t === "m") {
        top = Math.min(top, m.pipTopPx);
        bottom = Math.max(bottom, m.pipTopPx + m.pipPx + m.pipShadowPx);
      } else {
        const ink = rulesTextInkEm(item.v);
        const baseline = item.em ? m.baselinePx.italic : m.baselinePx.regular;
        top = Math.min(top, baseline - ink.ascent * m.fontPx);
        bottom = Math.max(bottom, baseline + ink.descent * m.fontPx);
      }
    }
  }
  return Number.isFinite(top) ? { top, bottom } : { top: 0, bottom: 0 };
}

/** How far one line's ink reaches past its start (left) and its end (right):
 *  its first item's (a word's first glyph past its origin, a pip's shadow)
 *  and its last word's last glyph past its advance. */
function lineSideInk(line: RulesLine, m: RulesMetrics): SideInset {
  const firstRun = line.runs[0];
  const lastRun = line.runs[line.runs.length - 1];
  const first = firstRun?.[0];
  const last = lastRun?.[lastRun.length - 1];
  const left = !first
    ? 0
    : first.t === "m"
      ? m.pipShadowLeftPx
      : rulesTextSideInkEm(first.v, Boolean(first.em)).left * m.fontPx;
  const right = !last || last.t === "m" ? 0 : rulesTextSideInkEm(last.v, Boolean(last.em)).right * m.fontPx;
  return { left, right };
}

/** The side headroom `blocks` need at `m`'s target past the padding `pad`
 *  (target px): the most any line's ink reaches beyond it, whole px. */
function sideInsetNeeded(blocks: readonly RulesBlock[], m: RulesMetrics, pad: Sides): SideInset {
  let left = 0;
  let right = 0;
  for (const b of blocks) {
    for (const line of b.lines) {
      const ink = lineSideInk(line, m);
      left = Math.max(left, Math.ceil(ink.left - pad.left - 1e-6));
      right = Math.max(right, Math.ceil(ink.right - pad.right - 1e-6));
    }
  }
  return { left, right };
}

/** A padding in HD px at a target, whole px. */
function targetPad(pad: Sides, scale: number): Sides {
  return {
    left: targetPx(pad.left, scale),
    right: targetPx(pad.right, scale),
    top: targetPx(pad.top, scale),
    bottom: targetPx(pad.bottom, scale),
  };
}

/** The gap drawn before block `i`: none before the first; the flavor gap
 *  (bar or not) before a flavor block that follows rules; the paragraph gap
 *  otherwise. */
function gapBefore(blocks: readonly RulesBlock[], i: number, m: RulesMetrics, divider: boolean): number {
  if (i === 0) return 0;
  if (blocks[i].kind === "flavor") return divider ? 2 * m.flavorGapPx + m.barPx : m.flavorGapNoBarPx;
  return m.paragraphGapPx;
}

/** Lines + gaps of `blocks` at `m`, without insets. */
function blocksHeight(blocks: readonly RulesBlock[], m: RulesMetrics, divider: boolean): number {
  let h = 0;
  blocks.forEach((b, i) => {
    h += gapBefore(blocks, i, m, divider) + (b.kind === "blank" ? m.blankLinePx : b.lines.length * m.linePx);
  });
  return h;
}

/** Whether `blocks` are the ONE rules line a centring slot centres
 *  (RulesLayoutInput.alignSingleLine): a single rules block of a single
 *  line, nothing else — a flavor text, a blank line or a second paragraph
 *  keeps every line at the left. */
export function isSingleRulesLine(blocks: readonly RulesBlock[]): boolean {
  return blocks.length === 1 && blocks[0].kind === "rules" && blocks[0].lines.length === 1;
}

/** A centred single line's indent at a target: half the room the line
 *  leaves in the column, floored to the whole px (both renderers draw it as
 *  a margin, so the preview's line starts where the bake's does). Never
 *  negative (an overwide run starts at the left, as it always has). */
export function singleLineIndentPx(interiorWidth: number, lineWidth: number): number {
  return Math.max(0, Math.floor((interiorWidth - lineWidth) / 2));
}

/**
 * A centred block's line indent at a target (RulesLayoutInput.align, TODO
 * 4.21e): the whole px that puts the line's centre nearest `centre` — the
 * box's centre line, measured from the interior's left edge — held inside
 * the interior (a line as wide as the column starts at its left; an
 * overwide run too, as it always has). Both renderers draw it as the line's
 * left margin.
 */
export function centredLineIndentPx(interiorWidth: number, lineWidth: number, centre: number): number {
  const room = interiorWidth - lineWidth;
  if (room <= 0) return 0;
  return Math.min(Math.floor(room), Math.max(0, Math.round(centre - lineWidth / 2)));
}

/** The air a centred line HELD short of a keep-out keeps from it, HD px,
 *  where the room allows (heldLineIndentPx): a third of the smallest rules
 *  size's em — a line set against a plate must not touch it. */
export const HELD_LINE_AIR_PX = 14;

/**
 * Where a centred line is set when its centred place puts ink in a drawn
 * keep-out (TODO 4.21e, owner 2026-10-07: held short, never a size step):
 * the whole-px indent in 0 … `max` NEAREST `want` (the centred indent; the
 * smaller on a tie) at which none of the line's ink `boxes` (card px, at
 * indent 0) enters any of `keepOuts` — first keeping `air` px beside them,
 * then, where no place has that much room, touching none. `want` itself when
 * it is already clear (the line is not moved), and when no indent clears
 * them (the left-aligned line at indent 0 hits too: the layout is clipped
 * at that size, as its left-aligned twin is).
 */
export function heldLineIndentPx(
  want: number,
  max: number,
  boxes: readonly { left: number; right: number; top: number; bottom: number }[],
  keepOuts: readonly { left: number; right: number; top: number; bottom: number }[],
  air: number,
): number {
  // Each glyph × keep-out that share rows forbids the open interval of
  // indents at which they overlap.
  const forbidden: [number, number][] = [];
  for (const k of keepOuts) {
    for (const g of boxes) {
      if (!(g.bottom > k.top && g.top < k.bottom)) continue;
      forbidden.push([k.left - g.right, k.right - g.left]);
    }
  }
  const clear = (indent: number, pad: number) => !forbidden.some(([a, b]) => indent > a - pad && indent < b + pad);
  if (forbidden.length === 0 || clear(want, 0)) return want;
  for (const pad of air > 0 ? [air, 0] : [0]) {
    for (let d = 0; d <= Math.max(want, max); d += 1) {
      if (want - d >= 0 && want - d <= max && clear(want - d, pad)) return want - d;
      if (want + d <= max && want + d >= 0 && clear(want + d, pad)) return want + d;
    }
  }
  return want;
}

function placeBlocks(
  blocks: readonly RulesBlock[],
  sizePx: number,
  input: RulesLayoutInput,
  target: RulesTarget,
  side: SideInset,
): RulesPlacement {
  const orientation = orientationFromAspect(input.aspect);
  const lineHeight = input.lineHeight ?? RULES_TEXT.lineHeight;
  const base = metricsFor(sizePx, lineHeight, target, input.symbolStyle);
  // A squeezed paragraph gap (fitRulesLayout, paragraphGapMinPx): whole px
  // at each target, like every gap.
  const m =
    input.paragraphGapPx === undefined ? base : { ...base, paragraphGapPx: targetPx(input.paragraphGapPx, base.scale) };
  const divider = input.divider ?? true;
  const box = rectPx(input.rect, orientation, input.aspect, target);
  const p = targetPad(padFor(input, sizePx), m.scale);
  const interior = {
    left: box.left + p.left + side.left,
    top: box.top + p.top,
    width: box.width - p.left - p.right - side.left - side.right,
    height: box.height - p.top - p.bottom,
  };
  const blockHeight = blocksHeight(blocks, m, divider);

  // The ink past the first line box's top and the last one's bottom, beyond
  // what the padding on that side absorbs.
  const lined = blocks.filter((b) => b.lines.length > 0);
  const first = lined[0]?.lines[0];
  const lastBlock = lined[lined.length - 1];
  const last = lastBlock?.lines[lastBlock.lines.length - 1];
  const firstInk = first ? lineInk(first, m) : { top: 0, bottom: 0 };
  const lastInk = last ? lineInk(last, m) : { top: 0, bottom: 0 };
  const firstIsTop = blocks[0]?.kind !== "blank";
  const insetTop = first && firstIsTop ? Math.max(0, Math.ceil(-firstInk.top - p.top - 1e-6)) : 0;
  const insetBottom =
    last && blocks[blocks.length - 1]?.lines.length ? Math.max(0, Math.ceil(lastInk.bottom - m.linePx - p.bottom - 1e-6)) : 0;

  const total = insetTop + blockHeight + insetBottom;
  const align = input.vAlign ?? "start";
  const offset =
    align === "center" ? (interior.height - total) / 2 : align === "end" ? interior.height - total : 0;
  const top = interior.top + offset;

  const lines: RulesLinePlacement[] = [];
  const blanks: RulesPlacement["blanks"] = [];
  let bar: RulesPlacement["bar"] = null;
  let y = top + insetTop;
  const centred = input.alignSingleLine === "center" && isSingleRulesLine(blocks);
  // A centred BLOCK (TODO 4.21e): the box's centre line — the middle of the
  // box less its padding — from the interior's left edge.
  const blockCentre =
    input.align === "center" ? (box.width - p.left - p.right) / 2 - side.left : null;
  // A centred line whose rows meet a FLOAT (the transform front's reverse
  // P/T) is centred on the box like every other, but never past the float:
  // its room ends at the float's left edge, as the column it broke against
  // does (floatColumnsFor) — less the ink its last glyph puts past its
  // advance (`inkPastEnd`, lineSideInk: a regular "r", an italic "l"). A
  // line held back sits FLUSH against the float, and the float is judged on
  // ink like a keep-out: without that allowance every such line was a hit
  // and the size stepped down for nothing. A float leaving less than the
  // line is ignored here — the keep-out check then steps the size down.
  const floatRects =
    blockCentre !== null ? (input.floats ?? []).map((f) => rectPx(f, orientation, input.aspect, target)) : [];
  const lineColumn = (lineTop: number, inkPastEnd: number): number => {
    let column = interior.width;
    for (const f of floatRects) {
      if (lineTop < f.bottom && lineTop + m.linePx > f.top) column = Math.min(column, f.left - interior.left - inkPastEnd);
    }
    return column;
  };
  // A centred line that would LAND ON a drawn keep-out — the P/T plate, the
  // stamp's arch, the battle's shield, the modal strip, a float's digits —
  // is HELD SHORT of it (owner 2026-10-07): set at the whole-px indent
  // nearest its centred one at which no glyph of it enters any keep-out
  // (heldLineIndentPx), with HELD_LINE_AIR_PX of air where the room allows.
  // The left-aligned line's own place (indent 0) is always a candidate, so
  // a centred text fits at every size its left-aligned twin fits — never
  // smaller, never clipped where Left is not. A line that meets no keep-out
  // where it is centred is not touched.
  const heldRects =
    blockCentre !== null
      ? [...(input.keepOuts ?? []), ...(input.floats ?? [])].map((r) => rectPx(r, orientation, input.aspect, target))
      : [];
  const heldAir = Math.round(HELD_LINE_AIR_PX * m.scale);
  blocks.forEach((b, bi) => {
    const gap = gapBefore(blocks, bi, m, divider);
    if (b.kind === "flavor" && bi > 0 && divider) {
      bar = { top: y + m.flavorGapPx, left: interior.left, width: interior.width };
    }
    y += gap;
    if (b.kind === "blank") {
      blanks.push({ block: bi, top: y, height: m.blankLinePx });
      y += m.blankLinePx;
      return;
    }
    b.lines.forEach((line, li) => {
      const ink = lineInk(line, m);
      const sideInk = lineSideInk(line, m);
      let indent =
        blockCentre !== null
          ? centredLineIndentPx(lineColumn(y, sideInk.right), line.widthPx[target], blockCentre)
          : centred
            ? singleLineIndentPx(interior.width, line.widthPx[target])
            : 0;
      if (blockCentre !== null && heldRects.length > 0) {
        const inkTop = y + ink.top;
        const inkBottom = y + ink.bottom;
        const met = heldRects.filter((k) => inkBottom > k.top && inkTop < k.bottom);
        if (met.length > 0) {
          indent = heldLineIndentPx(
            indent,
            Math.max(0, Math.floor(interior.width - line.widthPx[target])),
            lineInkBoxes(line, m).map((g) => ({ left: interior.left + g.left, right: interior.left + g.right, top: y + g.top, bottom: y + g.bottom })),
            met,
            heldAir,
          );
        }
      }
      const left = interior.left + indent;
      lines.push({
        block: bi,
        line: li,
        indent,
        top: y,
        left,
        width: line.widthPx[target],
        height: m.linePx,
        inkTop: y + ink.top,
        inkBottom: y + ink.bottom,
        inkLeft: left - sideInk.left,
        inkRight: left + line.widthPx[target] + sideInk.right,
      });
      y += m.linePx;
    });
  });
  return {
    target,
    metrics: m,
    box: { left: box.left, top: box.top, width: box.width, height: box.height },
    interior,
    insetTop,
    insetBottom,
    blockHeight,
    top,
    lines,
    blanks,
    bar,
  };
}

type InkBox = { left: number; right: number; top: number; bottom: number };

/**
 * Where one line's glyphs and pips put ink, each its own box, relative to
 * its line box's top-left at `m`'s target: every word at its drawn place
 * (runs `wordGapPx` apart, each word its ceiled box, pips whole-px discs a
 * hairline apart — as both renderers set them), each glyph with its OWN ink
 * (rules-metrics.ts rulesTextGlyphsEm: an "x" dips 0.01 em, a "y" 0.20),
 * each pip its disc and hard shadow. Every box stays inside the line's own
 * band (lineInk, and its side ink), so a keep-out judged glyph by glyph is
 * hit only where the band was — never more (layout v33 review).
 */
function lineInkBoxes(line: RulesLine, m: RulesMetrics): InkBox[] {
  const band = lineInk(line, m);
  const side = lineSideInk(line, m);
  const bandRight = line.widthPx[m.target] + side.right;
  const clamp = (b: InkBox): InkBox => ({
    left: Math.max(b.left, -side.left),
    right: Math.min(b.right, bandRight),
    top: Math.max(b.top, band.top),
    bottom: Math.min(b.bottom, band.bottom),
  });
  const boxes: InkBox[] = [];
  let x = 0;
  line.runs.forEach((run, ri) => {
    if (ri > 0) x += m.wordGapPx;
    run.forEach((item, i) => {
      if (item.t === "m") {
        if (i > 0 && run[i - 1].t === "m") x += m.pipGapPx;
        boxes.push(
          clamp({
            left: x - m.pipShadowLeftPx,
            right: x + m.pipPx,
            top: m.pipTopPx,
            bottom: m.pipTopPx + m.pipPx + m.pipShadowPx,
          }),
        );
        x += m.pipPx;
        return;
      }
      const italic = Boolean(item.em);
      const baseline = italic ? m.baselinePx.italic : m.baselinePx.regular;
      for (const g of rulesTextGlyphsEm(item.v, italic)) {
        boxes.push(
          clamp({
            left: x + (g.x - g.left) * m.fontPx,
            right: x + (g.x + g.advance + g.right) * m.fontPx,
            top: baseline - g.ascent * m.fontPx,
            bottom: baseline + g.descent * m.fontPx,
          }),
        );
      }
      x += wordWidthPx(item, m);
    });
  });
  return boxes;
}

/** Whether a placed line's ink enters keep-out `k` (target px): its band
 *  first, then glyph by glyph. */
function lineHitsKeepOut(l: RulesLinePlacement, line: RulesLine, m: RulesMetrics, k: InkBox): boolean {
  if (!(l.inkRight > k.left && l.inkLeft < k.right && l.inkBottom > k.top && l.inkTop < k.bottom)) return false;
  return lineInkBoxes(line, m).some(
    (b) => l.left + b.right > k.left && l.left + b.left < k.right && l.top + b.bottom > k.top && l.top + b.top < k.bottom,
  );
}

function checkPlacement(
  placed: RulesPlacement,
  blocks: readonly RulesBlock[],
  input: RulesLayoutInput,
): RulesTargetCheck {
  const { interior } = placed;
  const overflowPx = placed.insetTop + placed.blockHeight + placed.insetBottom - interior.height;
  const orientation = orientationFromAspect(input.aspect);
  // A float is judged like a keep-out: a line that still enters it (one
  // too narrow to wrap round it, an inline pip) steps the size down.
  const keepOuts = [...(input.keepOuts ?? []), ...(input.floats ?? [])].map((r) => rectPx(r, orientation, input.aspect, placed.target));
  const keepOutHit = placed.lines.some((l) =>
    keepOuts.some((k) => lineHitsKeepOut(l, blocks[l.block].lines[l.line], placed.metrics, k)),
  );
  const overwideRun = blocks.some((b) =>
    b.lines.some((l) => l.runs.length === 1 && l.widthPx[placed.target] > interior.width),
  );
  return { overflowPx, keepOutHit, overwideRun, fits: overflowPx <= 0 && !keepOutHit && !overwideRun };
}

/** The column each target breaks lines against: the box's interior width
 *  (its padding and side headroom off). */
function columnsFor(
  input: RulesLayoutInput,
  sizePx: number,
  side: Readonly<Record<RulesTarget, SideInset>>,
): Record<RulesTarget, number> {
  const orientation = orientationFromAspect(input.aspect);
  const pad = padFor(input, sizePx);
  const column = (target: RulesTarget) => {
    const p = targetPad(pad, RULES_TARGET_SCALE[target]);
    const width = rectPx(input.rect, orientation, input.aspect, target).width;
    return width - p.left - p.right - side[target].left - side[target].right;
  };
  return { hd: column("hd"), default: column("default") };
}

/**
 * The layout of `input`'s text at `sizePx` (HD px): its lines at both
 * targets' columns, and whether it fits there — `clipped` when it overflows
 * the box, runs into a keep-out or holds a run wider than the column at any
 * target.
 */
export function layoutRulesAt(input: RulesLayoutInput, sizePx: number): RulesLayout {
  return layoutParsedAt(input, sizePx, parseText(input.rulesText, input.flavorText));
}

/** How many times the side headroom may grow while the lines settle. */
const SIDE_INSET_ROUNDS = 6;
/** How many times the floats may re-break the lines while they settle (a
 *  narrowed line adds a line, which can move another line onto the float). */
const FLOAT_ROUNDS = 8;
/** A float that would leave a line less than this share of the box's
 *  column narrows nothing: the line keeps its column and the float's
 *  keep-out check steps the size down instead. */
const FLOAT_MIN_COLUMN = 0.25;

/**
 * The columns the floats narrow (TODO 5.1d): the blocks placed as they are
 * at each target; a line whose box rows meet a float's rows breaks against a
 * column ending at the float's left edge (the narrowest of the floats it
 * meets), keyed by its global line index — the same index breakParsed
 * counts. A float right of the column, or one leaving under
 * FLOAT_MIN_COLUMN of it, narrows nothing. Empty without floats.
 */
function floatColumnsFor(
  blocks: readonly RulesBlock[],
  input: RulesLayoutInput,
  sizePx: number,
  side: Readonly<Record<RulesTarget, SideInset>>,
  columns: Readonly<Record<RulesTarget, number>>,
): LineColumns {
  const out = new Map<number, Record<RulesTarget, number>>();
  const floats = input.floats ?? [];
  if (floats.length === 0) return out;
  const orientation = orientationFromAspect(input.aspect);
  for (const t of RULES_TARGETS) {
    const placed = placeBlocks(blocks, sizePx, input, t, side[t]);
    const rects = floats.map((f) => rectPx(f, orientation, input.aspect, t));
    placed.lines.forEach((l, i) => {
      let column = columns[t];
      for (const f of rects) {
        if (!(l.top < f.bottom && l.top + l.height > f.top)) continue;
        // From the column's own left edge — a centred line's indent
        // (RulesLayoutInput.align) is not part of its column.
        column = Math.min(column, f.left - (l.left - l.indent));
      }
      if (column >= columns[t] || column < columns[t] * FLOAT_MIN_COLUMN) return;
      out.set(i, { ...(out.get(i) ?? columns), [t]: column });
    });
  }
  return out;
}

function sameLineColumns(a: LineColumns | undefined, b: LineColumns): boolean {
  if (!a) return b.size === 0;
  if (a.size !== b.size) return false;
  for (const [i, cols] of b) {
    const prev = a.get(i);
    if (!prev || RULES_TARGETS.some((t) => prev[t] !== cols[t])) return false;
  }
  return true;
}

function layoutParsedAt(input: RulesLayoutInput, sizePx: number, parsed: ParsedText): RulesLayout {
  const orientation = orientationFromAspect(input.aspect);
  const lineHeight = input.lineHeight ?? RULES_TEXT.lineHeight;
  const metrics = {
    hd: metricsFor(sizePx, lineHeight, "hd", input.symbolStyle),
    default: metricsFor(sizePx, lineHeight, "default", input.symbolStyle),
  };
  const pad = padFor(input, sizePx);
  const pads = { hd: targetPad(pad, RULES_TARGET_SCALE.hd), default: targetPad(pad, RULES_TARGET_SCALE.default) };
  // The side headroom depends on which words start and end the lines, and
  // the lines on the column it leaves: break, measure what the lines' ink
  // needs past the padding, and break again narrower until nothing needs
  // more (it only grows, and at most to the widest overhang). The floats
  // (TODO 5.1d) settle in the same rounds: the lines they meet, once placed,
  // narrow and break again until the same lines meet them — each on its own
  // budget, so a box without floats settles exactly as it always has.
  let side: Record<RulesTarget, SideInset> = { hd: NO_SIDE_INSET, default: NO_SIDE_INSET };
  let lineColumns: LineColumns | undefined;
  let blocks = breakParsed(parsed, sizePx, columnsFor(input, sizePx, side), lineHeight);
  let sideRounds = 0;
  let floatRounds = 0;
  for (;;) {
    const need = {
      hd: sideInsetNeeded(blocks, metrics.hd, pads.hd),
      default: sideInsetNeeded(blocks, metrics.default, pads.default),
    };
    const grows = RULES_TARGETS.some((t) => need[t].left > side[t].left || need[t].right > side[t].right);
    const floats = floatColumnsFor(blocks, input, sizePx, side, columnsFor(input, sizePx, side));
    const canGrow = grows && sideRounds < SIDE_INSET_ROUNDS;
    const canFloat = !sameLineColumns(lineColumns, floats) && floatRounds < FLOAT_ROUNDS;
    if (!canGrow && !canFloat) break;
    if (canGrow) {
      const grow = (t: RulesTarget) => ({
        left: Math.max(side[t].left, need[t].left),
        right: Math.max(side[t].right, need[t].right),
      });
      side = { hd: grow("hd"), default: grow("default") };
      sideRounds += 1;
    }
    if (canFloat) {
      lineColumns = floats;
      floatRounds += 1;
    }
    blocks = breakParsed(parsed, sizePx, columnsFor(input, sizePx, side), lineHeight, lineColumns?.size ? lineColumns : undefined);
  }
  const checks = {
    hd: checkPlacement(placeBlocks(blocks, sizePx, input, "hd", side.hd), blocks, input),
    default: checkPlacement(placeBlocks(blocks, sizePx, input, "default", side.default), blocks, input),
  };
  return {
    sizePx,
    sizePct: rulesPxToPct(sizePx, orientation),
    orientation,
    lineHeight,
    blocks,
    clipped: !(checks.hd.fits && checks.default.fits),
    checks,
    sideInsets: side,
    input,
  };
}

/** The ladder for a slot size: its HD px snapped down to the even grid, then
 *  every RULES_SIZE_PX.stepPx below it to the floor. A ceiling under the
 *  floor is its own (only) step. */
export function rulesLadderPx(sizePct: number, orientation: CardOrientation = "portrait"): number[] {
  const ceiling = rulesPctToPx(sizePct, orientation);
  if (ceiling <= RULES_SIZE_PX.floor) return [ceiling];
  const ladder: number[] = [];
  for (let s = ceiling; s >= RULES_SIZE_PX.floor; s -= RULES_SIZE_PX.stepPx) ladder.push(s);
  return ladder;
}

/**
 * The largest ladder size at which `input`'s text fits at BOTH targets —
 * the block (with its ink headroom) within the box's interior, no line's
 * ink in a keep-out, no run wider than the column — with no safety margin:
 * the lines are exact. A slot that squeezes its paragraph gaps
 * (paragraphGapMinPx) tries each size with them squeezed before the next
 * size down (squeezeParagraphGaps). Nothing fits → the floor's layout,
 * `clipped`. Empty text → the ceiling, nothing to draw.
 */
export function fitRulesLayout(input: RulesLayoutInput): RulesLayout {
  const ladder = rulesLadderPx(input.sizePct, orientationFromAspect(input.aspect));
  const parsed = parseText(input.rulesText, input.flavorText);
  if (input.align === "center") {
    // A centred block is set at EXACTLY the size (and squeezed paragraph
    // gap) its left-aligned twin fits at (owner 2026-10-07: Centred never
    // sets a text smaller than Left, and never clips one Left fits). The
    // lines are the twin's — an indent moves no break — and a line whose
    // centred place meets a drawn badge is held short of it (placeBlocks,
    // heldLineIndentPx), where the twin's own place is always free: so the
    // twin's size fits centred too.
    const left = fitRulesLayout({ ...input, align: undefined });
    const gap = left.input.paragraphGapPx;
    return layoutParsedAt(gap !== undefined && input.paragraphGapPx === undefined ? { ...input, paragraphGapPx: gap } : input, left.sizePx, parsed);
  }
  let layout = layoutParsedAt(input, ladder[0], parsed);
  for (const sizePx of ladder.slice(1)) {
    if (!layout.clipped) return layout;
    const squeezed = squeezeParagraphGaps(layout);
    if (squeezed) return squeezed;
    layout = layoutParsedAt(input, sizePx, parsed);
  }
  return layout.clipped ? (squeezeParagraphGaps(layout) ?? layout) : layout;
}

/**
 * A clipped layout set again with its paragraph gaps squeezed (TODO 4.48:
 * RulesLayoutInput.paragraphGapMinPx): the same size and lines — a gap never
 * moves a break — at the widest gap from RULES_TEXT.paragraphGapPx down to
 * the slot's minimum, RULES_SIZE_PX.stepPx at a time, at which the text
 * fits at BOTH targets; null when none does, when the slot doesn't squeeze,
 * or when the text has no paragraph gap to squeeze. Only the gaps between
 * rules paragraphs (and blank lines) move — never the flavour's.
 */
function squeezeParagraphGaps(layout: RulesLayout): RulesLayout | null {
  const { input, blocks } = layout;
  const min = input.paragraphGapMinPx;
  if (min === undefined || input.paragraphGapPx !== undefined) return null;
  const gaps = blocks.filter((b, i) => i > 0 && b.kind !== "flavor").length;
  if (gaps === 0 || RULES_TARGETS.some((t) => layout.checks[t].overwideRun)) return null;
  for (let gap = RULES_TEXT.paragraphGapPx - RULES_SIZE_PX.stepPx; gap >= min; gap -= RULES_SIZE_PX.stepPx) {
    const at = { ...input, paragraphGapPx: gap };
    const checks = {
      hd: checkPlacement(placeBlocks(blocks, layout.sizePx, at, "hd", layout.sideInsets.hd), blocks, at),
      default: checkPlacement(placeBlocks(blocks, layout.sizePx, at, "default", layout.sideInsets.default), blocks, at),
    };
    if (checks.hd.fits && checks.default.fits) return { ...layout, input: at, checks, clipped: false };
  }
  return null;
}

/** Where every line of `layout` lands at `target` (see RulesPlacement). */
export function linePositions(layout: RulesLayout, target: RulesTarget): RulesPlacement {
  return placeBlocks(layout.blocks, layout.sizePx, layout.input, target, layout.sideInsets[target]);
}

/** Whether any line of `layout` puts ink inside `rect` (card percents, in
 *  the box's own frame) at `target` — glyph by glyph, the way the fit judges
 *  a keep-out. */
export function inkEntersRect(layout: RulesLayout, rect: Rect, target: RulesTarget): boolean {
  const placed = linePositions(layout, target);
  const k = rectPx(rect, layout.orientation, layout.input.aspect, target);
  return placed.lines.some((l) => lineHitsKeepOut(l, layout.blocks[l.block].lines[l.line], placed.metrics, k));
}

/** The height `layout`'s text takes at `target`: its lines and gaps plus the
 *  ink headroom reserved above and below. */
export function blockHeightPx(layout: RulesLayout, target: RulesTarget): number {
  const placed = linePositions(layout, target);
  return placed.insetTop + placed.blockHeight + placed.insetBottom;
}

// ---------------------------------------------------------------------------
// Keep-outs
// ---------------------------------------------------------------------------

/**
 * Where a stat badge the card draws puts ink, in card percents: the badge
 * the frame MASTER paints (StatSlot.paintedRect — the battle's defense
 * shield, TODO 4.21b), a plate master's measured ink over the plate's box
 * (lib/cards/plate-ink.ts — the box itself for a plate the table doesn't
 * know), else the value's rect (a value printed straight on the art or the
 * frame). (The renderers drew a rounded badge of their own behind a
 * plate-less value until the battle's disc, its one user, gave way to the
 * painted shield: no profile declared one, and the override schema never
 * could — the path is gone.)
 */
export function statInkRect(slot: StatSlot): Rect {
  if (slot.paintedRect) return slot.paintedRect;
  const plateBox = slot.plateRect ?? slot.rect;
  if (slot.plateAssetPathTemplate) return plateInkRect(slot.plateAssetPathTemplate, plateBox) ?? plateBox;
  return slot.rect;
}

/**
 * The stat badges a rules box must keep its ink out of, for a card that
 * DRAWS them — each only when its show flag is set (the renderers' showPT /
 * showLoyalty / showDefense): the P/T plate, the loyalty shield (only when a
 * walker's text is drawn in the plain box — its ability rows keep clear of
 * it themselves) and the battle's defense shield. Each is where the badge
 * puts ink (statInkRect): a plate's measured ink, or the value's rect. A
 * badge the frame MASTER paints (StatSlot.paintedRect: the
 * battle's shield, TODO 4.21b) is on every card on the frame, value or no
 * value — it keeps the text out whatever its show flag says.
 */
export function statKeepOuts(
  layout: Pick<FrameProfile, "pt" | "loyalty" | "defense">,
  show: { pt?: boolean; loyalty?: boolean; defense?: boolean },
): Rect[] {
  const ink = (slot: StatSlot | undefined, shown: boolean | undefined) =>
    slot && (shown || slot.paintedRect) ? statInkRect(slot) : null;
  return [ink(layout.pt, show.pt), ink(layout.loyalty, show.loyalty), ink(layout.defense, show.defense)].filter(
    (r): r is Rect => r !== null,
  );
}

/**
 * A keep-out given in card coordinates, in the frame of a box the renderer
 * turns by `rotationDeg` (clockwise, about the box's centre — a flip face's
 * 180°, aftermath's 90°): the rect that, turned with the box, covers it. The
 * layout of a rotated face is computed in its own (unturned) frame.
 */
export function keepOutInBoxFrame(keepOut: Rect, box: Rect, rotationDeg: number, aspect: number): Rect {
  const turns = ((Math.round(rotationDeg / 90) % 4) + 4) % 4;
  if (turns === 0) return keepOut;
  // Physical units (card width = 100): a quarter turn swaps the axes.
  const h = 100 * aspect;
  const cx = box.leftPct + box.widthPct / 2;
  const cy = ((box.topPct + box.heightPct / 2) / 100) * h;
  const corners = [
    [keepOut.leftPct, (keepOut.topPct / 100) * h],
    [keepOut.leftPct + keepOut.widthPct, ((keepOut.topPct + keepOut.heightPct) / 100) * h],
  ].map(([x, y]) => {
    // Undo a clockwise turn (y down): rotate counter-clockwise by 90° × turns.
    let dx = x - cx;
    let dy = y - cy;
    for (let i = 0; i < turns; i += 1) [dx, dy] = [dy, -dx];
    return [cx + dx, cy + dy];
  });
  const [x0, x1] = [Math.min(corners[0][0], corners[1][0]), Math.max(corners[0][0], corners[1][0])];
  const [y0, y1] = [Math.min(corners[0][1], corners[1][1]), Math.max(corners[0][1], corners[1][1])];
  return { leftPct: x0, topPct: (y0 / h) * 100, widthPct: x1 - x0, heightPct: ((y1 - y0) / h) * 100 };
}
