// Pure (non-React) field helpers for the card creator form — free-text
// parsing, cost→color derivation, and persisted-card→form-values mapping.
// Extracted from components/creator/card-creator-form.tsx; nothing here may
// read component state.

import { tokenize } from "@/components/cards/mana-cost-glyphs";
import {
  hasTokenTypeWord,
  normalizeCardFinish,
  normalizeFrameTemplate,
  showsPowerToughness,
  supertypeHasWord,
  withSupertypeWord,
} from "@/lib/cards/card-display";
import {
  DEFAULT_FRAME_TEMPLATE,
  type ArtPosition,
  type Card,
  type CardBackFace,
  type ColorIdentity,
  type FrameStyle,
  type GameSystem,
} from "@/types/card";
import {
  EMPTY_BACK_FACE,
  EMPTY_WATERMARK,
  type BackFaceFormValues,
  type FormValues,
  type LoyaltyRowFormValues,
  type SagaChapterFormValues,
  type WatermarkFormValues,
} from "@/lib/creator/form-types";
import {
  loyaltyFromRulesText,
  sagaFromRulesText,
} from "@/lib/cards/face-content";
import { KIND_DEFS, dfcLayoutForKind, kindFromCard, type CardKind } from "@/lib/creator/card-kinds";
import { remixTitleFor } from "@/lib/creator/revise";
import { defaultWatermarkFor } from "@/lib/cards/watermark";
import { DEFAULT_CARD_LANG } from "@/lib/cards/collector-fields";
import {
  NEW_CARD_ANATOMY,
  pairColorIdentity,
  twoColorPairOf,
  storedAnatomyOf,
} from "@/lib/cards/anatomy";

/** Hydrate the structured row editors from a persisted card: structured
 *  face_content when present, else parsed from rules_text — but ONLY for the
 *  kinds that render those rails. (Parsing a creature's rules into loyalty
 *  rows would fabricate junk rows out of ordinary ability lines.) */
function structuredRowsFrom(card: Card): {
  loyalty_abilities: LoyaltyRowFormValues[];
  saga_intro: string;
  saga_chapters: SagaChapterFormValues[];
} {
  const kind = kindFromCard(
    card.card_type,
    (card.frame_style as FrameStyle | null)?.template,
  );
  if (kind === "planeswalker") {
    const rows =
      card.face_content?.loyalty?.abilities ??
      loyaltyFromRulesText(card.rules_text);
    return {
      loyalty_abilities: rows.map((r) => ({ cost: r.cost ?? "", text: r.text })),
      saga_intro: "",
      saga_chapters: [],
    };
  }
  if (kind === "saga") {
    const saga = card.face_content?.saga ?? sagaFromRulesText(card.rules_text);
    return {
      loyalty_abilities: [],
      saga_intro: saga.intro ?? "",
      saga_chapters: saga.chapters.map((ch) => ({
        numerals: [...ch.numerals],
        text: ch.text,
      })),
    };
  }
  return { loyalty_abilities: [], saga_intro: "", saga_chapters: [] };
}

/** A blank second face for a card of `kind` (TODO 3b.8). A frame that
 *  paints one types it like the kind's own card — a split's halves are
 *  instants, an aftermath's sorceries, a flip's creatures (and an
 *  Adventure's spell, as before, until 3b.14 gives it a type choice); the
 *  blank used to be a Creature everywhere. A double-faced kind's back (TODO
 *  5.2) starts as the kind's card type too — a creature. Every other kind
 *  keeps the plain blank. */
export function blankSecondFaceFor(kind: CardKind): BackFaceFormValues {
  const def = KIND_DEFS[kind];
  return def.inlineSecondFace || dfcLayoutForKind(kind)
    ? { ...EMPTY_BACK_FACE, card_type: def.cardType }
    : EMPTY_BACK_FACE;
}

const BACK_FACE_CONTENT_FIELDS = [
  "title",
  "cost",
  "supertype",
  "subtypes_text",
  "rules_text",
  "flavor_text",
  "power",
  "toughness",
  "loyalty",
  "defense",
  "artist_credit",
  "art_url",
] as const;

/** True when the second face holds nothing the user wrote (its type and
 *  art position aside) — safe to re-type for a new kind. */
export function isBlankBackFace(face: BackFaceFormValues): boolean {
  return BACK_FACE_CONTENT_FIELDS.every((field) => !face[field].trim());
}

function backFaceFormValuesFrom(
  source: CardBackFace | null | undefined,
  kind: CardKind,
): BackFaceFormValues {
  if (!source) return blankSecondFaceFor(kind);
  return {
    title: source.title ?? "",
    cost: source.cost ?? "",
    card_type: source.card_type ?? "",
    supertype: source.supertype ?? "",
    printed_types: source.printed_types ?? null,
    subtypes_text: source.subtypes?.join(", ") ?? "",
    rules_text: source.rules_text ?? "",
    flavor_text: source.flavor_text ?? "",
    power: source.power ?? "",
    toughness: source.toughness ?? "",
    loyalty: source.loyalty ?? "",
    defense: source.defense ?? "",
    artist_credit: source.artist_credit ?? "",
    art_url: source.art_url ?? "",
    art_position: source.art_position ?? {
      focalX: 0.5,
      focalY: 0.5,
      scale: 1,
    },
    // The back's own colour (a double-faced card, TODO 5.2); a legacy back
    // names none and draws in the front's.
    color_identity: [...(source.color_identity ?? [])],
  };
}

/**
 * The supertype the form edits for a stored card. A token from before the
 * type picker (TODO 3b.15) with a P/T and no type word was a creature — every
 * token was — so it reads as "Creature", the word migration 0128 writes: its
 * P/T inputs show, the picker's Creature toggle is on, and a remix saves the
 * word. So does a stored token with a P/T that says Artifact or Enchantment
 * but not Creature ("Artifact" → "Artifact Creature", owner 2026-09-29: it
 * keeps its P/T — 0128 writes the same word), unless a Vehicle / Spacecraft
 * subtype already prints its P/T. Every other card's supertype is as stored.
 */
export function formSupertypeOf(
  card: Pick<Card, "card_type" | "supertype" | "power" | "toughness"> & Partial<Pick<Card, "subtypes">>,
): string {
  const supertype = card.supertype ?? "";
  if (card.card_type !== "token" || !(card.power || card.toughness)) return supertype;
  if (supertypeHasWord(supertype, "Creature")) return supertype;
  if (hasTokenTypeWord(supertype) && showsPowerToughness("token", card.subtypes, supertype)) return supertype;
  return withSupertypeWord(supertype, "Creature");
}

/** Viewer facts the defaults depend on (owner decision 2026-09-17): paid
 *  accounts start creatures/spells with no watermark (free: the PipGlyph
 *  Rose) and new cards prefill the account's footer mark. */
export type DefaultValueOptions = {
  paid?: boolean;
  /** profiles.export_watermark_text — the prefill for a new card. */
  footerText?: string | null;
};

export function defaultValuesFor(
  card: Card | null | undefined,
  gameSystems: GameSystem[],
  options: DefaultValueOptions = {},
): FormValues {
  const fallbackGameSystem = gameSystems[0]?.id ?? "";
  const paid = options.paid ?? false;

  if (!card) {
    return {
      title: "",
      slug: "",
      game_system_id: fallbackGameSystem,
      cost: "",
      color_identity: [],
      supertype: "",
      printed_types: null,
      card_type: "creature",
      subtypes_text: "",
      tags_text: "",
      rarity: "common",
      rules_text: "",
      loyalty_abilities: [],
      saga_intro: "",
      saga_chapters: [],
      flavor_text: "",
      // A fresh card is a 1/1 creature until the maker says otherwise — the
      // preview shows a real P/T box instead of an empty corner. Non-P/T
      // types drop these on save (card-creator-form.tsx onSubmit).
      power: "1",
      toughness: "1",
      loyalty: "",
      defense: "",
      artist_credit: "",
      art_url: "",
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      // A NEW card starts with every anatomy switch on (the legendary crown,
      // the two-colour frame — owner rule 2026-09-29): the renderers draw
      // only what the template can, and the save drops the rest
      // (lib/cards/anatomy.ts), so the preview is what the bake draws.
      frame_style: {
        finish: "regular",
        template: DEFAULT_FRAME_TEMPLATE,
        ...NEW_CARD_ANATOMY,
      },
      visibility: "public",
      save_as_draft: false,
      has_back_face: false,
      back_face: EMPTY_BACK_FACE,
      source_scryfall_id: "",
      set_icon_url: "",
      set_icon_code: "",
      // A new card prints only what its maker fills (4.9 decision D2): no
      // set code or number, English.
      set_code: "",
      collector_number: "",
      lang: DEFAULT_CARD_LANG,
      deck_id: "",
      watermark: watermarkFormValuesFromValue(defaultWatermarkFor("creature", paid)),
      footer_text: paid ? (options.footerText ?? "") : "",
    };
  }

  const persistedBackFace =
    (card.back_face as CardBackFace | null | undefined) ?? null;

  // Coerce the persisted frame style, mapping any legacy/retired template
  // (e.g. the old "regular" placeholder) or finish (RETIRED_CARD_FINISHES)
  // onto a current one so the picker and the edit/remix summary show a valid
  // selection and the save passes validation.
  const persistedFrame = (card.frame_style as FrameStyle | null) ?? {};
  const normalizedFrameStyle: FrameStyle = {
    finish: normalizeCardFinish(persistedFrame.finish),
    // A retired template (TODO 4.54) opens on its replacement — with the
    // text box when the card has text. A remix saves that; an edit never
    // sends its template, so updateCardAction stores the replacement itself
    // (retiredFrameStyleRewrite).
    template: normalizeFrameTemplate(persistedFrame.template, card),
    // The anatomy switches exactly as stored: absent stays absent — a
    // stored card keeps its look until its owner switches a piece on.
    ...storedAnatomyOf(persistedFrame),
  };

  return {
    title: card.title,
    slug: card.slug,
    game_system_id: card.game_system_id,
    cost: card.cost ?? "",
    color_identity: card.color_identity,
    supertype: formSupertypeOf(card),
    // The Types field as stored (TODO 3b.16): null on every card saved
    // before it, whose field then shows the line it prints today.
    printed_types: card.printed_types ?? null,
    card_type: card.card_type ?? "",
    subtypes_text: card.subtypes.join(", "),
    tags_text: card.tags?.join(", ") ?? "",
    rarity: card.rarity ?? "",
    rules_text: card.rules_text ?? "",
    ...structuredRowsFrom(card),
    flavor_text: card.flavor_text ?? "",
    power: card.power ?? "",
    toughness: card.toughness ?? "",
    loyalty: card.loyalty ?? "",
    defense: card.defense ?? "",
    artist_credit: card.artist_credit ?? "",
    art_url: card.art_url ?? "",
    art_position: (card.art_position as ArtPosition) ?? {
      focalX: 0.5,
      focalY: 0.5,
      scale: 1,
    },
    frame_style: normalizedFrameStyle,
    visibility: card.visibility,
    // A saved private card IS a draft — the checkbox reflects that so
    // unticking it is how the card gets published.
    save_as_draft: card.visibility === "private",
    has_back_face: persistedBackFace !== null,
    back_face: backFaceFormValuesFrom(
      persistedBackFace,
      kindFromCard(card.card_type, normalizedFrameStyle.template),
    ),
    source_scryfall_id: card.source_scryfall_id ?? "",
    // Denormalized icon columns — the Set icon step edits them directly.
    set_icon_url: card.set_icon_url ?? "",
    set_icon_code: card.set_icon_code ?? "",
    // The collector fields as stored (TODO 4.9a); a row from before 0133
    // hydrates empty and English.
    set_code: card.set_code ?? "",
    collector_number: card.collector_number ?? "",
    lang: card.lang ?? DEFAULT_CARD_LANG,
    // Deck membership isn't stored on the card row — the picker is a
    // create-flow convenience, so edits always start empty.
    deck_id: "",
    watermark: watermarkFormValuesFrom(card),
    // null on a legacy row = the profile default applies at download time,
    // so that is what the field shows; "" = explicitly none.
    footer_text: card.footer_text ?? (paid ? options.footerText ?? "" : ""),
  };
}

/** Form values for a NEW card remixed from `parent`: the parent's content and
 *  structure, retitled "… (remix)", with everything that belongs to the
 *  parent's OWNER left behind — its set membership and set icon, its deck,
 *  its slug. Nothing is inserted until the user saves (owner decision
 *  2026-09-16); the slug then follows the saved title. */
export function remixValuesFrom(
  parent: Card,
  gameSystems: GameSystem[],
  options: DefaultValueOptions = {},
): FormValues {
  const base = defaultValuesFor(parent, gameSystems, options);
  return {
    ...base,
    // A remix is a NEW card: every anatomy switch starts on, except one the
    // parent's owner switched off (owner rule 2026-09-29).
    frame_style: { ...base.frame_style, ...NEW_CARD_ANATOMY, ...storedAnatomyOf(parent.frame_style) },
    title: remixTitleFor(parent.title),
    slug: "",
    visibility: "public",
    save_as_draft: false,
    // The footer mark is the REMIXER's, never the parent owner's.
    footer_text: options.paid ? (options.footerText ?? "") : "",
    set_icon_url: "",
    set_icon_code: "",
    // The parent's set code and number name the parent's printing (its
    // set, like the set icon above): a remix starts with none and keeps
    // only the language its text is written in (TODO 4.9a).
    set_code: "",
    collector_number: "",
    deck_id: "",
  };
}

function watermarkFormValuesFrom(card: Card): WatermarkFormValues {
  return watermarkFormValuesFromValue(card.watermark);
}

export function watermarkFormValuesFromValue(
  wm: Card["watermark"] | null | undefined,
): WatermarkFormValues {
  if (!wm) return EMPTY_WATERMARK;
  return {
    kind: wm.kind,
    key: "key" in wm ? wm.key : "",
    url: wm.kind === "custom" ? wm.url : "",
    size: wm.size ?? "normal",
    opacity: wm.opacity ?? null,
  };
}

export function parseSubtypes(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0)
    .slice(0, 10);
}

// Colors actually present in a mana cost — the printed rule for a card's
// color. Drives the "match mana cost" auto color identity: solid pips, both
// hybrid halves, and phyrexian pips count; generic/X/snow/tap do not.
const COST_COLOR_NAME: Record<string, ColorIdentity> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

/** Collapse a color list to the creator's SINGLE-select model: two or more
 *  real colors become ["multicolor"] (one gold dress) — except, with
 *  `keepPair` (the card's template draws the two-colour frame, TODO 4.6b:
 *  lib/cards/anatomy.ts), exactly two real colors, which stay the card's
 *  colour PAIR in printed order (["white", "blue"]; the "multicolor" token
 *  an AI identity carries is dropped). Stored cards keep the array shape. */
export function normalizeColorSelection(
  colors: readonly ColorIdentity[],
  options: { keepPair?: boolean } = {},
): ColorIdentity[] {
  const real = [...new Set(colors)].filter(
    (c) => c !== "colorless" && c !== "multicolor",
  );
  const pair = options.keepPair ? twoColorPairOf(real) : null;
  if (pair && real.length === 2) return pairColorIdentity(pair);
  if (colors.includes("multicolor") || real.length > 1) return ["multicolor"];
  if (real.length === 1) return real;
  return colors.includes("colorless") ? ["colorless"] : [];
}

export function deriveColorIdentity(cost: string): ColorIdentity[] {
  const found: ColorIdentity[] = [];
  const add = (key: string) => {
    const name = COST_COLOR_NAME[key];
    if (name && !found.includes(name)) found.push(name);
  };
  for (const token of tokenize(cost)) {
    if (token.kind === "solid") add(token.color);
    else if (token.kind === "hybrid") {
      add(token.left);
      add(token.right);
    } else if (token.kind === "phyrexian") add(token.color);
  }
  return found;
}

export function parseTags(text: string): string[] {
  // Mirror cardTagsSchema's normalization so the field preview matches what
  // actually gets saved (lowercase, alphanumeric + spaces/hyphens, collapsed).
  return text
    .split(/[,\n]/)
    .map((piece) =>
      piece
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((piece) => piece.length > 0)
    .slice(0, 12);
}

/** Append a tag to a comma-separated tags field unless it's already there. */
export function mergeTag(tagsText: string | undefined, tag: string): string {
  const existing = (tagsText ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (existing.includes(tag.toLowerCase())) return tagsText ?? "";
  return existing.length > 0 ? `${tagsText}, ${tag}` : tag;
}

/** Remove a tag from a comma-separated tags field (case-insensitive). */
export function removeTag(tagsText: string | undefined, tag: string): string {
  return (tagsText ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && t.toLowerCase() !== tag.toLowerCase())
    .join(", ");
}
