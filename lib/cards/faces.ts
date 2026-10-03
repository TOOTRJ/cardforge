// ---------------------------------------------------------------------------
// faces — ONE card row onto its two faces (TODO 5.0a; design 2026-10-02,
// design-next/5/final.md §2.4, D7, D8, D9, D18).
//
// A double-faced card is ONE row (owner decision Q1): the front is the card,
// the back is `cards.back_face` with — once Phase 5's bodies exist — its own
// body (`frame_style.template`) and colour. Both renderers draw a face from a
// `CardPreviewData`, so this module maps the one card onto two of them:
//
//   • `frontPreviewData(card)` — the card as it is, plus its `dfc` block
//     when its template is a DFC front body;
//   • `backPreviewData(card)` — the back's own content, body and colour; the
//     card's rarity, finish, set symbol, collector fields (both faces print
//     the card's ONE collector line, D8), watermark (D18) and anatomy
//     switches; plus the twin `dfc` block. Null when the card has no back
//     face to flip to.
//
// A LEGACY back — a `back_face` with no body (the 8 imported DFCs, and every
// row from before Phase 5) — maps to EXACTLY what the preview has always
// drawn for it (components/cards/card-preview.tsx backFaceData + the front's
// faceProps): the back's content on the FRONT's template, colour, finish and
// switches, with no structured content, no watermark and no collector
// fields. Byte-identical to today, no `dfc` block.
//
// The `dfc` block is the ONE source of cross-face data for both renderers
// (5.1a / 5.1b draw the icon rider, the front's reverse P/T and the modal
// strip from it; nothing reads it yet): derived at render, never stored
// (D7). `otherFace` is what the OTHER face puts on this one — the back's P/T
// in the front's grey tab (drawn only when the back prints a P/T; the tab
// prints empty otherwise, owner decision Q7), the other face's LAST type
// word and its cost or, for a land, its mana ability on the modal strip
// (D9: "Land", "Equipment", "God", "Warrior"; `{T}: Add {W}.` — never a
// land's first printed line).
//
// Pure: no rendering, no I/O. The bake gets here through rowToPreviewData
// (lib/cards/bake-core.ts), the preview through its props.
// ---------------------------------------------------------------------------

import type { CardPreviewData } from "@/components/cards/card-preview";
import { buildTypeLine, printsPowerToughness } from "@/lib/cards/card-display";
import {
  DEFAULT_DFC_ICON,
  dfcBodyOf,
  isDfcBackBody,
  isDfcIconFamily,
  templateHasBackFace,
  type DfcIconFamily,
  type DfcLayout,
  type DfcRole,
} from "@/lib/cards/dfc";
import type { CardBackFace, CardType, ColorIdentity, FrameTemplate } from "@/types/card";

/** What the OTHER face puts on this one. */
export type DfcOtherFace = {
  /** The LAST word of the other face's type line — "Land", "Sorcery",
   *  "Equipment", "Artifact", "God", "Warrior", "Tibalt" (D9: the modal
   *  strip's word). Null when the other face has no type line. */
  typeWord: string | null;
  /** The other face's mana cost or, for a land with none, its mana ability
   *  (the first rules line `{T}: Add …`); null when it has neither (the
   *  modal strip's line). */
  line: string | null;
  /** Whether the other face PRINTS a P/T (printsPowerToughness — the
   *  predicate both renderers gate the plate on): the front's grey tab
   *  draws the back's P/T only then. */
  printsPt: boolean;
  power: string | null;
  toughness: string | null;
};

/** The cross-face block a DFC face carries (CardPreviewData.dfc). */
export type DfcFace = {
  layout: DfcLayout;
  role: DfcRole;
  /** The transform icon family the card wears (FrameStyle.dfcIcon, else
   *  `arrows` — owner decision Q5); null on a modal card, whose housing has
   *  no family. The glyph drawn is the family's for this face's role. */
  icon: DfcIconFamily | null;
  otherFace: DfcOtherFace;
};

/** A face's content, as either side of the mapping sees it. */
export type FaceContentFacts = {
  cost?: string | null;
  cardType?: CardType | null;
  supertype?: string | null;
  subtypes?: readonly string[] | null;
  rulesText?: string | null;
  power?: string | null;
  toughness?: string | null;
};

const MANA_ABILITY_LINE = /^\{T\}:\s*Add\b/i;

/** The last word of a face's type line, or null when it has none (an empty
 *  type line is buildTypeLine's "Type" placeholder). */
export function typeWordOf(face: FaceContentFacts): string | null {
  const line = buildTypeLine({
    supertype: face.supertype,
    cardType: face.cardType,
    subtypes: face.subtypes ?? undefined,
  });
  if (line === "Type") return null;
  const words = line.split(/\s+/).filter((word) => word && word !== "—");
  return words.length ? words[words.length - 1] : null;
}

/** A face's mana cost, else — for a land — its mana ability line, else
 *  null. */
export function manaLineOf(face: FaceContentFacts): string | null {
  const cost = face.cost?.trim();
  if (cost) return cost;
  if (face.cardType !== "land") return null;
  for (const raw of (face.rulesText ?? "").split("\n")) {
    const line = raw.trim();
    if (MANA_ABILITY_LINE.test(line)) return line;
  }
  return null;
}

export function otherFaceOf(face: FaceContentFacts): DfcOtherFace {
  return {
    typeWord: typeWordOf(face),
    line: manaLineOf(face),
    printsPt: printsPowerToughness({
      cardType: face.cardType,
      subtypes: face.subtypes,
      supertype: face.supertype,
      power: face.power,
      toughness: face.toughness,
    }),
    power: face.power ?? null,
    toughness: face.toughness ?? null,
  };
}

function backFacts(back: CardBackFace): FaceContentFacts {
  return {
    cost: back.cost ?? null,
    cardType: back.card_type ?? null,
    supertype: back.supertype ?? null,
    subtypes: back.subtypes ?? [],
    rulesText: back.rules_text ?? null,
    power: back.power ?? null,
    toughness: back.toughness ?? null,
  };
}

/** The back's own BODY and colour, or null for a legacy back. Honoured only
 *  when the card's front IS a DFC front body and the stored template IS a
 *  back body (lib/cards/dfc.ts): anything else — a body stored on a plain
 *  card by an older client, a template that isn't a back — draws as a
 *  legacy back, so a stray value can never move a card off today's look. */
export function backBodyOf(card: Pick<CardPreviewData, "frameStyle" | "backFace">): {
  template: FrameTemplate;
  colorIdentity: ColorIdentity[] | null;
} | null {
  const body = card.backFace?.frame_style?.template;
  if (!body) return null;
  if (!templateHasBackFace(card.frameStyle?.template) || !isDfcBackBody(body)) return null;
  return { template: body, colorIdentity: card.backFace?.color_identity ?? null };
}

/** The family a transform card wears: its stored key, else `arrows`. */
export function dfcIconOf(card: Pick<CardPreviewData, "frameStyle">): DfcIconFamily {
  const stored = card.frameStyle?.dfcIcon;
  return isDfcIconFamily(stored) ? stored : DEFAULT_DFC_ICON;
}

function dfcBlock(card: CardPreviewData, role: DfcRole, other: FaceContentFacts): DfcFace | null {
  const body = dfcBodyOf(card.frameStyle?.template);
  if (!body || body.role !== "front") return null;
  return {
    layout: body.layout,
    role,
    icon: body.layout === "transform" ? dfcIconOf(card) : null,
    otherFace: otherFaceOf(other),
  };
}

/** The front face: the card itself, with its `dfc` block when its template
 *  is a DFC front body (the block's `otherFace` is the back's — the grey
 *  tab, the strip). Any other card is returned as it is. */
export function frontPreviewData(card: CardPreviewData): CardPreviewData {
  const dfc = card.backFace ? dfcBlock(card, "front", backFacts(card.backFace)) : null;
  return dfc ? { ...card, dfc } : card;
}

/**
 * The back face as its own CardPreviewData, or null when the card has no
 * back face. A legacy back (no body) is today's flip exactly: the back's
 * content on the front's template, colour, finish and switches. A back with
 * a body draws on that body and its colour, with the card's collector
 * fields and watermark, and carries the twin `dfc` block (its `otherFace` is
 * the front's).
 */
export function backPreviewData(card: CardPreviewData): CardPreviewData | null {
  const back = card.backFace;
  if (!back) return null;
  const content = {
    title: back.title ?? null,
    cost: back.cost ?? null,
    cardType: back.card_type ?? null,
    supertype: back.supertype ?? null,
    subtypes: back.subtypes ?? [],
    rulesText: back.rules_text ?? null,
    flavorText: back.flavor_text ?? null,
    power: back.power ?? null,
    toughness: back.toughness ?? null,
    loyalty: back.loyalty ?? null,
    defense: back.defense ?? null,
    artistCredit: back.artist_credit ?? null,
    artUrl: back.art_url ?? null,
    artPosition: back.art_position ?? {},
    // A face of its own: never a flip inside the flip.
    backFace: null,
    backCard: null,
  };
  const body = backBodyOf(card);
  if (!body) {
    // Legacy: the preview's backFaceData on the front's faceProps — no
    // structured content, no watermark, no collector fields, no block.
    return {
      ...card,
      ...content,
      faceContent: null,
      watermark: null,
      setCode: null,
      collectorNumber: null,
      lang: null,
      dfc: null,
    };
  }
  return {
    ...card,
    ...content,
    frameStyle: { ...(card.frameStyle ?? {}), template: body.template },
    colorIdentity: body.colorIdentity ?? card.colorIdentity ?? [],
    // Structured rows on a back wait for the walker bodies (5.13); the
    // card's watermark and collector line print on both faces (D8, D18).
    faceContent: null,
    dfc: dfcBlock(card, "back", card),
  };
}

/** Both faces of a card at once. */
export function facesOf(card: CardPreviewData): { front: CardPreviewData; back: CardPreviewData | null } {
  return { front: frontPreviewData(card), back: backPreviewData(card) };
}
