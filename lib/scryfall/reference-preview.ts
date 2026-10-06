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
import { frameAnatomyOf } from "@/lib/cards/anatomy";
import { scryfallFaceIndex, type CardFace } from "@/lib/cards/card-face";
import {
  DEFAULT_DFC_ICON,
  bodyFor,
  dfcBodyOf,
  dfcIconFamilyFromEffects,
  frontBodyFor,
  isDfcBackBody,
} from "@/lib/cards/dfc";
import { backPreviewData, frontPreviewData } from "@/lib/cards/faces";
import type { ScryfallCard } from "@/lib/scryfall/client";
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
// front. The front path is what it always was — except on a MODAL front
// body under test (TODO 5.1c, withComparedBack): there the back carries its
// own printed colour and the body its type derives, as the import stores it,
// because the front now draws a piece FROM them (the modal strip's colour).
//
// A DOUBLE-FACED body under test (TODO 5.0d) is the printing as it PRINTS,
// on either face:
//   • its icon FAMILY rides on the card (withPrintedFamily) — the sun / moon,
//     moon / Emrakul, compass / land or fan its `frame_effects` name, read
//     with the import mapper's own function (lib/cards/dfc.ts
//     dfcIconFamilyFromEffects; never a second table). The preview never
//     carried one, so both renderers read the absent key as `arrows`: MID's
//     backs drew a ▼ in the left well beside a scan that prints the moon;
//   • the FRONT's `preview` is the face as every renderer is handed it —
//     lib/cards/faces.ts frontPreviewData, the cross-face block included
//     (the back's P/T for the grey tab, the family, the modal strip's word,
//     line and key), as the back's has been since 5.0b (backPreviewData).
//     The live preview derives that block by itself, the bake derives
//     NOTHING (only a stored card's row is mapped, lib/cards/bake-core.ts):
//     the scorer bakes this preview as given (lib/frames/score-combo.ts),
//     so without the block on it a front was scored with no reverse P/T, no
//     icon rider and no strip beside a page that showed them. ONE preview
//     feeds the page, the sign-off's side-by-side and the score.
// A template that is no double-faced body gets neither: its payload is byte
// for byte what it was (tests/unit/scryfall/reference-preview-dfc-family
// .test.ts, snapshots taken before 5.0d).
// ---------------------------------------------------------------------------

export type FrameComparePayload = {
  /** The face as a renderer is HANDED it — nothing left to derive: the live
   *  preview (the page, the sign-off's side-by-side) and the scorer's bake
   *  draw this one object, a double-faced face's `dfc` block included. */
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

/**
 * A MODAL front body under test (TODO 5.1c): its back as the import would
 * store it — in its own printed colour (referenceBackColorIdentity: a modal
 * land's is its mana's) and on the back body its type derives (bodyFor) —
 * so what the front draws FROM its back is the stored card's. The modal
 * strip takes the colour of the frame the OTHER face wears
 * (lib/cards/faces.ts stripKeyOf), and a back with no colour of its own
 * follows the front's: without this every two-colour reference viewed from
 * its front — the five pathways, STX's cards, KHM #114 — drew its own
 * colour's tab beside a scan that prints the back's. A back the import
 * keeps off the bodies (`legacyBack`: a walker face, 5.13) takes the colour
 * alone and stays a legacy back — its colour is never drawn (backBodyOf
 * honours a body only), it only keys the front's strip. A TRANSFORM front
 * draws nothing from its back's colour or body (the tab's digits and the
 * strip's texts read content alone), so it — like every other template and
 * a printing with no second face — keeps the card as it is.
 */
function withComparedBack(front: CardPreviewData, card: ScryfallCard, legacyBack: boolean): CardPreviewData {
  const body = dfcBodyOf(front.frameStyle?.template);
  if (!front.backFace || body?.role !== "front" || body.layout !== "modal") return front;
  const backBody = legacyBack ? null : bodyFor(body.layout, "back", front.backFace.card_type ?? null);
  return {
    ...front,
    backFace: {
      ...front.backFace,
      ...(backBody ? { frame_style: { template: backBody } } : {}),
      color_identity: referenceBackColorIdentity(card),
    },
  };
}

/**
 * The transform icon FAMILY the printing wears, on the card (TODO 5.0d) —
 * `frame_style.dfcIcon`, from the printing's `frame_effects` through the
 * mapper's ONE derivation (dfcIconFamilyFromEffects: what dfcImportOf names
 * `printed_dfc_icon` from). Read from the PRINTING, not from the patch's
 * `printed_dfc_icon`: the mapper names that only where the import lands on
 * the bodies, and a reference is pinned on a body whether or not it does
 * (EMN's fronts over their colourless Eldrazi backs; NEO's creature backs
 * under their Saga fronts — the pin check accepts both).
 * Where the save keeps the key (frameAnatomyOf(...).dfcIcon — a transform
 * FRONT body, the card's own template; a back body reads it through the
 * card, lib/cards/faces.ts dfcIconOf), and only for a family that is not
 * the default: `arrows` IS the absent key, so a plain ▲ / ▼ reference, a
 * modal one and every other template keep their style as it was.
 */
function withPrintedFamily(stored: CardPreviewData, card: ScryfallCard): CardPreviewData {
  if (!frameAnatomyOf(stored.frameStyle?.template).dfcIcon) return stored;
  const family = dfcIconFamilyFromEffects(card.frame_effects);
  if (family === DEFAULT_DFC_ICON) return stored;
  return { ...stored, frameStyle: { ...stored.frameStyle, dfcIcon: family } };
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

  /** The printing as a card on `cardTemplate` — its own (front) template —
   *  in the colours and the icon family it prints. */
  const storedOn = (cardTemplate: FrameTemplate): CardPreviewData =>
    withPrintedFamily(
      {
        ...previewFromImportPatch(comparePatch, card.name, cardTemplate),
        // Two colours stay two here, so a split frame draws the scan's split.
        colorIdentity: referenceColorIdentity(card),
      },
      card,
    );

  if (face === "front") {
    return {
      // The front as every renderer is handed it (TODO 5.0d): with its
      // cross-face block on a double-faced front body, the card itself on
      // any other template (frontPreviewData returns its input there).
      preview: frontPreviewData(withComparedBack(storedOn(template), card, walkerBack)),
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
  const front = storedOn(frontTemplate);
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
