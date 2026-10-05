import "server-only";

import { getCardById, hasBackFaceImage, pickPrintImageUrl } from "@/lib/scryfall/client";
import {
  droppedFaceNotice,
  mapScryfallBackFacePatch,
  mapScryfallToFormPatch,
  referenceBackColorIdentity,
  referenceColorIdentity,
  type ScryfallImportPatch,
} from "@/lib/scryfall/import-mapper";
import { previewFromImportPatch } from "@/lib/scryfall/preview-from-patch";
import { scryfallFaceIndex, type CardFace } from "@/lib/cards/card-face";
import { frontBodyFor, isDfcBackBody } from "@/lib/cards/dfc";
import { backPreviewData } from "@/lib/cards/faces";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { FrameTemplate } from "@/types/card";

// ---------------------------------------------------------------------------
// Builds the frame-compare tool's "our render" input from a real Scryfall
// printing at request time — no hand-transcription per reference. The
// import mapper already knows how to translate Scryfall fields (multi-face
// cards, type-line parsing, rarity mapping); previewFromImportPatch reshapes
// its form patch into CardPreviewData (front AND back face) and pins the
// frame template under test.
//
// The same form patch seeds the admin's walk through the stepper (TODO 2.2,
// lib/creator/frame-walkthrough.ts), so the creator is prefilled with
// exactly the content the compare view renders and scores.
//
// Per FACE (TODO 5.0b): `face: "back"` renders the printing's SECOND face
// against its own scan (`card_faces[1]`, Scryfall's `/back/` path — never
// the front's). The face is drawn exactly as the card page and the bake will
// draw it, through lib/cards/faces.ts backPreviewData on the card the import
// would store: on a BACK body under test, the back wears that body in its
// own printed colour under the body's paired front (frontBodyFor); on any
// other template it is a legacy back — the back's content on the front's
// frame and colour, as the preview draws the imported double-faced cards
// today. A printing with no second face, or one whose second face has no
// scan of its own (split, flip, adventure: one picture), throws
// FrameCompareFaceError, which the callers name instead of showing the
// front. The front path is untouched: `face` omitted = what it always was.
// ---------------------------------------------------------------------------

export type FrameComparePayload = {
  preview: CardPreviewData;
  /** 745×1040 PNG of the real printing's face, for the overlay. */
  scanUrl: string | null;
  cardName: string;
  /** The import mapper's form patch the preview was built from (the second
   *  face included) — the walk-through's seed. */
  patch: ScryfallImportPatch;
  /** The printing's Scryfall page, for the creator's "Based on" chip. */
  scryfallUri: string | null;
  /** The face rendered and scanned (TODO 5.0b); `front` for every
   *  single-faced path. */
  face: CardFace;
  /** The rendered face's own name on a printing with TWO pictures ("Brutal
   *  Cathar" / "Moonrage Brute"); null when the picture is the whole
   *  printing — a single face, or a split, flip or adventure, whose one
   *  scan shows both halves. */
  faceName: string | null;
  /** The printing has a second face with its own scan that the import
   *  keeps (not a double-faced token's or a Role card's, which it drops):
   *  the compare view offers the other face. */
  hasBackScan: boolean;
};

/** Asked for a face the printing can't show: no second face, or a second
 *  face with no scan of its own. The message names the printing. */
export class FrameCompareFaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrameCompareFaceError";
  }
}

export async function buildFrameComparePayload(
  scryfallId: string,
  template: FrameTemplate,
  face: CardFace = "front",
): Promise<FrameComparePayload | null> {
  const card = await getCardById(scryfallId);
  if (!card) return null;

  const patch = mapScryfallToFormPatch(card, { artPreviewUrl: null });
  // A back the tools can show: the second face's own scan, AND a face the
  // import keeps — a double-faced token's or a Role card's back is dropped
  // (TODO 1.23; two-sided tokens are 5.5), so there is no stored back to
  // draw and the view offers none. A PLANESWALKER back (5.4 / 5.13) is
  // dropped by a new import too, but the cards imported before it still
  // carry one as a legacy back (Chrollo's Tibalt), so the view draws it as
  // that — on the import's patch it stays dropped (the walk seeds the front
  // alone), and a back-body pin refuses it (lib/cards/frame-reference-
  // validation.ts).
  const walkerBack = patch.dropped_face === "walker-face";
  const comparePatch: ScryfallImportPatch = walkerBack
    ? { ...patch, back_face: mapScryfallBackFacePatch(card) }
    : patch;
  const hasBackScan = hasBackFaceImage(card) && (!patch.dropped_face || walkerBack);
  const faces = card.card_faces ?? [];
  const faceName = hasBackScan ? (faces[scryfallFaceIndex(face)]?.name ?? null) : null;

  if (face === "front") {
    return {
      preview: {
        ...previewFromImportPatch(comparePatch, card.name, template),
        // Two colours stay two here, so a split frame draws the scan's split.
        colorIdentity: referenceColorIdentity(card),
      },
      scanUrl: pickPrintImageUrl(card),
      cardName: card.name,
      patch,
      scryfallUri: card.scryfall_uri ?? null,
      face,
      faceName,
      hasBackScan,
    };
  }

  if (patch.dropped_face && !walkerBack) {
    throw new FrameCompareFaceError(
      droppedFaceNotice(patch, card.name) ?? `${card.name} has no second face to compare.`,
    );
  }
  if (!comparePatch.back_face) {
    throw new FrameCompareFaceError(`${card.name} has no second face to compare.`);
  }
  if (!hasBackScan) {
    throw new FrameCompareFaceError(
      `${card.name} is one picture: its second face has no scan of its own.`,
    );
  }

  // The card as the import would store it, then its back as every renderer
  // will draw it (lib/cards/faces.ts). A back body under test needs a DFC
  // front over it (backBodyOf honours a body only there); any other
  // template draws the back as a legacy back on that very template.
  const backBody = isDfcBackBody(template);
  const frontTemplate = backBody ? (frontBodyFor(template, patch.card_type) ?? template) : template;
  const front: CardPreviewData = {
    ...previewFromImportPatch(comparePatch, card.name, frontTemplate),
    colorIdentity: referenceColorIdentity(card),
  };
  const stored: CardPreviewData =
    backBody && front.backFace
      ? {
          ...front,
          backFace: {
            ...front.backFace,
            frame_style: { template },
            color_identity: referenceBackColorIdentity(card),
          },
        }
      : front;
  const preview = backPreviewData(stored);
  if (!preview) {
    throw new FrameCompareFaceError(`${card.name} has no second face to compare.`);
  }

  return {
    preview,
    scanUrl: pickPrintImageUrl(card, scryfallFaceIndex(face)),
    cardName: card.name,
    patch,
    scryfallUri: card.scryfall_uri ?? null,
    face,
    faceName,
    hasBackScan,
  };
}
