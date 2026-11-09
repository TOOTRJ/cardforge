// ---------------------------------------------------------------------------
// The Rule 0 table sheet beta tool (migration 0190) — its slug and its
// addresses. Client-safe.
// ---------------------------------------------------------------------------

export const RULE0_TOOL_SLUG = "rule0-sheet";

/** A deck's table sheet: the owner's editor and the shared link alike. */
export function tableSheetPath(deckSlug: string): string {
  return `/deck/${deckSlug}/table-sheet`;
}

/** The stored row as the app reads it (deck_table_sheets). */
export type TableSheetRow = {
  deckId: string;
  gamePlan: string | null;
  winConditions: string | null;
  tableNotes: string | null;
  shared: boolean;
  aiDraftedAt: string | null;
  updatedAt: string | null;
};

export const EMPTY_TABLE_SHEET = {
  gamePlan: null,
  winConditions: null,
  tableNotes: null,
  shared: false,
  aiDraftedAt: null,
  updatedAt: null,
} as const satisfies Omit<TableSheetRow, "deckId">;
