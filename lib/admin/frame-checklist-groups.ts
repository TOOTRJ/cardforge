// ---------------------------------------------------------------------------
// The frame verification checklist's ORDER (owner 2026-10-16): what still
// needs the owner's eye stays open at the top, what is approved collapses
// to the bottom. Presentation only — nothing here decides what a tick
// writes, and a stale tick is still VERIFIED for the creator
// (lib/cards/frame-verification-state.ts); it only sorts first here.
//
// Three groups, most urgent first, each keeping the order it arrived in
// (FRAME_COLOR_KEYS for a template's rows, FRAME_TEMPLATE_VALUES for an
// era's templates — a stable sort):
//   1. "stale"    — verified, but a layout bump scoped to the template or a
//                   changed override asks for a re-tick;
//   2. "todo"     — not verified;
//   3. "approved" — verified and current (a legacy tick with no record that
//                   no later bump stales counts as approved, as the page's
//                   own "Verified (no record)" line says).
// A template is as urgent as its most urgent row.
// ---------------------------------------------------------------------------

export type ChecklistStatus = "stale" | "todo" | "approved";

export const CHECKLIST_STATUS_ORDER: readonly ChecklistStatus[] = [
  "stale",
  "todo",
  "approved",
];

export type StatusInput = { verified: boolean; stale?: boolean };

export function comboStatus(combo: StatusInput): ChecklistStatus {
  if (!combo.verified) return "todo";
  return combo.stale ? "stale" : "approved";
}

export type StatusCounts = Record<ChecklistStatus, number>;

export function countStatuses(combos: readonly StatusInput[]): StatusCounts {
  const counts: StatusCounts = { stale: 0, todo: 0, approved: 0 };
  for (const combo of combos) counts[comboStatus(combo)] += 1;
  return counts;
}

/** The template's status: its most urgent row's ("approved" when it has no
 *  rows to do — an empty template needs nothing). */
export function templateStatus(
  combos: readonly StatusInput[],
): ChecklistStatus {
  const counts = countStatuses(combos);
  if (counts.stale > 0) return "stale";
  if (counts.todo > 0) return "todo";
  return "approved";
}

/** Split items into the three groups, each in its arrival order. */
export function groupByStatus<T>(
  items: readonly T[],
  statusOf: (item: T) => ChecklistStatus,
): Record<ChecklistStatus, T[]> {
  const groups: Record<ChecklistStatus, T[]> = {
    stale: [],
    todo: [],
    approved: [],
  };
  for (const item of items) groups[statusOf(item)].push(item);
  return groups;
}

/** A template's rows: stale, then unverified, then approved. */
export function groupCombos<T extends StatusInput>(
  combos: readonly T[],
): Record<ChecklistStatus, T[]> {
  return groupByStatus(combos, comboStatus);
}

/** An era's templates: the ones with a stale row, then the ones with an
 *  unverified row (open, at the top), then the fully approved ones. */
export function groupTemplates<T extends { combos: readonly StatusInput[] }>(
  templates: readonly T[],
): { open: T[]; approved: T[] } {
  const groups = groupByStatus(templates, (t) => templateStatus(t.combos));
  return { open: [...groups.stale, ...groups.todo], approved: groups.approved };
}

/** "1 to re-verify · 3 to verify · 4 approved" — the zero parts left out. */
export function statusCountsLabel(counts: StatusCounts): string {
  const parts: string[] = [];
  if (counts.stale > 0) parts.push(`${counts.stale} to re-verify`);
  if (counts.todo > 0) parts.push(`${counts.todo} to verify`);
  if (counts.approved > 0) parts.push(`${counts.approved} approved`);
  return parts.join(" · ");
}
