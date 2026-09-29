import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getFrameProfileOverrides } from "@/lib/cards/frame-profile-overrides";
import { recordFrameReviewEvent } from "@/lib/cards/frame-review-events";
import { overrideHash } from "@/lib/cards/frame-verification-state";
import { CARD_LAYOUT_VERSION } from "@/lib/cards/layout-version";
import type { FrameProfileOverridesMap } from "@/lib/cards/profile-override";
import type { FrameColorKey } from "@/lib/cards/frame-reference-registry";
import { scoreFrameCombo } from "@/lib/frames/score-combo";
import type { ScoreBatchResult } from "@/lib/frames/score-batch";
import type { SlotScore } from "@/lib/frames/align";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Score one (template, colour) against its reference and record it as a
// "score" event (frame_review_events) — the ONE path behind the sign-off's
// per-colour Score (scoreFrameColorAction) and the whole-template /
// treatment job (POST /api/admin/frame-score-batch, TODO 4.12). The event
// carries what the number was measured on (layout version, the override
// hash of the map the render used, the reference printing), so the
// sign-off's staleness rule reads it like a tick's.
//
// Records only. It never writes frame_reviews: verifying stays the owner's
// click. Callers are admin-gated and pass the admin's id as the actor.
// ---------------------------------------------------------------------------

export async function scoreAndRecordCombo(input: {
  template: FrameTemplate;
  colorKey: FrameColorKey;
  actorId: string;
  /** Pre-resolved reference (see scoreFrameCombo); omitted → the combo's
   *  own (pinned, else the registry default). */
  referenceId?: string | null;
  /** One override read shared by a batch; omitted → read now. */
  overrides?: FrameProfileOverridesMap;
}): Promise<ScoreBatchResult> {
  const overrides = input.overrides ?? (await getFrameProfileOverrides());
  const result = await scoreFrameCombo({
    template: input.template,
    color: input.colorKey,
    ref: null,
    referenceId: input.referenceId ?? null,
    overrides,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const recorded = await recordFrameReviewEvent(createAdminClient(), {
    template: input.template,
    colorKey: input.colorKey,
    action: "score",
    actor: input.actorId,
    layoutVersion: CARD_LAYOUT_VERSION,
    overrideHash: overrideHash(overrides[input.template] ?? null),
    referenceScryfallId: result.referenceId,
    scoreJson: { overall: result.overall, global: result.global, slots: result.slots },
  });
  return {
    ok: true,
    overall: result.overall,
    global: result.global,
    slots: result.slots as Record<string, SlotScore>,
    referenceId: result.referenceId,
    recorded,
  };
}
