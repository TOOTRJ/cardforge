"use client";

import { toast } from "sonner";

// ---------------------------------------------------------------------------
// The ONE toast a chooser-less Scryfall import (the deck-remix pre-fill,
// /create?deckCard=) gets when it lands on a substitute frame — naming what
// the printing is and the frame the card got, with PipGlyph's own frame for
// the treatment as an action once it is verified (frames plan 4.32 / 4.39).
// The import dialog asks up front instead (its frame chooser, TODO 1.5).
// ---------------------------------------------------------------------------

export type ImportNotice =
  | string
  | { message: string; action: { label: string; onClick: () => void } };

/** Toast an import's notice, after the caller's own "Pre-filled …" toast so
 *  the notice sits in front (Sonner shows the newest first). */
export function toastImportNotice(notice: ImportNotice | null | void): void {
  if (!notice) return;
  if (typeof notice === "string") {
    toast.info(notice, { duration: 8000 });
    return;
  }
  toast.info(notice.message, { duration: 12000, action: notice.action });
}
