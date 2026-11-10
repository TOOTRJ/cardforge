import "server-only";

import { generateObject } from "ai";
import { z } from "zod";
import { designModel } from "@/lib/ai/provider";
import { textModelOptions } from "@/lib/ai/sampling";
import { repairStructuredText, structuredCall } from "@/lib/ai/structured-output";
import { DECK_FORMAT_LABELS, type DeckFormat } from "@/types/deck";
import { commanderBracket } from "@/lib/decks/deck-types";
import { TABLE_SHEET_LIMITS } from "@/lib/validation/table-sheet";

// ---------------------------------------------------------------------------
// The table sheet's optional AI draft (1 credit): ONE design call reads the
// deck — its commander(s), its cards' names and types, and the rules text of
// the PipGlyph cards in it (a real card's text isn't stored with a deck) —
// and answers with a short game plan and up to five win conditions, in
// plain words the owner then edits. The sheet never needs it.
// ---------------------------------------------------------------------------

const clamp = (max: number) => z.string().transform((v) => v.replace(/\s+/g, " ").trim().slice(0, max));

export const tableSheetDraftSchema = z.object({
  gamePlan: clamp(600).describe(
    "Two to four sentences for the other players at the table: how this deck plays, how fast it is, and what it does on a typical turn. Plain words, no card-by-card list.",
  ),
  winConditions: z
    .array(clamp(120))
    .min(1)
    .max(5)
    .describe("One to five short lines, each one way this deck actually wins (name the key cards where it helps)."),
});

export type TableSheetDraft = { gamePlan: string; winConditions: string[] };

export type DraftCardLine = {
  name: string;
  quantity: number;
  board: string;
  typeLine: string | null;
  /** A PipGlyph card's own rules text (the real cards' isn't stored). */
  rulesText: string | null;
};

const SYSTEM = [
  "You write the 'Rule 0' summary a Magic: The Gathering player shows their table before a Commander game.",
  "From the deck list you are given, describe how the deck plays and how it wins — honestly, including how fast or",
  "interactive it is. Never invent cards: only mention cards that are in the list. Cards marked CUSTOM are the",
  "player's own designs; read their rules text as given. No hype, no marketing words.",
].join(" ");

/** The prompt's card lines, commander first, at most 140. */
export function draftPromptLines(cards: readonly DraftCardLine[]): string {
  const order = (board: string) => (board === "commander" ? 0 : board === "main" ? 1 : 2);
  return [...cards]
    .sort((a, b) => order(a.board) - order(b.board))
    .slice(0, 140)
    .map((card) => {
      const head = `${card.quantity}× ${card.name}${card.typeLine ? ` — ${card.typeLine}` : ""}${card.board === "commander" ? " (COMMANDER)" : ""}`;
      return card.rulesText ? `${head} (CUSTOM: ${card.rulesText.replace(/\s+/g, " ").slice(0, 220)})` : head;
    })
    .join("\n");
}

export async function draftTableSheet(input: {
  title: string;
  format: DeckFormat;
  bracket: number | null;
  description: string | null;
  cards: readonly DraftCardLine[];
}): Promise<TableSheetDraft> {
  const bracket = input.format === "commander" ? commanderBracket(input.bracket) : null;
  const { object } = await structuredCall("table-sheet", repairStructuredText(tableSheetDraftSchema), (experimental_repairText) =>
    generateObject({
      ...textModelOptions(designModel(), 0.4),
      schema: tableSheetDraftSchema,
      experimental_repairText,
      system: SYSTEM,
      prompt: [
        `Deck: ${input.title} (${DECK_FORMAT_LABELS[input.format]})`,
        bracket ? `The owner's bracket: ${bracket.level} (${bracket.name}).` : null,
        input.description ? `The owner's description: ${input.description.replace(/\s+/g, " ").slice(0, 400)}` : null,
        "Cards:",
        draftPromptLines(input.cards),
      ]
        .filter(Boolean)
        .join("\n"),
    }),
  );
  const winConditions = object.winConditions.filter(Boolean).slice(0, TABLE_SHEET_LIMITS.winConditionLines);
  let lines = winConditions;
  // Hold the stored column's limit (≤ 600 characters with newlines).
  while (lines.join("\n").length > TABLE_SHEET_LIMITS.winConditions && lines.length > 1) lines = lines.slice(0, -1);
  return { gamePlan: object.gamePlan, winConditions: lines };
}
