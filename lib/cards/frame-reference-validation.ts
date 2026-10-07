import { hasBackFaceImage, type ScryfallCard } from "@/lib/scryfall/client";
import {
  droppedFaceOf,
  frameColorsFromScryfall,
  frameMatchFromScryfall,
  kindFromScryfall,
  parseTypeLine,
  referenceBackColorIdentity,
} from "@/lib/scryfall/import-mapper";
import { pickFrameColorKey } from "@/components/cards/frame-layer";
import {
  KIND_DEFS,
  borrowedTypeWord,
  dfcFrontDressesKind,
  dfcKindFor,
  dfcLayoutForKind,
  isSingleBasicLand,
  kindFromCard,
  templateIsBasicOnly,
  templateSupportsKind,
  typeLineHasWord,
  type CardKind,
} from "@/lib/creator/card-kinds";
import { colorlessFaceAllowed, dfcBodyOf, dfcIconFamilyFromEffects, isDeclaredDfcBody, isDfcBackBody, templateHasBackFace, transformBackBodyFor } from "@/lib/cards/dfc";
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
// A BACK body (TODO 5.0b; FrameProfile.dfc.role "back") is compared with
// the printing's BACK face, so its pin is checked on that face: the printing
// must have a second face with its own scan that the import keeps (not a
// double-faced token's or a Role card's), and that face's colour must be
// the row's (referenceBackColorIdentity). No kind check: a back body
// dresses no kind of its own (the save's rule is the back's type against
// bodyFor, 5.2), and no signature warning: the registry names the FRONT
// body a printing lands on, the back body is implied by it. Two rules of
// the transform bodies (TODO 5.1a) on top: the `c` row of a body that
// dresses `c` as the artifact master (artifactMasterKeys, design D2) takes
// an ARTIFACT back only (colorlessFaceAllowed — the land pair's `c` is any
// land back), and a transform printing pinned on a DECLARED transform back
// body must be one that body dresses: its icon family and its back's type
// name the body (transformBackBodyFor — a 2016–22 sun/moon printing wears
// the left-well body, a land back the land back), since the compare, the
// score and the tick would otherwise judge the body against another body's
// print. The land back has one master under every key and is verified on
// its colourless row (as the emblem): any LAND back is its reference,
// whatever colour its mana ability names.
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

  if (isDfcBackBody(template)) {
    const dropped = droppedFaceOf(card);
    if (!hasBackFaceImage(card)) {
      errors.push(
        `${card.name} has no second face with its own scan; the ${label} frame is a back face, compared with the printing's back.`,
      );
    } else if (dropped) {
      // The import keeps only the front of a double-faced token or a Role
      // card (TODO 1.23) — and of a printing with a planeswalker face (5.4;
      // the walker bodies wait, 5.13): there is no stored back for the row
      // to compare.
      const what =
        dropped === "role"
          ? "a Role card"
          : dropped === "walker-face"
            ? "a double-faced planeswalker"
            : "a double-faced token";
      errors.push(
        `${card.name} is ${what}, whose second face PipGlyph doesn't import; the ${label} frame needs a transform or modal printing.`,
      );
    } else {
      const back = card.card_faces?.[1];
      const backColor = pickFrameColorKey(referenceBackColorIdentity(card));
      if (dfcBodyOf(template)?.land && dfcBodyOf(template)?.layout === "transform") {
        // The transform land back (5.1a) has ONE master under every key
        // and is verified on its colourless row, as the emblem is: any land
        // back is its reference, whatever colour its mana ability names.
        // The modal land back (5.1b) is one land tint per colour, so its
        // rows are judged by colour below like any back.
        if (parseTypeLine(back?.type_line).card_type !== "land") {
          errors.push(`${back?.name ?? card.name} isn't a land; the ${label} frame is the land back (one master under every key, verified on its colourless row).`);
        }
      } else if (dfcBodyOf(template)?.land && parseTypeLine(back?.type_line).card_type !== "land") {
        errors.push(`${back?.name ?? card.name} isn't a land; the ${label} frame is the land back.`);
      } else if (backColor !== colorKey) {
        errors.push(
          `${card.name}'s back face is ${COLOR_WORD[backColor] ?? backColor}; this row verifies the ${COLOR_WORD[colorKey] ?? colorKey} ${label} frame.`,
        );
      } else if (colorKey === "c" && !colorlessFaceAllowed(template, faceTypeOf(back?.type_line))) {
        // The body dresses `c` as the artifact master standing in (D2):
        // its colourless row verifies against an artifact print only.
        errors.push(
          `${back?.name ?? card.name} isn't an Artifact back; the colourless ${label} row is the artifact master standing in and verifies against an artifact print only.`,
        );
      }
      // A declared transform back body takes the printings it dresses: the
      // icon family (the ▼ at the right, or the 2016–22 left well) and the
      // back's type (a land back wears the land back) name the body.
      if (dfcBodyOf(template)?.layout === "transform" && isDeclaredDfcBody(template) && (card.layout ?? "") === "transform") {
        const wears = transformBackBodyFor(dfcIconFamilyFromEffects(card.frame_effects), parseTypeLine(back?.type_line).card_type);
        if (wears && wears !== template) {
          errors.push(
            `${card.name}'s back wears the ${FRAME_TEMPLATE_LABELS[wears] ?? wears} body (its icon family and the back's type), not ${label}.`,
          );
        }
      }
    }
    const expectedEra = ERA_FRAME[eraForTemplate(template)];
    const printedFrame = card.frame ?? null;
    if (printedFrame && expectedEra && printedFrame !== expectedEra) {
      warnings.push(
        `This printing uses the ${printedFrame} frame; the ${template} template emulates the ${expectedEra} era.`,
      );
    }
    return { errors, warnings };
  }

  const signature = frameMatchFromScryfall(card);
  // A transform front body (5.1a) is the printing's frame once verified
  // (the registry's `onceVerified`): that is the frame it resolves to here.
  const resolvedTemplate = templateHasBackFace(template) && signature.onceVerified === template ? template : signature.template;
  if (resolvedTemplate !== template) {
    const resolved = FRAME_TEMPLATE_LABELS[signature.template]
      ? eraGroupFrameLabel(signature.template)
      : signature.template;
    // Two frames can share a label (TODO 4.48a: "Token" was m20token and
    // the since-retired Alpha token): name the template keys then.
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

  // A transform / modal printing is the double-faced kind (TODO 5.4): on a
  // double-faced body of that very kind it fits; on any other template it
  // is judged as its front face's standard kind, as before 5.4 (a transform
  // land front pinned on the plain land frame is a land there).
  const importedKind = referenceKindFor(card);
  const kind =
    importedKind && dfcLayoutForKind(importedKind) && !dfcBodyOf(template)
      ? kindFromCard(parseTypeLine(card.card_faces?.[0]?.type_line ?? card.type_line).card_type, undefined)
      : importedKind;
  if (!kind) {
    warnings.push(
      `Couldn't tell what kind of card ${card.name} is — the render may not match the frame.`,
    );
  } else if (
    !templateSupportsKind(template, kind) &&
    !dfcFrontDressesKind(template, kind) &&
    !(dfcLayoutForKind(kind) && dfcKindFor(template) === kind)
  ) {
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
