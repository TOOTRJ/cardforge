import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { recordedOverall } from "@/lib/cards/frame-signoff";

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
  | "override_reset"
  // Migration 0121 (TODO 2.4): one colour scored for the sign-off, and a
  // whole template published by it (color_key "*").
  | "score"
  | "signoff";

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

/** Appends one event; true when it was written. The verification actions
 *  ignore the result (history is best-effort there); the sign-off's score
 *  action needs it — an unrecorded score can't be published. */
export async function recordFrameReviewEvent(
  admin: ReturnType<typeof createAdminClient>,
  event: FrameReviewEventInput,
): Promise<boolean> {
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
    return false;
  }
  return true;
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

/** The newest recorded auto-score per colour of a template (TODO 2.4) — what
 *  the sign-off shows and publishes: a "score" event (the sign-off's Score)
 *  or a "verify" event that carries one (every per-colour tick scores the
 *  combo, 0.10), whichever is newer; a tick whose score failed is skipped.
 *  Caller must already have checked is_admin. Empty on any error. */
export async function latestScoreEvents(
  template: string,
): Promise<Map<string, FrameReviewEvent>> {
  const latest = new Map<string, FrameReviewEvent>();
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("frame_review_events")
      .select(
        "id, template, color_key, action, actor, layout_version, override_hash, reference_scryfall_id, score_json, created_at",
      )
      .eq("template", template)
      .in("action", ["score", "verify"])
      .order("created_at", { ascending: false })
      .limit(200);
    for (const row of data ?? []) {
      if (latest.has(row.color_key)) continue;
      if (recordedOverall(row.score_json) === null) continue;
      latest.set(row.color_key, {
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
      });
    }
  } catch {
    // Fall through — no scores.
  }
  return latest;
}

/** latestScoreEvents for several templates at once — a treatment's
 *  templates on the sign-off view (TODO 4.12). Two reads so a long scoring
 *  history stays cheap: the candidates without their score body (only the
 *  recorded overall, to skip a tick whose score failed), then the full rows
 *  of the newest scored one per (template, colour). Caller must already have
 *  checked is_admin. Empty on any error. */
export async function latestScoreEventsForTemplates(
  templates: readonly string[],
): Promise<Map<string, Map<string, FrameReviewEvent>>> {
  const out = new Map<string, Map<string, FrameReviewEvent>>();
  if (templates.length === 0) return out;
  try {
    const admin = createAdminClient();
    const { data: candidates, error } = await admin
      .from("frame_review_events")
      .select("id, template, color_key, created_at, overall:score_json->overall")
      .in("template", [...templates])
      .in("action", ["score", "verify"])
      .order("created_at", { ascending: false })
      .limit(Math.min(4000, 200 * templates.length));
    if (error || !candidates) return out;
    const newest = new Map<string, string>();
    for (const row of candidates as Array<{ id: string; template: string; color_key: string; overall: unknown }>) {
      const key = `${row.template}/${row.color_key}`;
      if (newest.has(key)) continue;
      if (recordedOverall({ overall: row.overall }) === null) continue;
      newest.set(key, row.id);
    }
    if (newest.size === 0) return out;
    const { data: rows } = await admin
      .from("frame_review_events")
      .select(
        "id, template, color_key, action, actor, layout_version, override_hash, reference_scryfall_id, score_json, created_at",
      )
      .in("id", [...newest.values()]);
    for (const row of rows ?? []) {
      const byColour = out.get(row.template) ?? new Map<string, FrameReviewEvent>();
      byColour.set(row.color_key, {
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
      });
      out.set(row.template, byColour);
    }
  } catch {
    // Fall through — no scores.
  }
  return out;
}
