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
import { resolveTwoColor } from "@/lib/cards/anatomy";
import { buildTypeLine, normalizeFrameTemplate, printsPowerToughness } from "@/lib/cards/card-display";
import { pickFrameColorKey } from "@/lib/cards/frame-color-key";
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
import type { CardFace } from "@/lib/cards/card-face";
import { getFrameProfile } from "@/lib/cards/template-layout";
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
  /** The modal strip RIDER's key (TODO 5.1c, stripKeyOf): the colour the
   *  prints paint this face's strip in — the OTHER face's. A letter for a
   *  mono-colour face (an artifact's its colour: KHM #15's Sword is white),
   *  `m` for a two-colour spell (STX #149, KHM #114 / #168), `l` for a
   *  two-colour land (MH3 #252–261's fronts: the land grey) or a front in
   *  the hybrid dress (MH3's land backs: a warm grey, never gold), `c` for
   *  a colourless spell (the artifact stand-in; no print). The renderers
   *  draw the piece only when it is not the master's own
   *  (lib/cards/anatomy.ts resolveFrameOverlays). */
  stripKey: string;
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
  /** The face's EFFECTIVE colour identity — the one it is drawn in (a
   *  back with none follows the front's, backPreviewData's rule). */
  colorIdentity?: readonly ColorIdentity[] | null;
  /** The face is drawn in the hybrid dress (its grey bars): its strip on
   *  the other face is the land grey, not gold (MH3 #252–261's backs). */
  wearsHybrid?: boolean;
};

/**
 * The strip rider's key for a face's strip on the OTHER face (TODO 5.1c) —
 * the prints' rule, measured on every modal scan (scratchpad dfc-1c/
 * research/prints-rule2.json): the strip is painted in the colour of the
 * frame the face it describes WEARS. So the key starts from the KEY THAT
 * FACE'S MASTER IS PICKED BY (lib/cards/frame-color-key.ts pickFrameColorKey,
 * what both renderers draw it on: a literal "multicolor" entry — the colour
 * chip's and the import's spelling of a two-colour back — and a mixed
 * identity are the gold master there, so they are gold here too; never a
 * re-count of the face's colour words). A mono-colour face → its letter (a
 * coloured artifact its colour: KHM #15 / #112 / #123); a two-colour spell →
 * gold (STX #149's front and back, KHM #114, #168, #179, MSH #18 / #219); a
 * LAND with no colour or more than one → the land grey `l` (MH3 #252–261's
 * ten hybrid fronts: 113,99,88, the grey land modal's tab; a land's colour
 * is its mana's, dfcFaceColorIdentity); a face in the hybrid dress → `l` too
 * (MH3 #252's land back: 218,210,206, a warm light grey — the hybrid frame's
 * bars are the grey land frame's); a colourless spell → `c` (no print; the
 * artifact stand-in on the spell bodies, the land grey on the land bodies).
 */
export function stripKeyOf(face: Pick<FaceContentFacts, "colorIdentity" | "cardType" | "wearsHybrid">): string {
  const key = pickFrameColorKey(face.colorIdentity);
  if (face.cardType === "land") return key === "c" || key === "m" ? "l" : key;
  if (key === "m" && face.wearsHybrid) return "l";
  return key;
}

/** Whether a face drawn on `template` wears the hybrid dress — the two-colour
 *  look resolved as both renderers resolve it (lib/cards/anatomy.ts
 *  resolveTwoColor: the switch, a pair identity, an all-hybrid cost, a
 *  template with hybrid masters). */
function wearsHybridDress(template: FrameTemplate | string | null | undefined, style: CardPreviewData["frameStyle"], face: FaceContentFacts): boolean {
  const profile = getFrameProfile(normalizeFrameTemplate(template));
  return resolveTwoColor(profile, style, { colors: face.colorIdentity, cost: face.cost, cardType: face.cardType, supertype: face.supertype })?.dress === "hybrid";
}

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
    stripKey: stripKeyOf(face),
  };
}

/** The back's content facts, in the colour it is drawn in (its own, else
 *  the front's) and the dress it wears on its body (a legacy back draws on
 *  the front's template). */
function backFacts(back: CardBackFace, card: Pick<CardPreviewData, "frameStyle" | "backFace" | "colorIdentity">): FaceContentFacts {
  const facts: FaceContentFacts = {
    cost: back.cost ?? null,
    cardType: back.card_type ?? null,
    supertype: back.supertype ?? null,
    subtypes: back.subtypes ?? [],
    rulesText: back.rules_text ?? null,
    power: back.power ?? null,
    toughness: back.toughness ?? null,
    colorIdentity: back.color_identity ?? card.colorIdentity ?? null,
  };
  const template = backBodyOf(card)?.template ?? card.frameStyle?.template;
  return { ...facts, wearsHybrid: wearsHybridDress(template, card.frameStyle, facts) };
}

/** The front's content facts as the back's other face: the card's own
 *  colour and the dress it wears on its template. */
function frontFacts(card: CardPreviewData): FaceContentFacts {
  const facts: FaceContentFacts = {
    cost: card.cost,
    cardType: card.cardType,
    supertype: card.supertype,
    subtypes: card.subtypes,
    rulesText: card.rulesText,
    power: card.power,
    toughness: card.toughness,
    colorIdentity: card.colorIdentity ?? null,
  };
  return { ...facts, wearsHybrid: wearsHybridDress(card.frameStyle?.template, card.frameStyle, facts) };
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
  const dfc = card.backFace ? dfcBlock(card, "front", backFacts(card.backFace, card)) : null;
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
    dfc: dfcBlock(card, "back", frontFacts(card)),
  };
}

/** Both faces of a card at once. */
export function facesOf(card: CardPreviewData): { front: CardPreviewData; back: CardPreviewData | null } {
  return { front: frontPreviewData(card), back: backPreviewData(card) };
}

/**
 * The back face a card FLIPS to, or null — the preview's own rule
 * (components/cards/card-preview.tsx showFlip): a back face, unless the
 * front's template paints it inline (an adventure's storybook page, a flip /
 * split / aftermath's rotated panel — one master, two panels, never a
 * second picture). What `/api/cards/[id]/png?face=back` and the card page's
 * `?face=back` answer: a legacy back as the page draws it today, a back
 * with a body on its body.
 */
export function flippableBackOf(card: CardPreviewData): CardPreviewData | null {
  const back = backPreviewData(card);
  if (!back) return null;
  const profile = getFrameProfile(normalizeFrameTemplate(card.frameStyle?.template, card));
  if (profile.adventure || profile.secondFace) return null;
  return back;
}

/**
 * The back face a stored bake WRITES, or null (TODO 5.3): only a back with
 * a BODY of its own gets `{id}.back.png` + `.back.thumb.webp` beside the
 * front's pair. A legacy back (the 8 imported DFCs, every row from before
 * Phase 5) is never baked — its card stays single-bake, byte for byte, and
 * its page keeps flipping to the live preview. Both bake paths
 * (lib/cards/bake-render.ts, lib/cards/rebake-batch.ts) read this one
 * predicate; so do the download modal, the deck export's manifest and the
 * page name, which offer a back only where a bake of it exists.
 */
export function bakedBackOf(card: CardPreviewData): CardPreviewData | null {
  return backBodyOf(card) ? backPreviewData(card) : null;
}

/** A stored ROW's `frame_style` / `back_face` columns, as the queries hand
 *  them over (jsonb, unknown). */
export type CardFaceColumns = { frame_style: unknown; back_face: unknown };

/** True when a stored row has a back face with a BODY — the back a bake
 *  writes and every download surface offers (TODO 5.3): the page name,
 *  the deck export's manifest, the download modal, the JSON-LD. The row's
 *  columns as the queries return them. */
export function rowHasBakedBack(row: CardFaceColumns): boolean {
  return (
    backBodyOf({
      frameStyle: (row.frame_style as CardPreviewData["frameStyle"]) ?? {},
      backFace: (row.back_face as CardBackFace | null) ?? null,
    }) !== null
  );
}

/** The faces an export of a stored row fetches: the front, and the back
 *  when it has one with a body (`["front"]` or `["front", "back"]`). */
export function exportFacesOf(row: CardFaceColumns): CardFace[] {
  return rowHasBakedBack(row) ? ["front", "back"] : ["front"];
}
