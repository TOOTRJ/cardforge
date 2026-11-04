import { serializeLoyalty, serializeSaga } from "@/lib/cards/face-content";
import { storedRulesTextWithSelfName } from "@/lib/cards/self-name";
import { serializeStation } from "@/lib/cards/station";
import type { FaceContent } from "@/types/card";

// ---------------------------------------------------------------------------
// A stored card's rules as its page says them in words (TODO CP2b) — the
// "Card details" text block, the meta description and the JSON-LD `text`
// read this ONE answer, so a card the picture draws rules for never reads as
// one with none. A walker, saga or station card may be stored with its ROWS
// alone (`face_content`, `rules_text` NULL): the rows are the plain text both
// renderers read back (lib/cards/face-content.ts). CARDNAME / ~ are the name
// the title bar prints (TODO 6.2).
// ---------------------------------------------------------------------------

/** The rules a card's rows say when its `rules_text` is empty. */
export function rulesTextOfRows(rulesText: string | null, faceContent: FaceContent | null): string | null {
  if (rulesText?.trim()) return rulesText;
  if (faceContent?.loyalty?.abilities?.length) return serializeLoyalty(faceContent.loyalty.abilities);
  if (faceContent?.saga?.chapters?.length) return serializeSaga(faceContent.saga.intro, faceContent.saga.chapters);
  if (faceContent?.station) return serializeStation(faceContent.station.intro, faceContent.station.tiers);
  return rulesText;
}

/** The card's rules as its page says them: its text or its rows, with
 *  CARDNAME / ~ as its printed name. */
export function cardPageRulesText(card: {
  title: string;
  nickname?: string | null;
  rules_text: string | null;
  frame_style?: unknown;
  face_content?: unknown;
}): string | null {
  const rulesText = rulesTextOfRows(card.rules_text, (card.face_content ?? null) as FaceContent | null);
  return storedRulesTextWithSelfName({ ...card, rules_text: rulesText });
}
