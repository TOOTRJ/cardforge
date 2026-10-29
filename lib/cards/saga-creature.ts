// ---------------------------------------------------------------------------
// The saga creature's text (TODO 4.5d: FIN / FIC's "Summon:" cards). Its
// body prints the chapters on the rail AND a second box under the raised
// type bar, holding the creature's own abilities ("Indestructible",
// "Flying, lifelink", "Ward {2}") or its flavour. Scryfall's Oracle text —
// what an import stores — sets those abilities as the lines AFTER the last
// chapter, e.g. FIN #36:
//
//   (As this Saga enters and after your draw step, add a lore counter. Sacrifice after V.)
//   I, II, III, IV — Create three 2/2 white Knight creature tokens.
//   V — Ultimate End — Other creatures you control get +2/+2 …
//   Indestructible
//
// so on a frame with a creature box (ChapterSlot.creatureBox) the lines after
// the last chapter go to the box — except a modal chapter's bullets ("• …",
// FIC #71 Magus Sisters' chapter III), which stay with it. On every other
// saga a line after a chapter continues it (parseChapters), as before.
// Pure; shared by both renderers.
// ---------------------------------------------------------------------------

import { isChapterLine, parseChapters, parseSagaIntro, type SagaChapter } from "@/lib/cards/card-display";
import { resolveSagaChapters } from "@/lib/cards/face-content";
import type { FaceContent } from "@/types/card";

/** A modal chapter's option line. */
const BULLET_LINE = /^[•*]/;

/** The rules text split into the rail's text and the creature box's. */
export function splitSagaCreatureText(rulesText: string | null | undefined): {
  railText: string | null;
  creatureText: string | null;
} {
  if (!rulesText?.trim()) return { railText: rulesText ?? null, creatureText: null };
  const lines = rulesText.split("\n");
  let last = -1;
  lines.forEach((line, i) => {
    if (isChapterLine(line)) last = i;
  });
  if (last < 0) return { railText: rulesText, creatureText: null };
  let cut = last + 1;
  while (cut < lines.length && (!lines[cut].trim() || BULLET_LINE.test(lines[cut].trim()))) cut += 1;
  const creature = lines.slice(cut).join("\n").trim();
  return {
    railText: lines.slice(0, cut).join("\n").replace(/\s+$/, ""),
    creatureText: creature || null,
  };
}

/** What a saga-creature frame draws: the rail's intro and chapters (the
 *  stored rows first, as resolveSagaChapters) and the creature box's text. */
export function resolveSagaCreature(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): { intro: string | null; chapters: SagaChapter[]; creatureText: string | null } {
  const { railText, creatureText } = splitSagaCreatureText(rulesText);
  const rail = faceContent?.saga?.chapters.length
    ? resolveSagaChapters(faceContent, railText)
    : { intro: parseSagaIntro(railText), chapters: parseChapters(railText) };
  return { ...rail, creatureText };
}
