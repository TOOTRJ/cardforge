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
//
// That line split is for a text with NO stored rows (an import, a card saved
// as plain text). Beside stored rows (`face_content.saga`, which the rail
// draws first) the box's text is what the rules text holds AFTER the rows'
// own serialization — the exact prefix `serializeSaga(rows)` + a newline,
// the rule the server's typography pass reads too
// (lib/validation/print-typography.ts) — and nothing when the text does not
// start with it. A line split there drew an ability twice: a stored row
// that had joined the trailing line into its chapter (parseChapters, a FIN
// import retitled on the saga frame) on the rail AND in the box, and a
// second line of a chapter typed with Enter on both, growing on every save;
// and it dropped a box line that read as a chapter ("Vivi — …") or a bullet.
// Pure; shared by both renderers and the creator.
// ---------------------------------------------------------------------------

import { isChapterLine, parseChapters, parseSagaIntro, type SagaChapter } from "@/lib/cards/card-display";
import { resolveSagaChapters, serializeSaga } from "@/lib/cards/face-content";
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

/** Stored rows the rail draws first (resolveSagaChapters' own test). */
function storedSagaRows(faceContent: FaceContent | null | undefined): FaceContent["saga"] | null {
  return faceContent?.saga && faceContent.saga.chapters.length > 0 ? faceContent.saga : null;
}

/** Beside stored rows: the text after their exact serialization (above), or
 *  null — none when the text is the rows alone or says something else. */
export function sagaCreatureTextAfterRows(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): string | null {
  const saga = storedSagaRows(faceContent);
  if (!saga || !rulesText) return null;
  const rows = serializeSaga(saga.intro, saga.chapters);
  if (!rulesText.startsWith(`${rows}\n`)) return null;
  return rulesText.slice(rows.length + 1).trim() || null;
}

/** The creature box's text on a saga-creature frame: after the stored rows
 *  where there are rows, else the lines after the last chapter. */
export function sagaCreatureTextOf(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): string | null {
  return storedSagaRows(faceContent)
    ? sagaCreatureTextAfterRows(faceContent, rulesText)
    : splitSagaCreatureText(rulesText).creatureText;
}

/** What a saga-creature frame draws: the rail's intro and chapters (the
 *  stored rows first, as resolveSagaChapters) and the creature box's text. */
export function resolveSagaCreature(
  faceContent: FaceContent | null | undefined,
  rulesText: string | null | undefined,
): { intro: string | null; chapters: SagaChapter[]; creatureText: string | null } {
  if (storedSagaRows(faceContent)) {
    return { ...resolveSagaChapters(faceContent, rulesText), creatureText: sagaCreatureTextAfterRows(faceContent, rulesText) };
  }
  const { railText, creatureText } = splitSagaCreatureText(rulesText);
  return { intro: parseSagaIntro(railText), chapters: parseChapters(railText), creatureText };
}
