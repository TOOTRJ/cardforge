import { buildTypeLine, normalizeFrameTemplate, printsPowerToughness } from "@/lib/cards/card-display";
import { cardTypeHasRarity } from "@/lib/cards/emblem";
import { rowHasBakedBack } from "@/lib/cards/faces";
import { cardPageRulesText } from "@/lib/cards/page-rules-text";
import { frontDrawsPowerToughness, secondFaceDrawsPowerToughness } from "@/lib/cards/pt-drawn";
import { backRulesTextWithSelfName } from "@/lib/cards/self-name";
import { getFrameProfile } from "@/lib/cards/template-layout";
import { templatePaintsSecondFace } from "@/lib/creator/card-kinds";
import { secondPartWordsOfCard, type SecondPartWords } from "@/lib/creator/second-part";
import {
  COLOR_IDENTITY_LABELS,
  RARITY_LABELS,
  type CardBackFace,
  type CardType,
  type ColorIdentity,
  type FaceContent,
  type Rarity,
} from "@/types/card";

// ---------------------------------------------------------------------------
// A stored card's faces as TEXT, the way its picture prints them (TODO
// CP2b) — the ONE answer for the card page's "Card details"
// (components/cards/card-detail-content.tsx CardDetails) and for every file
// that writes a card out as text (the play-surface exports,
// lib/tools/play-exports): the name, cost, the BUILT type line, the rarity,
// the rules with CARDNAME / ~ as the printed name, the flavour, the artist
// and the stats the frame draws.
//
//   front       always;
//   back        a back face with a BODY of its own (lib/cards/faces.ts
//               rowHasBakedBack) — the face a bake writes as `.back.png`;
//   secondPart  a two-part card that is ONE picture (split, aftermath,
//               adventure, flip, Prepare: templatePaintsSecondFace) with a
//               second part that says something, named in its own words
//               (`partWords`, "Right half").
// Pure: no rendering, no I/O.
// ---------------------------------------------------------------------------

export type CardTextFace = {
  name: string;
  cost: string | null;
  typeLine: string;
  /** The rarity's label; null where the card names none (an emblem). */
  rarity: string | null;
  /** Rules with CARDNAME / ~ already as the printed name (lib/cards/self-name.ts). */
  rulesText: string | null;
  flavorText: string | null;
  /** "9/9", "Loyalty 3", "Defense 5" — what the picture prints, else null. */
  stats: { value: string; label: string | null } | null;
  artist: string | null;
  /** A back face's colour in words ("Green") — the colour its body is drawn in. */
  colorLine?: string | null;
};

/** The stored columns the text faces read — a `Card` has them all. */
export type CardTextColumns = {
  title: string;
  cost: string | null;
  card_type: string | null;
  supertype: string | null;
  printed_types?: string | null;
  nickname?: string | null;
  subtypes: string[] | null;
  rarity: string | null;
  color_identity: string[] | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  defense: string | null;
  artist_credit: string | null;
  rules_text?: string | null;
  flavor_text?: string | null;
  face_content?: unknown;
  frame_style?: unknown;
  back_face?: unknown;
};

export type CardTextFaces = {
  front: CardTextFace;
  back: CardTextFace | null;
  secondPart: CardTextFace | null;
  /** The two parts' words ("Left half" / "Right half") with `secondPart`. */
  partWords: SecondPartWords | null;
};

/** One face's stats, as the picture prints them: the P/T only where the
 *  frame draws it and the type prints one (lib/cards/pt-drawn.ts,
 *  printsPowerToughness: a Treasure token with a stray P/T, a saga whose
 *  type says Creature, a station card with no tier print none — the stored
 *  values are untouched); else the loyalty, else the defense. */
export function faceStats(
  drawsPt: boolean,
  face: {
    card_type: string | null;
    supertype: string | null;
    subtypes: string[] | null;
    power: string | null;
    toughness: string | null;
    loyalty: string | null;
    defense: string | null;
  },
): CardTextFace["stats"] {
  if (
    drawsPt &&
    printsPowerToughness({
      cardType: face.card_type as CardType | null,
      supertype: face.supertype,
      subtypes: face.subtypes ?? [],
      power: face.power,
      toughness: face.toughness,
    })
  ) {
    return { value: `${face.power ?? "?"}/${face.toughness ?? "?"}`, label: "Power and toughness" };
  }
  if (face.loyalty != null) return { value: `Loyalty ${face.loyalty}`, label: null };
  if (face.defense != null) return { value: `Defense ${face.defense}`, label: null };
  return null;
}

/** The colour words of a stored colour list ("Blue, Red"). */
export function colorWords(colors: readonly string[]): string {
  return colors.map((c) => COLOR_IDENTITY_LABELS[c as ColorIdentity] ?? c).join(", ");
}

export function cardTextFacesOf(card: CardTextColumns): CardTextFaces {
  const frontTemplate = (card.frame_style as { template?: string | null } | null | undefined)?.template;
  const faceContent = (card.face_content ?? null) as FaceContent | null;
  const selfName = card.frame_style as { selfName?: string } | null;
  const front: CardTextFace = {
    name: card.title,
    cost: card.cost,
    typeLine: buildTypeLine({
      supertype: card.supertype,
      cardType: card.card_type as CardType | null,
      subtypes: card.subtypes ?? [],
      printedTypes: card.printed_types,
    }),
    // An emblem has no rarity (CR 114): none for its stored "common".
    rarity: cardTypeHasRarity(card.card_type) && card.rarity ? RARITY_LABELS[card.rarity as Rarity] ?? card.rarity : null,
    // Its text or its rows, CARDNAME / ~ as the name the title bar prints
    // (TODO 6.2) — the meta description's and the JSON-LD's one answer.
    rulesText: cardPageRulesText({ ...card, rules_text: card.rules_text ?? null }),
    flavorText: card.flavor_text ?? null,
    stats: faceStats(frontDrawsPowerToughness(frontTemplate, { rulesText: card.rules_text ?? null, faceContent }), card),
    artist: card.artist_credit?.trim() || null,
  };

  // The back face with a body of its own (lib/cards/faces.ts): never a
  // legacy back's (the page flips to it, but the bake and the downloads are
  // the front's). Its colour is its own, else the front's — the colour its
  // body is drawn in (backPreviewData).
  const colors = card.color_identity ?? [];
  const backRow = rowHasBakedBack({ frame_style: card.frame_style, back_face: card.back_face ?? null })
    ? ((card.back_face as CardBackFace | null) ?? null)
    : null;
  const back: CardTextFace | null = backRow
    ? {
        name: backRow.title?.trim() || "Back face",
        cost: backRow.cost ?? null,
        typeLine: buildTypeLine({
          supertype: backRow.supertype,
          cardType: backRow.card_type ?? null,
          subtypes: backRow.subtypes ?? [],
          printedTypes: backRow.printed_types,
        }),
        rarity: null,
        // Its rules with CARDNAME / ~ as ITS name (TODO 6.2), as the back draws.
        rulesText: backRulesTextWithSelfName(backRow, selfName) ?? null,
        flavorText: backRow.flavor_text ?? null,
        // Its body's own P/T slot (a land back body has none).
        stats: faceStats(secondFaceDrawsPowerToughness(frontTemplate, backRow.frame_style?.template), {
          card_type: backRow.card_type ?? null,
          supertype: backRow.supertype ?? null,
          subtypes: backRow.subtypes ?? null,
          power: backRow.power ?? null,
          toughness: backRow.toughness ?? null,
          loyalty: backRow.loyalty ?? null,
          defense: backRow.defense ?? null,
        }),
        artist: backRow.artist_credit?.trim() || null,
        colorLine: colorWords(backRow.color_identity ?? colors) || "Colorless",
      }
    : null;

  // A two-part card that is ONE picture (templatePaintsSecondFace): the
  // second part the frame draws, in its own words — its name, cost, type
  // line and rules (with ~ as its own name); never a flavour or an artist
  // (no second part prints one), its P/T only where the frame draws one
  // (flip).
  const second =
    !backRow && templatePaintsSecondFace(frontTemplate ?? undefined)
      ? ((card.back_face as CardBackFace | null) ?? null)
      : null;
  const partWords = second ? secondPartWordsOfCard(card.card_type as CardType | null, frontTemplate) : null;
  const template = normalizeFrameTemplate(frontTemplate, { rulesText: card.rules_text ?? null });
  const secondPart: CardTextFace | null =
    second && partWords && (second.title?.trim() || second.cost?.trim() || second.rules_text?.trim())
      ? {
          name: second.title?.trim() || partWords.second,
          cost: second.cost ?? null,
          typeLine: buildTypeLine({
            supertype: second.supertype,
            cardType: second.card_type ?? null,
            subtypes: second.subtypes ?? [],
            printedTypes: second.printed_types,
          }),
          rarity: null,
          rulesText: backRulesTextWithSelfName(second, selfName) ?? null,
          flavorText: null,
          stats: faceStats(getFrameProfile(template).secondFace?.pt != null, {
            card_type: second.card_type ?? null,
            supertype: second.supertype ?? null,
            subtypes: second.subtypes ?? null,
            power: second.power ?? null,
            toughness: second.toughness ?? null,
            loyalty: null,
            defense: null,
          }),
          artist: null,
        }
      : null;

  return { front, back, secondPart: secondPart && partWords ? secondPart : null, partWords: secondPart ? partWords : null };
}
