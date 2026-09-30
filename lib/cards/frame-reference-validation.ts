import type { ScryfallCard } from "@/lib/scryfall/client";
import {
  frameColorsFromScryfall,
  frameMatchFromScryfall,
  kindFromScryfall,
  parseTypeLine,
} from "@/lib/scryfall/import-mapper";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  KIND_DEFS,
  borrowedTypeWord,
  isSingleBasicLand,
  templateIsBasicOnly,
  templateSupportsKind,
  typeLineHasWord,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { eraForTemplate } from "@/lib/creator/frame-picker";
import { eraGroupFrameLabel } from "@/lib/creator/frame-resolve";
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
// The frame signature registry (TODO 1.4, lib/scryfall/frame-signatures.ts)
// knows which frame each printing IS. A printing whose signature resolves to
// this very template is accepted even when PipGlyph's frame can't dress its
// kind yet — a Snow ARTIFACT on the snow frame — because the compare view
// draws it as printed (a Theros god, an Enchantment CREATURE, needed this
// too until a creature could borrow Nyx, owner decision A3); a layout kind
// (a saga on the scroll frame) stays refused, since the frame can't draw
// its layout. A printing
// whose signature resolves to ANOTHER template gets a warning.
//
// Pure (no Supabase, no fetch) so the rules are unit-tested directly.
// ---------------------------------------------------------------------------

export type ReferenceValidation = { errors: string[]; warnings: string[] };

/** "a creature", "an emblem", "an artifact". */
const withArticle = (word: string) => `${/^[aeiou]/i.test(word) ? "an" : "a"} ${word}`;

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

/** The kind the compare view will render this printing as — the importer's
 *  kind, which reads a transforming Saga (`layout: "transform"`) from its
 *  front face's Saga subtype (TODO 1.3). */
export function referenceKindFor(card: ScryfallCard): CardKind | undefined {
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

/** The word a borrowed frame dresses (TODO 1.7, owner decision A3) as the
 *  printing's front face says it: an Artifact Creature, an artifact token,
 *  an Enchantment Creature. */
function referenceSays(card: ScryfallCard, word: "Artifact" | "Enchantment"): boolean {
  const { supertype, card_type } = parseTypeLine(
    card.card_faces?.[0]?.type_line ?? card.type_line,
  );
  return typeLineHasWord({ cardType: card_type, supertype }, word);
}

export function validateReferenceForCombo(
  card: ScryfallCard,
  template: FrameTemplate,
  colorKey: string,
): ReferenceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  // Showcase frames name their set ("Zendikar Rising — Hedron"), as the
  // admin checklist and the compare page title do.
  const label = FRAME_TEMPLATE_LABELS[template] ? eraGroupFrameLabel(template) : template;

  const signature = frameMatchFromScryfall(card);
  if (signature.template !== template) {
    const resolved = FRAME_TEMPLATE_LABELS[signature.template]
      ? eraGroupFrameLabel(signature.template)
      : signature.template;
    warnings.push(
      `This printing is the ${signature.exactLabel}; the frame signature registry resolves it to the ${resolved} frame, not ${label}.`,
    );
  }

  const cardColor = pickFrameColorKey(frameColorsFromScryfall(card));
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
    if (signature.template === template && !KIND_DEFS[kind].layoutTemplates) {
      warnings.push(
        `${card.name} is ${withArticle(KIND_DEFS[kind].label.toLowerCase())}, which the ${label} frame doesn't dress in the creator yet — accepted because this printing is that frame (${signature.exactLabel}).`,
      );
    } else {
      errors.push(
        `${card.name} is ${withArticle(KIND_DEFS[kind].label.toLowerCase())}; the ${label} frame doesn't dress that kind.`,
      );
    }
  } else if (templateIsBasicOnly(template) && !referenceIsSingleBasicLand(card)) {
    errors.push(
      `${card.name} isn't a basic land; the ${label} frame dresses basic lands only.`,
    );
  } else {
    // A creature may borrow the artifact frame (TODO 1.7) or the Nyx
    // showcase (owner decision A3), but only an Artifact / Enchantment
    // Creature is a reference for it — Llanowar Elves on m15artifact/g would
    // verify the frame against a card that never prints on it.
    const word = borrowedTypeWord(kind, template);
    if (word && !referenceSays(card, word)) {
      errors.push(
        `${card.name} isn't an ${word} ${KIND_DEFS[kind].label}; the ${label} frame dresses a ${KIND_DEFS[kind].label.toLowerCase()} only when it is an ${word.toLowerCase()}.`,
      );
    }
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
