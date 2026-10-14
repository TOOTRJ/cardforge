// The station frame's TIER EDITOR, its data (TODO 4.27a, PR 2). Pure: no
// form, no React (tests/unit/creator/station-rows.test.ts).
//
// ONE source. A station card's text is the form's `rules_text` in the
// grammar both renderers read (lib/cards/station.ts: the top band, then
// "N+ | text" per tier) — the tier editor is a VIEW of that one field: it
// shows the top band and the tiers the text holds and writes every change
// back into it. Nothing is carried beside the text that could disagree with
// it, so every other path that sets the rules text (an AI fill, an import, a
// kind or frame change away and back, a remix) needs no twin, and a card
// that leaves the frame shows the same text in the ordinary rules box.
//
// The ONE thing the text cannot always say is which tier carries the power /
// toughness: the text plates the tier its reminder names ("creature at
// 12+"), else the last. A maker's other choice is the form's
// `station_pt_tier` (null = as the text says), and a save writes the rows —
// `face_content.station`, read BEFORE the text by both renderers — with it
// (lib/creator/structured-rules.ts).
//
// An EDIT never changes what its maker did not touch: nothing here writes on
// open — the rows are read from the text, and the text is only rewritten by
// a change to a row. A shape the editor cannot show as rows is kept as the
// text has it: a FOURTH tier line stays in the third tier's text as typed
// (parseStationText), and the editor says so.

import {
  STATION_MAX_THRESHOLD,
  STATION_MAX_TIERS,
  parseStationText,
  platedTierIndex,
  serializeStation,
} from "@/lib/cards/station";
import type { FaceContent } from "@/types/card";

/** "No tier carries the P/T" — only ever read from stored rows that mark
 *  none (the editor offers no such choice). */
export const STATION_PT_NONE = -1;

export type StationEditorTier = {
  /** The threshold the text holds (1–99). */
  n: number;
  /** What the number box shows — the maker's keystrokes, which may not be a
   *  number yet. Never written to the text until it is one. */
  input: string;
  text: string;
};

export type StationEditorRows = { intro: string; tiers: StationEditorTier[] };

/** The rows a rules text holds, as the editor shows them. */
export function stationRowsOfText(rulesText: string | null | undefined): StationEditorRows {
  const parsed = parseStationText(rulesText);
  return { intro: parsed.intro, tiers: parsed.tiers.map((t) => ({ n: t.threshold, input: String(t.threshold), text: t.text })) };
}

/** The rules text of the editor's rows AS TYPED — nothing trimmed, so a
 *  space or a new line typed at the end of a box survives the round trip
 *  through the form (the save writes the canonical text). */
export function composeStationText(rows: StationEditorRows): string {
  const lines = rows.tiers.map((t) => `${t.n}+ | ${t.text}`);
  return rows.intro === "" ? lines.join("\n") : [rows.intro, ...lines].join("\n");
}

/** A threshold box's keystrokes as a number, or null while they are not one. */
export function thresholdOf(input: string): number | null {
  if (!/^\d{1,2}$/.test(input.trim())) return null;
  const n = Number(input.trim());
  return n >= 1 && n <= STATION_MAX_THRESHOLD ? n : null;
}

/** The threshold a NEW tier opens with: past the last one. */
export function nextThreshold(tiers: readonly Pick<StationEditorTier, "n">[]): number {
  const last = tiers[tiers.length - 1];
  return last ? Math.min(STATION_MAX_THRESHOLD, last.n + 4) : 2;
}

export const canAddStationTier = (tiers: readonly unknown[]) => tiers.length < STATION_MAX_TIERS;

/** Tier lines past the third, which a card does not draw as tiers: they sit
 *  in the third tier's text as typed. What the editor's note quotes. */
export function extraTierLines(rulesText: string | null | undefined): string[] {
  const { tiers } = parseStationText(rulesText);
  if (tiers.length < STATION_MAX_TIERS) return [];
  return tiers[tiers.length - 1]!.text.split("\n").filter((line) => /^\d{1,2}\+\s*\|/.test(line));
}

/** The tier that carries the P/T: the maker's choice while it names a tier
 *  the text has, else the tier the text plates (its reminder's, else the
 *  last). -1 = none (no tier, or stored rows that plate none). */
export function stationPlatedTier(rulesText: string | null | undefined, choice: number | null | undefined): number {
  const parsed = parseStationText(rulesText);
  if (parsed.tiers.length === 0) return -1;
  if (choice === STATION_PT_NONE) return -1;
  if (choice != null && choice >= 0 && choice < parsed.tiers.length) return choice;
  return platedTierIndex(parsed.intro, parsed.tiers);
}

/** `station_pt_tier` after tier `removed` is taken out. */
export function ptChoiceAfterRemove(choice: number | null | undefined, removed: number): number | null {
  if (choice == null || choice === STATION_PT_NONE) return choice ?? null;
  if (choice === removed) return null;
  return choice > removed ? choice - 1 : choice;
}

/** The text the form OPENS a stored card with. The rows are what the card
 *  draws, so where stored rows and stored text disagree (rows written by
 *  the API beside another text) the editor shows the ROWS — serialized; an
 *  untouched save still keeps the stored text byte for byte
 *  (submittedRulesOf, `storedRulesText`). Everywhere else: the stored text. */
export function stationOpenText(rulesText: string | null | undefined, faceContent: FaceContent | null | undefined): string {
  const rows = faceContent?.station;
  const text = rulesText ?? "";
  if (!rows) return text;
  const tiers = rows.tiers.slice(0, STATION_MAX_TIERS);
  const parsed = parseStationText(text);
  const same =
    parsed.intro === (rows.intro?.trim() ?? "") &&
    parsed.tiers.length === tiers.length &&
    parsed.tiers.every((t, i) => t.threshold === tiers[i]!.threshold && t.text === tiers[i]!.text.trim());
  return same ? text : serializeStation(rows.intro, tiers);
}

/** The form's `station_pt_tier` for a stored card: null where its rows plate
 *  the tier the text plates anyway (or it has no rows), the rows' tier
 *  where they say more, STATION_PT_NONE where they plate none. */
export function stationPtChoiceOf(rulesText: string | null | undefined, faceContent: FaceContent | null | undefined): number | null {
  const rows = faceContent?.station;
  if (!rows || rows.tiers.length === 0) return null;
  const marked = rows.tiers.slice(0, STATION_MAX_TIERS).findIndex((t) => t.pt === true);
  const parsed = parseStationText(stationOpenText(rulesText, faceContent));
  if (parsed.tiers.length === 0) return null;
  if (marked < 0) return STATION_PT_NONE;
  return marked === platedTierIndex(parsed.intro, parsed.tiers) ? null : marked;
}

/** The Station reminder as printed, for the button that adds it. */
export function stationReminder(word: "Spacecraft" | "Planet", creatureAt: number | null): string {
  return `Station (Tap another creature you control: Put charge counters equal to its power on this ${word}. Station only as a sorcery.${
    creatureAt ? ` It's an artifact creature at ${creatureAt}+.` : ""
  })`;
}

export const STATION_TIER_LIMIT_NOTE = `A card has up to ${STATION_MAX_TIERS} tiers — a fourth is not drawn. Remove one to add another.`;
export const STATION_TIER_NEEDS_TEXT = (index: number, n: number) => `Tier ${index + 1} (${n}+) has no text yet. Write it, or remove the tier.`;
export const STATION_TIERS_MUST_RISE = (index: number, n: number, before: number) =>
  `Tier numbers rise down the card: tier ${index + 1} is ${n}+ under ${before}+. Change one of them.`;

/** What stops a station card's tiers from saving as rows, as a message for
 *  the maker — or null. (An untouched edit is never asked: the caller skips
 *  this, lib/creator/form-schema.ts.) */
export function stationTiersProblem(rulesText: string | null | undefined): string | null {
  const { tiers } = parseStationText(rulesText);
  for (const [i, tier] of tiers.entries()) {
    if (tier.text === "") return STATION_TIER_NEEDS_TEXT(i, tier.threshold);
    if (i > 0 && tier.threshold <= tiers[i - 1]!.threshold) return STATION_TIERS_MUST_RISE(i, tier.threshold, tiers[i - 1]!.threshold);
  }
  return null;
}
