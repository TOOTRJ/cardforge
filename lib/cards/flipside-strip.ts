// ---------------------------------------------------------------------------
// The modal double-faced flipside strip's texts (TODO 5.1b; design 2026-10-02
// §2.2, D9): what the OTHER face puts on this one — its LAST type word and
// its mana cost or, for a land, its mana ability — as both renderers draw
// them in the profile's `flipside` slots (FrameProfile.flipside,
// lib/cards/template-layout.ts): the word in Beleren Bold from the box's
// left edge, the line as ONE inline-pip run (layout v36's pips, the rules
// layout's own metrics at MDFC_STRIP_LINE_PX) set against the box's right
// edge. The texts come from CardPreviewData.dfc.otherFace (lib/cards/
// faces.ts typeWordOf / manaLineOf) and from nowhere else.
//
// Pure: no rendering. The bake (lib/render/card-image.tsx FlipsideBake)
// and the preview (components/cards/card-preview.tsx FlipsideOverlay) draw
// exactly this, each at its own target's whole px.
// ---------------------------------------------------------------------------

import type { DfcOtherFace } from "@/lib/cards/faces";
import { breakRulesText, metricsFor, runWidthPx, type RulesMetrics, type RulesTarget } from "@/lib/cards/rules-layout";
import type { RulesItem } from "@/lib/cards/rules-text";
import type { FlipsideSlots } from "@/lib/cards/template-layout";
import { MDFC_STRIP_LINE_PX, RULES_TEXT } from "@/lib/cards/typography";

/** The strip's line laid out at one target: its runs (never wrapped — the
 *  column is unbounded) and the metrics it is drawn with. */
export type FlipsideLine = {
  runs: RulesItem[][];
  metrics: RulesMetrics;
  /** The line's drawn width at the target (runs a word gap apart). */
  widthPx: number;
};

export type FlipsideStrip = {
  /** The other face's type word, or null when it has no type line. */
  word: string | null;
  /** The other face's cost / mana line, or null when it has neither. */
  line: FlipsideLine | null;
};

/** The runs of ONE unwrapped line of rules text: the layout's own
 *  tokeniser and tight-run grouping, broken in a column no run can
 *  overflow. */
export function flipsideLineRuns(line: string): RulesItem[][] {
  const blocks = breakRulesText(line, null, MDFC_STRIP_LINE_PX, { hd: Number.MAX_SAFE_INTEGER, default: Number.MAX_SAFE_INTEGER });
  return blocks.flatMap((block) => (block.kind === "rules" ? block.lines.flatMap((l) => l.runs) : []));
}

/** What a face's strip draws from the other face, at `target`, or null
 *  when the profile has no strip or the other face gives it nothing. */
export function flipsideStrip(
  slots: FlipsideSlots | null | undefined,
  other: DfcOtherFace | null | undefined,
  target: RulesTarget,
): FlipsideStrip | null {
  if (!slots || !other) return null;
  const word = other.typeWord?.trim() || null;
  const text = other.line?.trim() || null;
  if (!word && !text) return null;
  let line: FlipsideLine | null = null;
  if (text) {
    const metrics = metricsFor(MDFC_STRIP_LINE_PX, RULES_TEXT.lineHeight, target);
    const runs = flipsideLineRuns(text);
    const widthPx = runs.reduce((w, run, i) => w + (i > 0 ? metrics.wordGapPx : 0) + runWidthPx(run, metrics), 0);
    line = { runs, metrics, widthPx };
  }
  return { word, line };
}
