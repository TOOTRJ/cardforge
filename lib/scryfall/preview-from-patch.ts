import type { ScryfallImportPatch } from "@/lib/scryfall/import-mapper";
import type { CardPreviewData } from "@/components/cards/card-preview";
import type { CardBackFace, FrameTemplate } from "@/types/card";

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
  };
}

export function previewFromImportPatch(
  patch: ScryfallImportPatch,
  fallbackTitle: string,
  template: FrameTemplate,
): CardPreviewData {
  return {
    title: patch.title ?? fallbackTitle,
    cost: patch.cost ?? null,
    cardType: patch.card_type ?? null,
    supertype: patch.supertype ?? null,
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
    frameStyle: { template },
    backFace: backFaceFromPatch(patch.back_face),
  };
}
