// ---------------------------------------------------------------------------
// The collector line's LAYOUT (TODO 4.9b): where every run of the two lines
// sits, for BOTH renderers. collectorLayout() turns a card's content
// (lib/cards/collector-line.ts) and its template's slot (FrameProfile
// .collector, M15_COLLECTOR) into ABSOLUTE runs — a pen x, a baseline, a
// size, a line height — measured from the committed fonts' advances
// (lib/cards/collector-metrics.ts, lib/cards/display-metrics.ts,
// lib/cards/rules-metrics.ts), never from inline flow: the preview sets each
// run at its x and top in card units (cqw / %), the bake at the same
// fractions in px, so the line is pixel-identical in the editor and the
// stored PNG.
//
// Vertical placement: a run's top is its BASELINE less the face's ascent at
// the run's size, and the run carries `lineHeight: ascent + descent` (the
// face's content area, in em). The browser and Satori both put the baseline
// (L − (ascent + descent)) / 2 + ascent below a line box of height L (the
// rule lib/cards/rules-metrics.ts states for MPlantin; Satori's "normal"
// box leaves the lineGap out while the browser's keeps it, so every run
// sets its own L), so with L = ascent + descent the baseline lands exactly
// `ascent` em below the top in both.
//
// The © slot (design 2026-09-29, owner Q2): on DISPLAY surfaces the
// pipglyph.com brand mark sits there — the same mark at the same size, its
// right edge on the slot's (93.54 %W), on line 2 when the card DRAWS a stat
// plate (a P/T, the loyalty shield, the defense badge — the plate the
// renderer draws, never the data's presence), else on line 1 — so the
// watermark policy (layout v20) is unchanged. On a paid viewer's clean
// download the slot carries the card's footer text in MPlantin, or nothing.
// Client-safe: the preview, the bake and the tests read this one module.
// ---------------------------------------------------------------------------

import {
  collectorContent,
  collectorStyleOf,
  type CollectorContentFacts,
  type CollectorNumberRun,
  type CollectorStyle,
} from "@/lib/cards/collector-line";
import { COLLECTOR_ADVANCES, COLLECTOR_FACES, COLLECTOR_UNITS_PER_EM } from "@/lib/cards/collector-metrics";
import { displayTextWidthEm, truncateDisplayLine } from "@/lib/cards/display-metrics";
import { measuredLineFloorPct } from "@/lib/cards/render-tiers";
import { rulesTextWidthEm } from "@/lib/cards/rules-metrics";
import type { FrameProfile } from "@/lib/cards/template-layout";
import type { CardOrientation } from "@/lib/cards/typography";
import type { FrameStyle } from "@/types/card";

/** The faces a collector run is set in (the metrics table's keys): the
 *  collector face (Montserrat Medium), the display face (Beleren Bold) and
 *  the body face (MPlantin). */
export type CollectorFace = "collector" | "display" | "body";

export type CollectorRunRole =
  | "number"
  | "letter"
  | "set"
  | "language"
  | "artist"
  | "mark-text"
  | "separator"
  | "number-star"
  | "brush";

export type CollectorTextRun = {
  kind: "text";
  role: CollectorRunRole;
  face: CollectorFace;
  text: string;
  /** The pen x, % of the card's width. */
  xPct: number;
  /** The run's line box top, % of the card's height. */
  topPct: number;
  /** The baseline the ink sits on, % of the card's height. */
  baselinePct: number;
  /** The font size, as a fraction of the card's width. */
  sizePct: number;
  /** The line box height as a multiple of the size: the face's ascent +
   *  descent (see the header). */
  lineHeight: number;
  /** Tracking after every glyph, in em. */
  letterSpacingEm: number;
  /** The run's width (its advances and tracking), % of the card's width. */
  widthPct: number;
};

export type CollectorPathRun = {
  kind: "path";
  role: "separator" | "number-star" | "brush";
  path: "star" | "brush";
  /** The box the path is drawn in, % of the card's width / height. */
  xPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
};

export type CollectorRun = CollectorTextRun | CollectorPathRun;

/** The brand mark on a collector card (design 2026-09-29, owner Q2): the
 *  renderers' own mark — its font, star and gap — anchored on the © slot.
 *  The sizes are the brand mark's (lib/render/card-image.tsx, components/
 *  cards/card-preview.tsx: 2.6 % of the width for the text, 3 % for the
 *  star, 0.8 % between), as fractions of the card's width at portrait
 *  scale; tests/unit/cards/brand-mark-placement.test.ts pins the renderers'
 *  literals and tests/unit/cards/collector-layout.test.ts these. */
export const BRAND_MARK_GEOMETRY = {
  text: "pipglyph.com",
  fontPct: 0.026,
  starPct: 0.03,
  gapPct: 0.008,
  letterSpacingEm: 0.02,
} as const;

export type CollectorMarkAnchor = {
  /** Which line the © slot is on: 2 when the card draws a stat plate. */
  line: 1 | 2;
  /** The mark's right edge, % of the card's width. */
  rightPct: number;
  /** The mark text's baseline, % of the card's height. */
  baselinePct: number;
  /** The mark block's top (the display face's line box), % of the height. */
  topPct: number;
  /** The mark text's size, a fraction of the card's width (short-side
   *  scaled, as the renderers scale it). */
  sizePct: number;
  /** The display face's line box, a multiple of the size. */
  lineHeight: number;
  /** The whole mark's width (star, gap, text), % of the card's width. */
  widthPct: number;
};

export type CollectorMark =
  /** Display: the pipglyph.com mark in the © slot. */
  | { kind: "brand"; anchor: CollectorMarkAnchor }
  /** A clean download with footer text: the "mark-text" run in `runs`. */
  | { kind: "text" }
  /** A clean download with no footer text: the slot stays empty. */
  | { kind: "none" };

export type CollectorLayout = {
  style: CollectorStyle;
  runs: CollectorRun[];
  mark: CollectorMark;
  /** The © slot's line, whatever fills it. */
  markLine: 1 | 2;
  /** The artist as drawn: its text (cut with ONE "…" past its room), its
   *  capital size and whether it was cut; null when the card has none. */
  artist: { text: string; sizePct: number; cut: boolean } | null;
};

/** What the renderer draws, and what the © slot answers to. */
export type CollectorSurface =
  | { kind: "display" }
  | { kind: "download"; footerText: string | null | undefined };

/** The card facts the layout reads: the content facts (set code, number,
 *  language, artist, rarity, type words, finish, ★) and the stat plates the
 *  RENDERER draws (its own gates — the bake's drawnStatSlots, the preview's
 *  showPT / showLoyalty / showDefense), which decide the © slot's line. */
export type CollectorLayoutCard = CollectorContentFacts & {
  /** FrameStyle.collector — the switch (a style draws the line). */
  collector?: FrameStyle["collector"] | null;
  plates: { pt: boolean; loyalty: boolean; defense: boolean };
};

export type CollectorMetrics = {
  advances: Readonly<Record<string, number>>;
  unitsPerEm: number;
  faces: typeof COLLECTOR_FACES;
};

/** The committed fonts' metrics (lib/cards/collector-metrics.ts). */
export const COLLECTOR_METRICS: CollectorMetrics = {
  advances: COLLECTOR_ADVANCES,
  unitsPerEm: COLLECTOR_UNITS_PER_EM,
  faces: COLLECTOR_FACES,
};

/** Tracking on the number, in em (the prints' digits sit ≈ 3.6 px apart
 *  from their advances at 36 px — Card Conjurer's `{kerning3}` on the
 *  2023 style, and the 2015-era prints measure the same: DMU #107's
 *  "107/281" 155 px wide, ONE #19's "019/271" 157). */
export const COLLECTOR_NUMBER_TRACKING_EM = 0.1;

/** The ★ run: its width and height in em of the collector size, and its
 *  bottom above the baseline (KLD #265: 18 px wide, 19 tall, 3 px above
 *  the baseline at a 36 px line). */
const STAR_WIDTH_EM = 0.5;
const STAR_HEIGHT_EM = 0.53;
const STAR_RISE_EM = 0.08;

/** The brush: 40 px wide, from 27 px above line 2's baseline to 3 above
 *  it, at a 36 px line (the prints, M15_COLLECTOR's notes); the artist's pen
 *  46 px after its left edge. */
const BRUSH_WIDTH_EM = 40 / 36;
const BRUSH_TOP_EM = 27 / 36;
const BRUSH_BOTTOM_EM = 3 / 36;
const BRUSH_ADVANCE_EM = 46 / 36;

/** The artist's lower-case letters as capitals at this fraction of the
 *  capital size (Beleren Small Caps' proportion on the prints: DMU #107's
 *  "HRIS" 22 px under a 27 px "C"). */
export const ARTIST_SMALL_CAP_EM = 0.8;

/** The room kept between the artist and the © slot's content, as a
 *  fraction of the card's width (≈ 30 px at HD). */
const ARTIST_MARK_GAP_PCT = 0.02;

/** The display face's space (Beleren Bold, 491 / 2048 em). */
const DISPLAY_SPACE_EM = displayTextWidthEm(" ");

function collectorAdvanceEm(text: string, metrics: CollectorMetrics): number {
  let units = 0;
  for (const ch of text) units += metrics.advances[ch] ?? metrics.advances["0"] ?? 0;
  return units / metrics.unitsPerEm;
}

/** A collector-face run's width in em: its advances plus the tracking after
 *  every glyph, as both renderers set it. */
export function collectorTextWidthEm(text: string, letterSpacingEm: number, metrics: CollectorMetrics = COLLECTOR_METRICS): number {
  return collectorAdvanceEm(text, metrics) + Array.from(text).length * letterSpacingEm;
}

// ---------------------------------------------------------------------------
// The artist's synthesized small caps (Beleren Bold): capitals at the full
// size, lower-case letters as capitals at ARTIST_SMALL_CAP_EM of it, word by
// word (a space never starts or ends a run — the renderers would drop it).
// ---------------------------------------------------------------------------

export type ArtistChunk = { text: string; small: boolean };

/** One word's chunks: maximal runs of lower-case letters (small) and of
 *  everything else (full size), the text upper-cased. */
export function smallCapsChunks(word: string): ArtistChunk[] {
  const chunks: ArtistChunk[] = [];
  for (const ch of word) {
    const small = ch !== ch.toUpperCase();
    const last = chunks[chunks.length - 1];
    if (last && last.small === small) last.text += ch.toUpperCase();
    else chunks.push({ text: ch.toUpperCase(), small });
  }
  return chunks;
}

/** The width of `text` set in synthesized small caps, in em of the CAPITAL
 *  size: the chunks' display-face advances (each small chunk at
 *  ARTIST_SMALL_CAP_EM) and a full-size space between words. */
export function smallCapsWidthEm(text: string): number {
  const words = text.split(" ").filter(Boolean);
  let em = 0;
  words.forEach((word, i) => {
    if (i > 0) em += DISPLAY_SPACE_EM;
    for (const chunk of smallCapsChunks(word)) {
      em += displayTextWidthEm(chunk.text) * (chunk.small ? ARTIST_SMALL_CAP_EM : 1);
    }
  });
  return em;
}

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

/** The style a card DRAWS on `profile`: its switch's style, on a template
 *  with a collector slot — null draws today's footer. */
export function collectorDrawn(
  profile: Pick<FrameProfile, "collector">,
  frameStyle: Pick<FrameStyle, "collector"> | null | undefined,
): CollectorStyle | null {
  if (!profile.collector) return null;
  return collectorStyleOf(frameStyle?.collector);
}

/** The © slot's line: 2 when the renderer draws a stat plate. */
export function collectorMarkLine(plates: CollectorLayoutCard["plates"]): 1 | 2 {
  return plates.pt || plates.loyalty || plates.defense ? 2 : 1;
}

/** The brand mark's width on a collector card, % of the card's width (its
 *  star, the gap and the text's advances with their tracking), at `scale`
 *  (1 portrait, 5/7 landscape). */
export function brandMarkWidthPct(scale: number): number {
  const text = displayTextWidthEm(BRAND_MARK_GEOMETRY.text, { letterSpacingEm: BRAND_MARK_GEOMETRY.letterSpacingEm });
  return (BRAND_MARK_GEOMETRY.starPct + BRAND_MARK_GEOMETRY.gapPct + text * BRAND_MARK_GEOMETRY.fontPct) * scale * 100;
}

type Frame = { w: number; h: number; orientation: CardOrientation };

/** The HD px frame the slot's fractions are turned into (the stored bake's
 *  size; every result is a fraction again, so the frame only sets the
 *  width/height ratio). */
function frameOf(profile: Pick<FrameProfile, "orientation">): Frame {
  return profile.orientation === "landscape" ? { w: 2100, h: 1500, orientation: "landscape" } : { w: 1500, h: 2100, orientation: "portrait" };
}

/**
 * Where the two lines' runs sit for `card` on `profile`, for `surface` —
 * null when the card draws no collector line there (no slot, or the switch
 * is not a style). Every position is a fraction of the card's width (x,
 * sizes) or height (tops, baselines), so both renderers draw the same line.
 */
export function collectorLayout(
  profile: Pick<FrameProfile, "collector" | "orientation">,
  card: CollectorLayoutCard,
  surface: CollectorSurface,
  metrics: CollectorMetrics = COLLECTOR_METRICS,
): CollectorLayout | null {
  const slot = profile.collector;
  const style = collectorDrawn(profile, { collector: card.collector ?? undefined });
  if (!slot || !style) return null;
  const frame = frameOf(profile);
  const content = collectorContent(card, style);
  const faces = metrics.faces;
  const runs: CollectorRun[] = [];

  // Px helpers (the HD frame), and the fractions the runs carry.
  const xPct = (px: number) => (px / frame.w) * 100;
  const yPct = (px: number) => (px / frame.h) * 100;
  const sizePx = slot.sizePct * frame.w;
  const line1 = (slot.line1BaselinePct / 100) * frame.h;
  const line2 = (slot.line2BaselinePct / 100) * frame.h;
  const left = (slot.leftPct / 100) * frame.w;
  const right = (slot.rightPct / 100) * frame.w;
  const brushLeft = (slot.brushLeftPct / 100) * frame.w;

  const text = (
    role: CollectorRunRole,
    face: CollectorFace,
    value: string,
    x: number,
    baseline: number,
    px: number,
    letterSpacingEm: number,
    widthPx: number,
  ): CollectorTextRun => {
    const m = faces[face];
    return {
      kind: "text",
      role,
      face,
      text: value,
      xPct: xPct(x),
      topPct: yPct(baseline - m.ascent * px),
      baselinePct: yPct(baseline),
      sizePct: px / frame.w,
      lineHeight: m.ascent + m.descent,
      letterSpacingEm,
      widthPct: xPct(widthPx),
    };
  };
  const collectorWidthPx = (value: string, tracking: number) => collectorTextWidthEm(value, tracking, metrics) * sizePx;
  const spacePx = collectorAdvanceEm(" ", metrics) * sizePx;
  const starPx = STAR_WIDTH_EM * sizePx;
  const star = (role: "separator" | "number-star", x: number, baseline: number): CollectorPathRun => ({
    kind: "path",
    role,
    path: "star",
    xPct: xPct(x),
    topPct: yPct(baseline - (STAR_RISE_EM + STAR_HEIGHT_EM) * sizePx),
    widthPct: xPct(starPx),
    heightPct: yPct(STAR_HEIGHT_EM * sizePx),
  });

  // A number's runs (text with tracking, a ★ in a stored number as the
  // path) from pen x; returns the pen x after them.
  const numberRuns = (pieces: CollectorNumberRun[], x0: number, baseline: number): number => {
    let x = x0;
    for (const piece of pieces) {
      if (piece.kind === "star") {
        runs.push(star("number-star", x, baseline));
        x += starPx + COLLECTOR_NUMBER_TRACKING_EM * sizePx;
      } else {
        const w = collectorWidthPx(piece.text, COLLECTOR_NUMBER_TRACKING_EM);
        runs.push(text("number", "collector", piece.text, x, baseline, sizePx, COLLECTOR_NUMBER_TRACKING_EM, w));
        x += w;
      }
    }
    return x;
  };

  // ---- line 2: set • language --------------------------------------------
  const { setCode, language, separator } = content.line2;
  let x = left;
  if (setCode && language) {
    if (separator === "dot") {
      const value = `${setCode} • ${language}`;
      const w = collectorWidthPx(value, 0);
      runs.push(text("set", "collector", value, x, line2, sizePx, 0, w));
      x += w;
    } else {
      const wSet = collectorWidthPx(setCode, 0);
      runs.push(text("set", "collector", setCode, x, line2, sizePx, 0, wSet));
      x += wSet + spacePx;
      runs.push(star("separator", x, line2));
      x += starPx + spacePx;
      const wLang = collectorWidthPx(language, 0);
      runs.push(text("language", "collector", language, x, line2, sizePx, 0, wLang));
      x += wLang;
    }
  } else if (setCode || language) {
    const value = (setCode ?? language) as string;
    const w = collectorWidthPx(value, 0);
    runs.push(text(setCode ? "set" : "language", "collector", value, x, line2, sizePx, 0, w));
    x += w;
  }

  // The brush's column: the slot's (the prints' 287 px), or one space after
  // a set / language run that reaches it (Card Conjurer's `{savex}`); the
  // 2015 style's rarity letter stands in the same column.
  const brushX = Math.max(brushLeft, x + spacePx);

  // ---- line 1: the number and the rarity letter -------------------------
  const { letter, number } = content.line1;
  if (style === "2015") {
    const numberEnd = number.length ? numberRuns(number, left, line1) : left;
    if (letter) {
      // The letter in the column above the brush — or, when the number
      // reaches it, one space after the number (design §2.1).
      const column = numberEnd > brushX - spacePx ? numberEnd + spacePx : brushX;
      runs.push(text("letter", "collector", letter, column, line1, sizePx, 0, collectorWidthPx(letter, 0)));
    }
  } else {
    let x1 = left;
    if (letter) {
      const w = collectorWidthPx(letter, 0);
      runs.push(text("letter", "collector", letter, x1, line1, sizePx, 0, w));
      x1 += w + spacePx;
    }
    if (number.length) numberRuns(number, x1, line1);
  }

  // ---- the © slot -----------------------------------------------------------
  const markLine = collectorMarkLine(card.plates);
  const markBaseline = markLine === 2 ? line2 : line1;
  const scale = frame.orientation === "landscape" ? 5 / 7 : 1;
  let mark: CollectorMark;
  let markLeftPx = right;
  if (surface.kind === "display") {
    const markWidthPct = brandMarkWidthPct(scale);
    const fontPct = BRAND_MARK_GEOMETRY.fontPct * scale;
    const display = faces.display;
    mark = {
      kind: "brand",
      anchor: {
        line: markLine,
        rightPct: slot.rightPct,
        baselinePct: yPct(markBaseline),
        topPct: yPct(markBaseline - display.ascent * fontPct * frame.w),
        sizePct: fontPct,
        lineHeight: display.ascent + display.descent,
        widthPct: markWidthPct,
      },
    };
    markLeftPx = right - (markWidthPct / 100) * frame.w;
  } else {
    const footer = (surface.footerText ?? "").trim();
    if (footer) {
      const px = slot.markTextSizePct * frame.w;
      const w = rulesTextWidthEm(footer) * px;
      runs.push(text("mark-text", "body", footer, right - w, markBaseline, px, 0, w));
      markLeftPx = right - w;
      mark = { kind: "text" };
    } else {
      mark = { kind: "none" };
    }
  }

  // ---- the brush and the artist (line 2) ------------------------------------
  let artist: CollectorLayout["artist"] = null;
  if (content.line2.artist) {
    runs.push({
      kind: "path",
      role: "brush",
      path: "brush",
      xPct: xPct(brushX),
      topPct: yPct(line2 - BRUSH_TOP_EM * sizePx),
      widthPct: xPct(BRUSH_WIDTH_EM * sizePx),
      heightPct: yPct((BRUSH_TOP_EM - BRUSH_BOTTOM_EM) * sizePx),
    });
    const artistX = brushX + BRUSH_ADVANCE_EM * sizePx;
    // The room before the © slot's content on line 2 (the mark, the footer
    // text), else to the slot's right edge.
    const limit = markLine === 2 ? markLeftPx - ARTIST_MARK_GAP_PCT * frame.w : right;
    const room = Math.max(0, limit - artistX);
    const base = slot.artistSizePct * frame.w;
    const floor = Math.min(base, measuredLineFloorPct(frame.orientation) * frame.w);
    const full = smallCapsWidthEm(content.line2.artist);
    // Shrink to fit (never below the floor, never above the slot's size),
    // then ONE "…" for what still doesn't fit (the fitTitleBand pattern).
    const capPx = full > 0 ? Math.max(floor, Math.min(base, (room / full) * 1)) : base;
    const artistText = truncateDisplayLine(content.line2.artist, room / capPx, smallCapsWidthEm);
    artist = { text: artistText, sizePct: capPx / frame.w, cut: artistText !== content.line2.artist };
    let ax = artistX;
    artistText.split(" ").filter(Boolean).forEach((word, i) => {
      if (i > 0) ax += DISPLAY_SPACE_EM * capPx;
      for (const chunk of smallCapsChunks(word)) {
        const px = chunk.small ? capPx * ARTIST_SMALL_CAP_EM : capPx;
        const w = displayTextWidthEm(chunk.text) * px;
        runs.push(text("artist", "display", chunk.text, ax, line2, px, 0, w));
        ax += w;
      }
    });
  }

  return { style, runs, mark, markLine, artist };
}
