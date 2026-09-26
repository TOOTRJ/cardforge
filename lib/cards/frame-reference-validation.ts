import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  kindFromScryfall,
  parseColorIdentity,
  parseTypeLine,
} from "@/lib/scryfall/import-mapper";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  KIND_DEFS,
  isSingleBasicLand,
  templateIsBasicOnly,
  templateSupportsKind,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { FRAME_TEMPLATE_LABELS, type FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Sanity checks for a printing pinned as a (template, colour) reference in
// the frame-compare tool. The compare view renders the printing's OWN colour
// and kind, while the verify checkbox publishes the row's colour — so a blue
// card pinned on m15/w would be scored on the blue frame and published as
// white, and a plain creature pinned on saga/* would render no chapters.
// Colour and kind mismatches are refused; an era mismatch (a 2003-frame
// printing on an M15 template) is a warning, since some references are the
// closest print that exists.
//
// Pure (no Supabase, no fetch) so the rules are unit-tested directly.
// ---------------------------------------------------------------------------

export type ReferenceValidation = { errors: string[]; warnings: string[] };

const COLOR_WORD: Record<string, string> = {
  w: "white",
  u: "blue",
  b: "black",
  r: "red",
  g: "green",
  c: "colorless",
  m: "multicolor",
};

const ERA_FRAME: Partial<Record<string, string>> = {
  classic: "1993",
  retro: "1997",
  modern: "2003",
  m15: "2015",
  showcase: "2015",
};

/** The kind the compare view will render this printing as. Transforming
 *  Sagas are `layout: "transform"` on Scryfall, so the mapper's layout
 *  check misses them — the front face's type line is the reliable signal. */
export function referenceKindFor(card: ScryfallCard): CardKind | undefined {
  const typeLine = card.card_faces?.[0]?.type_line ?? card.type_line ?? "";
  if (/\bSaga\b/.test(typeLine)) return "saga";
  return kindFromScryfall(card);
}

/** True when the printing's front face is one basic land — the only thing a
 *  basic-only frame (the full-art basic land) can be verified against. */
function referenceIsSingleBasicLand(card: ScryfallCard): boolean {
  const front = card.card_faces?.[0];
  const { supertype, card_type, subtypes_text } = parseTypeLine(
    front?.type_line ?? card.type_line,
  );
  return isSingleBasicLand({
    cardType: card_type,
    supertype,
    subtypes: subtypes_text ? subtypes_text.split(", ") : [],
    title: front?.name ?? card.name,
    rulesText: front?.oracle_text ?? card.oracle_text,
  });
}

export function validateReferenceForCombo(
  card: ScryfallCard,
  template: FrameTemplate,
  colorKey: string,
): ReferenceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = FRAME_TEMPLATE_LABELS[template] ?? template;

  const cardColor = pickFrameColorKey(parseColorIdentity(card));
  if (cardColor !== colorKey) {
    errors.push(
      `${card.name} is a ${COLOR_WORD[cardColor] ?? cardColor} card; this row verifies the ${COLOR_WORD[colorKey] ?? colorKey} ${label} frame.`,
    );
  }

  const kind = referenceKindFor(card);
  if (!kind) {
    warnings.push(
      `Couldn't tell what kind of card ${card.name} is — the render may not match the frame.`,
    );
  } else if (!templateSupportsKind(template, kind)) {
    errors.push(
      `${card.name} is a ${KIND_DEFS[kind].label.toLowerCase()}; the ${label} frame doesn't dress that kind.`,
    );
  } else if (templateIsBasicOnly(template) && !referenceIsSingleBasicLand(card)) {
    errors.push(
      `${card.name} isn't a basic land; the ${label} frame dresses basic lands only.`,
    );
  }

  const expected = ERA_FRAME[eraForTemplate(template)];
  const cardFrame = card.frame ?? null;
  if (cardFrame && expected && cardFrame !== expected) {
    warnings.push(
      `This printing uses the ${cardFrame} frame; the ${template} template emulates the ${expected} era.`,
    );
  }

  return { errors, warnings };
}
