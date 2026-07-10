// Pure (non-React) field helpers for the card creator form — free-text
// parsing, cost→color derivation, and persisted-card→form-values mapping.
// Extracted from components/creator/card-creator-form.tsx; nothing here may
// read component state.

import { tokenize } from "@/components/cards/mana-cost-glyphs";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import {
  DEFAULT_FRAME_TEMPLATE,
  type ArtPosition,
  type Card,
  type CardBackFace,
  type CardTemplate,
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
import { kindFromCard } from "@/lib/creator/card-kinds";

/** Hydrate the structured row editors from a persisted card: structured
 *  face_content when present, else parsed from rules_text — but ONLY for the
 *  kinds that render those rails. (Parsing a creature's rules into loyalty
 *  rows would fabricate junk rows out of ordinary ability lines.) */
export function structuredRowsFrom(card: Card): {
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

export function backFaceFormValuesFrom(
  source: CardBackFace | null | undefined,
): BackFaceFormValues {
  if (!source) return EMPTY_BACK_FACE;
  return {
    title: source.title ?? "",
    cost: source.cost ?? "",
    card_type: source.card_type ?? "",
    supertype: source.supertype ?? "",
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
  };
}

export function defaultValuesFor(
  card: Card | null | undefined,
  gameSystems: GameSystem[],
  templates: CardTemplate[],
): FormValues {
  const fallbackGameSystem = gameSystems[0]?.id ?? "";
  const fallbackTemplate = templates[0]?.id ?? "";

  if (!card) {
    return {
      title: "",
      slug: "",
      game_system_id: fallbackGameSystem,
      template_id: fallbackTemplate,
      cost: "",
      color_identity: [],
      supertype: "",
      card_type: "creature",
      subtypes_text: "",
      tags_text: "",
      rarity: "common",
      rules_text: "",
      loyalty_abilities: [],
      saga_intro: "",
      saga_chapters: [],
      flavor_text: "",
      power: "",
      toughness: "",
      loyalty: "",
      defense: "",
      artist_credit: "",
      art_url: "",
      art_position: { focalX: 0.5, focalY: 0.5, scale: 1 },
      frame_style: {
        finish: "regular",
        template: DEFAULT_FRAME_TEMPLATE,
      },
      visibility: "public",
      has_back_face: false,
      back_face: EMPTY_BACK_FACE,
      back_card_id: "",
      source_scryfall_id: "",
      primary_set_id: "",
      deck_id: "",
      watermark: EMPTY_WATERMARK,
    };
  }

  const persistedBackFace =
    (card.back_face as CardBackFace | null | undefined) ?? null;

  // Coerce the persisted frame style, mapping any legacy/retired template
  // (e.g. the old "regular" placeholder) onto a current one so the picker
  // shows a valid selection and the save passes validation.
  const persistedFrame = (card.frame_style as FrameStyle | null) ?? {};
  const normalizedFrameStyle: FrameStyle = {
    finish: persistedFrame.finish ?? "regular",
    template: normalizeFrameTemplate(persistedFrame.template),
  };

  return {
    title: card.title,
    slug: card.slug,
    game_system_id: card.game_system_id,
    template_id: card.template_id ?? fallbackTemplate,
    cost: card.cost ?? "",
    color_identity: card.color_identity,
    supertype: card.supertype ?? "",
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
    has_back_face: persistedBackFace !== null,
    back_face: backFaceFormValuesFrom(persistedBackFace),
    back_card_id: card.back_card_id ?? "",
    source_scryfall_id: card.source_scryfall_id ?? "",
    primary_set_id: card.primary_set_id ?? "",
    // Deck membership isn't stored on the card row — the picker is a
    // create-flow convenience, so edits always start empty.
    deck_id: "",
    watermark: watermarkFormValuesFrom(card),
  };
}

function watermarkFormValuesFrom(card: Card): WatermarkFormValues {
  const wm = card.watermark;
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
 *  real colors become ["multicolor"] (the frame system has one multicolor
 *  dress, not per-pair blends). Stored cards keep the array shape. */
export function normalizeColorSelection(
  colors: readonly ColorIdentity[],
): ColorIdentity[] {
  const real = [...new Set(colors)].filter(
    (c) => c !== "colorless" && c !== "multicolor",
  );
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
