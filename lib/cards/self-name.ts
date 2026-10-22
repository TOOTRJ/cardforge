import type { CardPreviewData } from "@/components/cards/card-preview";
import { cardNickname, type NicknameSlot } from "@/lib/cards/nickname";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { getFrameProfile } from "@/lib/cards/template-layout";
import type { FaceContent } from "@/types/card";

// ---------------------------------------------------------------------------
// CARDNAME / `~` (TODO 6.2, owner 2026-10-21): in rules text, `~` and the
// word CARDNAME draw as the card's name — the name its title bar PRINTS: the
// nickname where the frame draws it (TODO 6.3), else the card's own (Card
// Conjurer's getInlineCardName; print sets a flavour-name card's rules with
// its flavour name: MSC #283 "Exile The Five Arrive", SLD #1186 "…on Post,
// Son of Rich").
//
// At RENDER time, never at save: the stored text keeps `~`, so a rename (or
// a nickname added later) follows into the rules by itself, an import can be
// written once, and the editor shows exactly what was typed. Both renderers
// call withSelfNames on the card they are handed — ONE substitution, before
// any layout reads the text — and the card page and its metadata read
// rulesTextWithSelfName.
//
// Cards stored before it whose text holds a literal `~` or CARDNAME are
// flagged by migration 0142 (`frame_style.selfName: "literal"`) and keep
// printing what they printed; their owner switches it on in the editor (an
// edit's `frame_anatomy.selfName: "name"`). Every other card — and every new
// one — has no key: the substitution is on.
// ---------------------------------------------------------------------------

/** `~`, or CARDNAME as a word — capitals only ("cardname" in prose is
 *  left), and a WORD by Unicode letters, digits and the underscore on both
 *  sides (not JS's ASCII `\b`: "éCARDNAME" is no token here, as Postgres's
 *  `\m…\M` in migration 0142 reads it). */
export const SELF_NAME_TOKEN = /~|(?<![\p{L}\p{N}_])CARDNAME(?![\p{L}\p{N}_])/gu;

/** Whether a text holds a self-name token. */
export function hasSelfNameToken(text: string | null | undefined): boolean {
  if (!text) return false;
  SELF_NAME_TOKEN.lastIndex = 0;
  const found = SELF_NAME_TOKEN.test(text);
  SELF_NAME_TOKEN.lastIndex = 0;
  return found;
}

/** `text` with every token as `name`; the very same string when it has
 *  none — or when there is no name to draw (`null`: a face with no name
 *  keeps its `~` as typed). null / undefined texts as they are. */
export function withSelfName<T extends string | null | undefined>(text: T, name: string | null): T {
  if (!text || name === null || !hasSelfNameToken(text)) return text;
  return text.replace(SELF_NAME_TOKEN, () => name) as T;
}

/** Whether the card substitutes at all: every card but one migration 0142
 *  flagged (`frame_style.selfName: "literal"`). */
export function selfNameOn(frameStyle: { selfName?: string } | null | undefined): boolean {
  return frameStyle?.selfName !== "literal";
}

/** The name `~` stands for on a face: the nickname where its frame prints
 *  it, else the face's own name — null for a face with no name (a draft,
 *  a back face left unnamed): its `~` stays as typed, never "Untitled". */
export function selfNameOf(
  face: { title?: string | null; nickname?: string | null },
  layout: { nickname?: NicknameSlot } | null,
): string | null {
  const nickname = layout?.nickname ? cardNickname(face.nickname) : null;
  return nickname ?? (face.title?.trim() || null);
}

function faceContentWith(content: FaceContent | null | undefined, name: string | null): FaceContent | null | undefined {
  if (!content || name === null) return content;
  let changed = false;
  const sub = <T extends string | null | undefined>(text: T): T => {
    const out = withSelfName(text, name);
    if (out !== text) changed = true;
    return out;
  };
  const next: FaceContent = { ...content };
  if (content.loyalty) next.loyalty = { abilities: content.loyalty.abilities.map((row) => ({ ...row, text: sub(row.text) })) };
  if (content.saga) next.saga = { ...content.saga, intro: sub(content.saga.intro), chapters: content.saga.chapters.map((row) => ({ ...row, text: sub(row.text) })) };
  if (content.station) next.station = { ...content.station, intro: sub(content.station.intro), tiers: content.station.tiers.map((row) => ({ ...row, text: sub(row.text) })) };
  return changed ? next : content;
}

/** A second face's / back's rules text as drawn: its OWN name (never the
 *  front's nickname), as typed when it has none or the card is flagged. */
export function backRulesTextWithSelfName(
  back: { title?: string | null; rules_text?: string | null },
  frameStyle: { selfName?: string } | null | undefined,
): string | null | undefined {
  if (!selfNameOn(frameStyle)) return back.rules_text;
  return withSelfName(back.rules_text, back.title?.trim() || null);
}

/**
 * The card both renderers draw, its self-name tokens drawn as names: the
 * front's rules text and structured rows as the front's printed name, a
 * second face's / back's rules text as ITS own name (a back never prints
 * the front's nickname). The very same object when there is nothing to
 * substitute — every card without a token, every flagged card.
 */
export function withSelfNames<T extends CardPreviewData>(card: T, layout: { nickname?: NicknameSlot } | null): T {
  if (!selfNameOn(card.frameStyle)) return card;
  const name = selfNameOf(card, layout);
  const rulesText = withSelfName(card.rulesText, name);
  const faceContent = faceContentWith(card.faceContent, name);
  const back = card.backFace;
  const backRules = back ? backRulesTextWithSelfName(back, card.frameStyle) : undefined;
  if (rulesText === card.rulesText && faceContent === card.faceContent && (!back || backRules === back.rules_text)) return card;
  return {
    ...card,
    rulesText,
    faceContent,
    ...(back && backRules !== back.rules_text ? { backFace: { ...back, rules_text: backRules } } : {}),
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * An imported FLAVOUR-NAME printing's Oracle text with the card's own name
 * written as `~` (TODO 6.2, owner Round 80): print sets such a card's rules
 * with its flavour name (MSC #283 "Exile The Five Arrive"), and `~` draws
 * the nickname the title bar prints — so the import reads as the printing.
 * The whole name as a word, and a legendary name's short form before its
 * comma ("K'rrik" of "K'rrik, Son of Yawgmoth"). Only for a printing with a
 * nickname: a plain import keeps Oracle's name, as today.
 */
export function oracleSelfNamesAsTokens(text: string | undefined, name: string | undefined): string | undefined {
  if (!text || !name?.trim()) return text;
  const word = (part: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(part)}(?![\\p{L}\\p{N}_])`, "gu");
  let out = text.replace(word(name.trim()), "~");
  const comma = name.indexOf(", ");
  if (comma > 0) out = out.replace(word(name.slice(0, comma).trim()), "~");
  return out;
}

/** The subtypes print names in "this …" (Bloomburrow-era Oracle wording,
 *  since Foundations 2024: "this Equipment", "this Aura", "this Vehicle",
 *  "this Saga", "this Spacecraft"), checked in this order. */
const SELF_REFERENCE_SUBTYPES = ["Equipment", "Aura", "Vehicle", "Spacecraft", "Saga"] as const;

/**
 * The words a card's rules text uses for itself since Wizards stopped
 * printing the card's name there (2024): "this creature", "this artifact",
 * "this Equipment", "this spell" (an instant or sorcery)… — the rules
 * editor's "this …" insert. Never written by a save: the maker clicks it.
 */
export function selfReferenceFor(cardType: string | null | undefined, subtypes: readonly string[] = []): string {
  const subtype = SELF_REFERENCE_SUBTYPES.find((word) => subtypes.some((s) => s.trim().toLowerCase() === word.toLowerCase()));
  if (subtype) return `this ${subtype}`;
  switch (cardType) {
    case "instant":
    case "sorcery":
      return "this spell";
    case "artifact":
    case "enchantment":
    case "land":
    case "planeswalker":
    case "battle":
    case "creature":
      return `this ${cardType}`;
    case "token":
      return "this token";
    default:
      return "this creature";
  }
}

/** A stored card's rules text as its page shows it, its frame read from
 *  the row (the nickname counts only where the frame prints it). */
export function storedRulesTextWithSelfName(card: {
  title: string;
  nickname?: string | null;
  rules_text: string | null;
  frame_style?: unknown;
}): string | null {
  const template = (card.frame_style as { template?: string } | null | undefined)?.template;
  return rulesTextWithSelfName(card, getFrameProfile(normalizeFrameTemplate(template, { rulesText: card.rules_text })));
}

/** A stored card's rules text as its page shows it (the description, the
 *  structured data): the tokens as the name its title bar prints. */
export function rulesTextWithSelfName(
  card: { title: string; nickname?: string | null; rules_text: string | null; frame_style?: unknown },
  layout: { nickname?: NicknameSlot } | null,
): string | null {
  const frameStyle = (card.frame_style ?? null) as { selfName?: string } | null;
  if (!selfNameOn(frameStyle)) return card.rules_text;
  return withSelfName(card.rules_text, selfNameOf(card, layout));
}
