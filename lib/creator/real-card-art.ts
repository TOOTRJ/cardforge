import type { UseFormSetValue } from "react-hook-form";
import type { ImportedArtOrigin } from "@/components/creator/import/imported-art-note";
import type { FormValues } from "@/lib/creator/form-types";
import type { PrintingSummary } from "@/lib/scryfall/printing-views";
import type { ArtPosition } from "@/types/card";

// ---------------------------------------------------------------------------
// "Use art from a real card" (TODO 1.15): a real printing's art crop on the
// card WITHOUT the full Scryfall import, which also overwrites the name,
// text, type, frame and colour. The dialog
// (components/creator/real-card-art-dialog.tsx) downloads the crop through
// POST /api/scryfall/import-art; this module is the one place that says
// which form fields the result may touch — the art, a re-centred position,
// and the artist credit of ONE face — so the tests pin the contract here.
// ---------------------------------------------------------------------------

/** Which of the card's faces receives the art: the front art block, or the
 *  second face's art block (split / aftermath / flip halves). */
export type RealCardArtTarget = "front" | "back";

/** Which image of the Scryfall printing: its front face's art crop, or its
 *  back face's (a transform / modal DFC, `has_back_image`). The route's
 *  `mode` values. */
export type RealCardArtMode = "art" | "art-back";

/** A fresh art crop starts centred and unzoomed — the old framing belonged
 *  to the old image. */
export const CENTERED_ART_POSITION: Readonly<Required<ArtPosition>> = Object.freeze({
  focalX: 0.5,
  focalY: 0.5,
  scale: 1,
});

/** The artist credit field's limit (cardArtistCreditSchema). */
const ARTIST_CREDIT_MAX = 120;

/** What a successful import-art call hands the form. */
export type RealCardArt = {
  /** The crop in the user's card-art bucket (the route's `publicUrl`). */
  publicUrl: string;
  /** The route's `artist`: the requested face's own credit since TODO 1.8
   *  (`scryfallFaceArtist` — Fire // Ice's front art is David Martin, not
   *  the card-level "David Martin & Franz Vohwinkel"), or null when Scryfall
   *  names none. */
  artist: string | null;
};

type ArtFieldWrite =
  | readonly ["art_url" | "back_face.art_url", string]
  | readonly ["art_position" | "back_face.art_position", ArtPosition]
  | readonly ["artist_credit" | "back_face.artist_credit", string];

/**
 * The ONLY writes "Use art from a real card" makes — the target face's
 * art_url, art_position (re-centred) and artist_credit. Never the title,
 * text, type, frame, colour, source_scryfall_id or tags: that is what sets
 * it apart from the full import.
 *
 * A printing Scryfall credits no artist CLEARS the credit: the new art isn't
 * the old artist's work.
 */
export function realCardArtWrites(
  target: RealCardArtTarget,
  art: RealCardArt,
): ArtFieldWrite[] {
  const credit = (art.artist ?? "").trim().slice(0, ARTIST_CREDIT_MAX);
  const position: ArtPosition = { ...CENTERED_ART_POSITION };
  return target === "back"
    ? [
        ["back_face.art_url", art.publicUrl],
        ["back_face.art_position", position],
        ["back_face.artist_credit", credit],
      ]
    : [
        ["art_url", art.publicUrl],
        ["art_position", position],
        ["artist_credit", credit],
      ];
}

/** Apply realCardArtWrites to the creator form (each write dirties its
 *  field, like any user edit). */
export function applyRealCardArt(
  setValue: UseFormSetValue<FormValues>,
  target: RealCardArtTarget,
  art: RealCardArt,
): void {
  for (const [name, value] of realCardArtWrites(target, art)) {
    // The union above pairs every path with its value type; TS can't
    // narrow a tuple union through the generic setValue signature.
    (setValue as (n: string, v: unknown, o: { shouldDirty: boolean }) => void)(name, value, {
      shouldDirty: true,
    });
  }
}

/** The route modes a printing offers: its back art only when its second
 *  face carries its own image (a transform / modal DFC — not a split or
 *  adventure card, whose one image covers both halves). */
export function realCardArtModes(
  printing: Pick<PrintingSummary, "has_back_image">,
): RealCardArtMode[] {
  return printing.has_back_image ? ["art", "art-back"] : ["art"];
}

/** The mode the dialog starts on for a printing: the back art when the art
 *  is for the card's back face and the printing has one, else the front. */
export function defaultRealCardArtMode(
  target: RealCardArtTarget,
  printing: Pick<PrintingSummary, "has_back_image">,
): RealCardArtMode {
  return target === "back" && printing.has_back_image ? "art-back" : "art";
}

/** "Delver of Secrets // Insectile Aberration" → each face's name, for the
 *  front/back art labels. A one-face name labels the front only. */
export function realCardFaceNames(name: string): { front: string; back: string | null } {
  const [front, back] = name.split(" // ");
  return { front: (front ?? name).trim(), back: back?.trim() || null };
}

/** What the Art step's note (ImportedArtNote, TODO 1.18) remembers about
 *  front art taken from this printing: Scryfall's crop stops at the printed
 *  frame, and a full-art or textless crop holds pieces of it. */
export function realCardArtOrigin(
  printing: Pick<PrintingSummary, "border_color" | "full_art" | "textless">,
  publicUrl: string,
): ImportedArtOrigin {
  return {
    artUrl: publicUrl,
    borderless: printing.border_color === "borderless",
    fullArt: printing.full_art,
    textless: printing.textless,
  };
}
