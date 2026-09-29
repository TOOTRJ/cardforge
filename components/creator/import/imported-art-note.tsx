"use client";

import { Info } from "lucide-react";
import { normalizeFrameTemplate } from "@/lib/cards/card-display";
import { artReachesCardEdge, getFrameProfile } from "@/lib/cards/template-layout";

// ---------------------------------------------------------------------------
// The Art step's note on imported Scryfall art (TODO 1.18, UI half). Scryfall
// only serves a printing's art as its `art_crop`, which stops at the printed
// frame: the classic window for most printings (626×457, also on borderless
// ones), a taller crop that still holds pieces of the printed bars for
// full-art and textless ones. So the note says so while the card still
// shows that art:
//   • on a frame whose art reaches the card edge (Borderless), the crop is
//     stretched — upload the full illustration;
//   • a full-art or textless printing's crop includes parts of the printed
//     frame (warn only: the owner chose no auto-trim, 2026-09-26).
// Session-only: the creator remembers what it imported (ImportedArtOrigin)
// and the note goes away once the art changes. The Art panel's "Use art from
// a real card" (1.15) reuses it.
// ---------------------------------------------------------------------------

/** What the creator remembers about art it imported from Scryfall. */
export type ImportedArtOrigin = {
  /** The art_url the import wrote; the note shows while it is unchanged. */
  artUrl: string;
  borderless: boolean;
  fullArt: boolean;
  textless: boolean;
};

export function importedArtNoteText(input: {
  origin: ImportedArtOrigin | null | undefined;
  artUrl: string | null | undefined;
  template: string | null | undefined;
}): string | null {
  const { origin, artUrl, template } = input;
  if (!origin || !artUrl || artUrl !== origin.artUrl) return null;
  const edge = artReachesCardEdge(getFrameProfile(normalizeFrameTemplate(template)));
  const framePieces = origin.fullArt || origin.textless;
  if (edge && framePieces) {
    return "Scryfall only has this art cropped to the printed frame, and it includes parts of that frame — upload the full illustration for a sharp borderless card.";
  }
  if (edge) {
    return "Scryfall only has this art cropped to the classic window — upload the full illustration for a sharp borderless card.";
  }
  if (framePieces) {
    return `Scryfall's art for this ${origin.textless ? "textless" : "full-art"} printing includes parts of the printed frame — check its edges, or upload the full illustration.`;
  }
  return null;
}

export function ImportedArtNote(props: {
  origin: ImportedArtOrigin | null | undefined;
  artUrl: string | null | undefined;
  template: string | null | undefined;
}) {
  const text = importedArtNoteText(props);
  if (!text) return null;
  return (
    <p
      role="note"
      data-testid="imported-art-note"
      className="inline-flex items-start gap-2 rounded-md border border-gold/40 bg-gold/5 p-3 text-xs leading-5 text-muted"
    >
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-strong" aria-hidden />
      <span>{text}</span>
    </p>
  );
}
