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
  dfcFrontDressesKind,
  isSingleBasicLand,
  templateIsBasicOnly,
  templateSupportsKind,
  typeLineHasWord,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { bodyFor, colorlessFaceAllowed, dfcBodyOf, dfcIconFamilyFromEffects, isDfcBackBody, templateHasBackFace } from "@/lib/cards/dfc";
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

/** A face's type, as the colourless gate reads it (lib/cards/dfc.ts
 *  colorlessFaceAllowed → isArtifactFrameType). */
function faceTypeOf(typeLine: string | null | undefined): { cardType: string | undefined; supertype: string | null } {
  const { supertype, card_type } = parseTypeLine(typeLine);
  return { cardType: card_type, supertype: supertype ?? null };
}
const frontFaceType = (card: ScryfallCard) => faceTypeOf(card.card_faces?.[0]?.type_line ?? card.type_line);

/** A printing's BACK face's frame colour key (its printed colour: the
 *  indicator, else its colours), as pickFrameColorKey reads a face. */
function backFaceColorKey(card: ScryfallCard): string {
  const back = card.card_faces?.[1];
  const letters = [...(back?.color_indicator ?? back?.colors ?? [])].map((c) => c.toUpperCase());
  const identity = letters.map((code) => SCRYFALL_LETTER_TO_IDENTITY[code]).filter((v): v is NonNullable<typeof v> => Boolean(v));
  return pickFrameColorKey(identity.length > 1 ? ["multicolor"] : identity.length === 0 ? ["colorless"] : identity);
}

const SCRYFALL_LETTER_TO_IDENTITY: Record<string, "white" | "blue" | "black" | "red" | "green"> = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
};

/**
 * A back body's reference (TODO 5.1a): the BACK face of a 2015-frame
 * transform printing whose family and back type derive this very body
 * (lib/cards/dfc.ts bodyFor), in the row's colour — the `c` row against an
 * ARTIFACT back only (design D2). The front must resolve to a transform
 * front body (its signature's `onceVerified`).
 */
function validateBackReference(card: ScryfallCard, template: FrameTemplate, colorKey: string, face: 0 | 1): ReferenceValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const label = FRAME_TEMPLATE_LABELS[template] ?? template;
  if (face !== 1) {
    errors.push(`The ${label} frame is a back-face body: its reference is a printing's BACK face (face 1).`);
    return { errors, warnings };
  }
  const back = card.card_faces?.[1];
  const signature = frameMatchFromScryfall(card);
  const front = signature.onceVerified ?? signature.template;
  if ((card.layout ?? "") !== "transform" || !back || !templateHasBackFace(front) || dfcBodyOf(front)?.layout !== dfcBodyOf(template)?.layout) {
    errors.push(`${card.name} isn't a transform printing whose front PipGlyph dresses (${signature.exactLabel}); the ${label} frame is a transform back.`);
    return { errors, warnings };
  }
  const { card_type } = parseTypeLine(back.type_line);
  const wears = bodyFor("transform", "back", card_type, dfcIconFamilyFromEffects(card.frame_effects));
  if (wears !== template) {
    errors.push(
      `${back.name}'s back wears the ${wears ? (FRAME_TEMPLATE_LABELS[wears] ?? wears) : "(no)"} body (its icon family${card_type === "land" ? ", a land back" : ""}), not ${label}.`,
    );
  }
  const cardColor = backFaceColorKey(card);
  if (cardColor !== colorKey) {
    errors.push(`${back.name} is a ${COLOR_WORD[cardColor] ?? cardColor} back; this row verifies the ${COLOR_WORD[colorKey] ?? colorKey} ${label} frame.`);
  } else if (colorKey === "c" && !colorlessFaceAllowed(template, faceTypeOf(back.type_line))) {
    errors.push(`${back.name} isn't an Artifact back; the colourless ${label} row is the artifact master standing in and verifies against an artifact print only.`);
  }
  const expected = ERA_FRAME[eraForTemplate(template)];
  if (card.frame && expected && card.frame !== expected) {
    warnings.push(`This printing uses the ${card.frame} frame; the ${template} template emulates the ${expected} era.`);
  }
  return { errors, warnings };
}

export function validateReferenceForCombo(
  card: ScryfallCard,
  template: FrameTemplate,
  colorKey: string,
  /** Which printed face the reference is (TODO 5.1a / 5.0b): 1 for the
   *  back face — a back body's reference. */
  face: 0 | 1 = 0,
): ReferenceValidation {
  if (isDfcBackBody(template) || face === 1) return validateBackReference(card, template, colorKey, face);
  const errors: string[] = [];
  const warnings: string[] = [];
  // Showcase frames name their set ("Zendikar Rising — Hedron"), as the
  // admin checklist and the compare page title do.
  const label = FRAME_TEMPLATE_LABELS[template] ? eraGroupFrameLabel(template) : template;

  const signature = frameMatchFromScryfall(card);
  // A transform front body (5.1a) is the printing's frame once verified
  // (the registry's `onceVerified`): that is the frame it resolves to here.
  const resolvedTemplate = templateHasBackFace(template) && signature.onceVerified === template ? template : signature.template;
  if (resolvedTemplate !== template) {
    const resolved = FRAME_TEMPLATE_LABELS[signature.template]
      ? eraGroupFrameLabel(signature.template)
      : signature.template;
    // Two frames can share a label across eras ("Token" = m20token and
    // alphatoken, TODO 4.48a): name the template keys then.
    const [resolvedName, rowName] =
      resolved === label
        ? [`${resolved} (${signature.template})`, `${label} (${template})`]
        : [resolved, label];
    warnings.push(
      `This printing is the ${signature.exactLabel}; the frame signature registry resolves it to the ${resolvedName} frame, not ${rowName}.`,
    );
  }

  const cardColor = pickFrameColorKey(frameColorsFromScryfall(card));
  if (cardColor !== colorKey) {
    errors.push(
      `${card.name} is a ${COLOR_WORD[cardColor] ?? cardColor} card; this row verifies the ${COLOR_WORD[colorKey] ?? colorKey} ${label} frame.`,
    );
  } else if (colorKey === "c" && !colorlessFaceAllowed(template, frontFaceType(card))) {
    // The `c` row of a DFC body with the artifact dress is the artifact
    // master standing in (D2); the land pair's `c` is its one master.
    errors.push(`${card.name} isn't an Artifact; the colourless ${label} row is the artifact master standing in and verifies against an artifact print only.`);
  }

  const kind = referenceKindFor(card);
  if (!kind) {
    warnings.push(
      `Couldn't tell what kind of card ${card.name} is — the render may not match the frame.`,
    );
  } else if (!templateSupportsKind(template, kind) && !dfcFrontDressesKind(template, kind)) {
    if (resolvedTemplate === template && !KIND_DEFS[kind].layoutTemplates) {
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
