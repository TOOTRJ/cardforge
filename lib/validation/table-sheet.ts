import { z } from "zod";

// ---------------------------------------------------------------------------
// The Rule 0 table sheet's owner-written fields (migration 0190's CHECKs:
// deck_table_sheets.game_plan ≤ 1000, win_conditions ≤ 600, table_notes ≤
// 600 characters, NULL for none — never blank). Shared by the editor and the
// save action. Win conditions are one per line, at most
// TABLE_SHEET_LIMITS.winConditionLines of them.
// ---------------------------------------------------------------------------

export const TABLE_SHEET_LIMITS = {
  gamePlan: 1000,
  winConditions: 600,
  winConditionLines: 6,
  tableNotes: 600,
} as const;

/** Trimmed; blank → null (the column's "none"). */
function optionalText(max: number, label: string) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").trim())
    .pipe(z.string().max(max, `${label} can be at most ${max} characters.`))
    .transform((value) => (value === "" ? null : value));
}

/** The win conditions as lines: trimmed, blank lines dropped. */
export function winConditionLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

export const tableSheetTextSchema = z.object({
  gamePlan: optionalText(TABLE_SHEET_LIMITS.gamePlan, "The game plan"),
  winConditions: optionalText(TABLE_SHEET_LIMITS.winConditions, "Win conditions").refine(
    (value) => winConditionLines(value).length <= TABLE_SHEET_LIMITS.winConditionLines,
    `List at most ${TABLE_SHEET_LIMITS.winConditionLines} win conditions, one per line.`,
  ),
  tableNotes: optionalText(TABLE_SHEET_LIMITS.tableNotes, "Table notes"),
});

export type TableSheetTextInput = z.input<typeof tableSheetTextSchema>;
export type TableSheetText = z.output<typeof tableSheetTextSchema>;
