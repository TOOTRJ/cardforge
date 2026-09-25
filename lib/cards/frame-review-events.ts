import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Append-only history of the frame verification checklist (migration 0115):
// who ticked / withdrew / pinned what, on which layout version and override,
// with the score of the moment. Writes are best-effort inside the admin
// actions (a failed history row must never fail the verification); reads
// go through the service role after the page's own is_admin check — the
// table has no API-role policies.
// ---------------------------------------------------------------------------

export type FrameReviewEventAction =
  | "verify"
  | "withdraw"
  | "pin"
  | "unpin"
  | "override_saved"
  | "override_reset";

export type FrameReviewEvent = {
  id: string;
  template: string;
  colorKey: string;
  action: FrameReviewEventAction;
  actor: string | null;
  layoutVersion: number | null;
  overrideHash: string | null;
  referenceScryfallId: string | null;
  scoreJson: unknown | null;
  createdAt: string;
};

export type FrameReviewEventInput = {
  template: string;
  /** A colour key, or "*" for a template-wide event (override changes). */
  colorKey: string;
  action: FrameReviewEventAction;
  actor: string | null;
  layoutVersion?: number | null;
  overrideHash?: string | null;
  referenceScryfallId?: string | null;
  scoreJson?: unknown | null;
};

export async function recordFrameReviewEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: FrameReviewEventInput,
): Promise<void> {
  const { error } = await admin.from("frame_review_events").insert({
    template: event.template,
    color_key: event.colorKey,
    action: event.action,
    actor: event.actor,
    layout_version: event.layoutVersion ?? null,
    override_hash: event.overrideHash ?? null,
    reference_scryfall_id: event.referenceScryfallId ?? null,
    score_json: (event.scoreJson ?? null) as never,
  });
  if (error) {
    console.warn(`[frame-review-events] ${event.action} ${event.template}/${event.colorKey}:`, error.message);
  }
}

/** Latest events for a combo (plus the template-wide "*" ones), newest
 *  first. Caller must already have checked is_admin. */
export async function listFrameReviewEvents(
  template: string,
  colorKey: string,
  limit = 8,
): Promise<FrameReviewEvent[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("frame_review_events")
      .select(
        "id, template, color_key, action, actor, layout_version, override_hash, reference_scryfall_id, score_json, created_at",
      )
      .eq("template", template)
      .in("color_key", [colorKey, "*"])
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((row) => ({
      id: row.id,
      template: row.template,
      colorKey: row.color_key,
      action: row.action as FrameReviewEventAction,
      actor: row.actor,
      layoutVersion: row.layout_version,
      overrideHash: row.override_hash,
      referenceScryfallId: row.reference_scryfall_id,
      scoreJson: row.score_json,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}
