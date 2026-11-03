// ---------------------------------------------------------------------------
// What a job's OWNER can read before its paid step runs (migration 0162).
//
// A job's text is designed at PLAN time and paid for when its step runs
// (lib/ai/generation-jobs.ts). Its owner reads the row through their own
// session — the app's reads and PostgREST alike — so anything designed that
// sits in a column they can read is AI text they never paid for:
//
//   * `plan` holds every designed field. No API role reads it (0162: a
//     column grant without it) — the server reads it with the service role.
//     Every owner-session read of the table names OWNER_JOB_COLUMNS, never
//     "*" (a `select *` asks for `plan` and is refused).
//   * A step's `label` was the designed TITLE (a title-only fill's whole
//     product). A card / card_fill step now waits under a placeholder and
//     takes its title in the done-write — `earnedStepLabel`, from the plan's
//     `step_labels`; a plan made before them keeps the label it was given.
// ---------------------------------------------------------------------------

/** Every column of `ai_generation_jobs` but `plan` — the grant 0162 gives
 *  `authenticated`, and what an owner-session read selects. A new column is
 *  readable by the owner only once a migration grants it here too. */
export const OWNER_JOB_COLUMNS =
  "id, owner_id, kind, status, request, steps, deck_id, error, created_at, updated_at";

/** A card / card_fill step's label until its step is done. */
export const PENDING_STEP_LABEL = "Your card";
/** A double-faced fill's back picture step's label until it is done. */
export const PENDING_BACK_STEP_LABEL = "Back face";

const PLACEHOLDER_LABELS = new Set([PENDING_STEP_LABEL, PENDING_BACK_STEP_LABEL].map((label) => label.toLowerCase()));

/** A label that names no design (the recent-titles list skips it). */
export function isPlaceholderStepLabel(label: string): boolean {
  return PLACEHOLDER_LABELS.has(label.trim().toLowerCase());
}

/** The label a DONE step is written with: the plan's, where it holds one
 *  for the step (the designed title), else null (leave the label). */
export function earnedStepLabel(plan: unknown, stepKey: string): string | null {
  if (!plan || typeof plan !== "object") return null;
  const labels = (plan as { step_labels?: unknown }).step_labels;
  if (!labels || typeof labels !== "object") return null;
  const label = (labels as Record<string, unknown>)[stepKey];
  return typeof label === "string" && label.trim() ? label : null;
}
