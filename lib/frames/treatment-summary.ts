import { FRAME_COLOR_KEYS, type FrameColorKey } from "@/lib/cards/frame-reference-registry";
import {
  pickFrameReferenceFrom,
  type PinnedReferenceRow,
} from "@/lib/cards/frame-reference-pick";
import { signOffStatus, type RecordedScore, type SignOffColourStatus } from "@/lib/cards/frame-signoff";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import {
  listSlotPaths,
  resolveFrameProfile,
  slotRect,
  type FrameProfileOverridesMap,
} from "@/lib/cards/profile-override";
import type { Rect, SlotScore } from "@/lib/frames/align";
import {
  combosForTemplates,
  parseRecordedScore,
  templatesForTreatment,
  treatmentSlotConsensus,
  type ScoreBatchCombo,
  type SharedSlotRow,
} from "@/lib/frames/score-batch";
import { FRAME_SET_LABELS, FRAME_TEMPLATE_SET, type FrameSet, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// The treatment half of the sign-off view (TODO 4.12): every template of the
// frame set the signed-off template belongs to, each colour's score state
// by the sign-off's own rule (signOffStatus — so "scored" here means what
// Publish would accept on that template's own page), the combos a
// "Score the treatment" job sends, and the slots the templates share
// (treatmentSlotConsensus over the colours whose score counts today).
// Pure: the page passes the reads it already made.
// ---------------------------------------------------------------------------

export type TreatmentColourView = Pick<SignOffColourStatus, "colorKey" | "state" | "overall" | "low">;

export type TreatmentTemplateView = {
  template: FrameTemplate;
  label: string;
  colours: TreatmentColourView[];
};

export type TreatmentView = {
  key: FrameSet;
  label: string;
  templates: TreatmentTemplateView[];
  /** What "Score the treatment" sends: every colour that has a reference. */
  combos: ScoreBatchCombo[];
  shared: SharedSlotRow[];
};

/** The slot rects a template draws today (its layout override applied):
 *  every slot the frame has (listSlotPaths with no kind). The treatment view
 *  pools them per frame, and needs no kind filter here: each colour's
 *  scores already hold only the slots its reference printing's kind draws
 *  (score-combo.ts, TODO 4.5.0), so a slot no reference scored pools
 *  nothing. */
export function slotRectsFor(
  template: FrameTemplate,
  overrides: FrameProfileOverridesMap,
): Record<string, Rect> {
  const profile = resolveFrameProfile(template, overrides);
  const rects: Record<string, Rect> = {};
  for (const path of listSlotPaths(profile)) {
    const rect = slotRect(profile, path);
    if (rect) rects[path] = rect;
  }
  return rects;
}

/** null when the template's treatment has no other template — nothing to
 *  batch beyond the template's own "Score all colours". */
export function buildTreatmentView(input: {
  template: FrameTemplate;
  reviews: ReadonlyMap<string, PinnedReferenceRow>;
  overrides: FrameProfileOverridesMap;
  /** The newest recorded score per template, per colour. */
  scores: ReadonlyMap<string, ReadonlyMap<string, RecordedScore>>;
  labelFor: (template: FrameTemplate) => string;
  currentVersion?: number;
}): TreatmentView | null {
  const key = FRAME_TEMPLATE_SET[input.template];
  const templates = templatesForTreatment(key);
  if (templates.length < 2) return null;

  const views: TreatmentTemplateView[] = [];
  const consensusInputs: Array<{
    template: string;
    rects: Record<string, Rect>;
    scores: Array<Record<string, SlotScore>>;
  }> = [];
  const referenced = new Set<string>();

  for (const template of templates) {
    const recorded = input.scores.get(template);
    const status = signOffStatus({
      template,
      currentOverrideHash: overrideHash(input.overrides[template] ?? null),
      currentVersion: input.currentVersion,
      colours: FRAME_COLOR_KEYS.map((colorKey: FrameColorKey) => ({
        colorKey,
        referenceId: pickFrameReferenceFrom(input.reviews, template, colorKey)?.scryfallId ?? null,
        score: recorded?.get(colorKey) ?? null,
      })),
    });
    views.push({
      template,
      label: input.labelFor(template),
      colours: status.colours.map(({ colorKey, state, overall, low }) => ({ colorKey, state, overall, low })),
    });
    for (const colour of status.colours) {
      if (colour.state !== "no-reference") referenced.add(`${template}/${colour.colorKey}`);
    }
    consensusInputs.push({
      template,
      rects: slotRectsFor(template, input.overrides),
      scores: status.colours
        .filter((c) => c.state === "scored")
        .map((c) => parseRecordedScore(recorded?.get(c.colorKey)?.scoreJson)?.slots ?? {}),
    });
  }

  return {
    key,
    label: FRAME_SET_LABELS[key],
    templates: views,
    combos: combosForTemplates(templates).filter((c) => referenced.has(`${c.template}/${c.colorKey}`)),
    shared: treatmentSlotConsensus(consensusInputs),
  };
}
