import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { CardBackFace, FrameTemplate } from "@/types/card";
import { drawsPartColor } from "@/lib/cards/part-color";

// ---------------------------------------------------------------------------
// Reshape a Scryfall import patch (the mapper's output) into CardPreviewData
// with the frame template pinned — the frame-compare tool's "our render"
// input. Pure and client-safe so it is unit-testable without Scryfall; the
// server-only wrapper in lib/scryfall/reference-preview.ts does the lookup.
//
// The SECOND FACE matters: adventure, flip, split and aftermath frames draw
// their second half from the back-face content, so a reference without it
// compares an empty page against the real printing.
// ---------------------------------------------------------------------------

type BackFacePatch = NonNullable<ScryfallImportPatch["back_face"]>;

/** The creator's comma/newline subtype field → list (mirrors parseSubtypes). */
export function splitSubtypes(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/[,\n]/)
    .map((piece) => piece.trim())
    .filter(Boolean);
}

/** The back-face jsonb shape the renderers consume, from the import patch. */
export function backFaceFromPatch(
  back: BackFacePatch | null | undefined,
): CardBackFace | null {
  if (!back) return null;
  return {
    title: back.title ?? "",
    cost: back.cost,
    card_type: back.card_type,
    supertype: back.supertype,
    ...(back.printed_types !== undefined ? { printed_types: back.printed_types } : {}),
    subtypes: splitSubtypes(back.subtypes_text),
    rules_text: back.rules_text,
    flavor_text: back.flavor_text,
    power: back.power,
    toughness: back.toughness,
    loyalty: back.loyalty,
    defense: back.defense,
    artist_credit: back.artist_credit,
    // Frame geometry is the comparison target; the scan supplies the art.
    art_url: undefined,
    // A second part in its own colour (TODO 4.26: a split or aftermath
    // half, a Prepare spell) — what the import stores.
    ...(back.color_identity && !back.frame_style ? { color_identity: [...back.color_identity] } : {}),
  };
}

export function previewFromImportPatch(
  patch: ScryfallImportPatch,
  fallbackTitle: string,
  template: FrameTemplate,
): CardPreviewData {
  return {
    title: patch.title ?? fallbackTitle,
    ...(patch.nickname !== undefined ? { nickname: patch.nickname } : {}),
    cost: patch.cost ?? null,
    cardType: patch.card_type ?? null,
    supertype: patch.supertype ?? null,
    ...(patch.printed_types !== undefined ? { printedTypes: patch.printed_types } : {}),
    subtypes: splitSubtypes(patch.subtypes_text),
    rarity: patch.rarity ?? null,
    colorIdentity: patch.color_identity ?? [],
    rulesText: patch.rules_text ?? null,
    flavorText: patch.flavor_text ?? null,
    power: patch.power ?? null,
    toughness: patch.toughness ?? null,
    loyalty: patch.loyalty ?? null,
    defense: patch.defense ?? null,
    artistCredit: patch.artist_credit ?? null,
    // We don't rehost WotC art for a dev utility; the scan shows it.
    artUrl: null,
    // The printing's holofoil stamp (TODO 4.9c): the comparison card draws
    // the frame's own stamp where the reference printing carries one
    // (security_stamp → printed_stamp "oval" / "triangle"), so the notch is
    // judged against the scan's; the other switches stay the compare
    // tool's own toggles (the "Legendary" crown).
    frameStyle: {
      template,
      ...(patch.printed_stamp && patch.printed_stamp !== "none" ? { stamp: patch.printed_stamp } : {}),
      // …and its border (TODO 4.30): a white-bordered reference is compared
      // with the white border drawn, where the frame draws one.
      ...(patch.printed_border === "white" ? { border: "white" as const } : {}),
      // …and each part in its own colour (TODO 4.26), as every two-part
      // printing prints it, where the frame draws it.
      ...(drawsPartColor(template) ? { partColor: true } : {}),
      // …the first part's own colour where the card's is both halves' (M2).
      ...(drawsPartColor(template) && patch.printed_first_part_color ? { firstPartColor: [...patch.printed_first_part_color] } : {}),
    },
    backFace: backFaceFromPatch(patch.back_face),
  };
}
