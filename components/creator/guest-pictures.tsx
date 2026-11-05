"use client";

import { createContext, useContext } from "react";
import type { GuestPictureKind } from "@/lib/creator/guest-draft";
import type { GuestSaveGateReason } from "@/components/creator/guest-save-gate";

// ---------------------------------------------------------------------------
// A guest's pictures (TODO HM3): in the signed-out creator a picked card
// art, land icon or watermark is never uploaded — the form provides `keep`,
// which checks the file as the upload would (type, size), holds it and
// answers a `blob:` URL the field and the live preview use. The guest draft
// stores the file (lib/creator/guest-draft.ts) and, after sign-in, the
// creator uploads it through the normal path before the card can save.
// Absent (null) for a signed-in creator: the uploaders upload as always.
// ---------------------------------------------------------------------------

export type GuestPictures = {
  /** The file as a `blob:` URL for the field, or null when it can't be one
   *  (the reason already toasted). */
  keep(file: File, kind: GuestPictureKind): string | null;
};

const GuestPicturesContext = createContext<GuestPictures | null>(null);

export const GuestPicturesProvider = GuestPicturesContext.Provider;

export function useGuestPictures(): GuestPictures | null {
  return useContext(GuestPicturesContext);
}

/** What the uploaders say once a guest's picture is kept. */
export const GUEST_PICTURE_KEPT_MESSAGE = "Picture added — it uploads to your account when you save.";

// ---------------------------------------------------------------------------
// The guest creator's account-only controls (TODO HM3): an import from
// Scryfall, a real card's art, a set icon upload and custom pips belong to an
// account, so in the signed-out creator they OPEN the sign-up dialog (the
// card waits in the browser meanwhile) — never a disabled button whose
// reason a keyboard can't reach. Null outside the guest creator.
// ---------------------------------------------------------------------------

export type GuestGate = (reason: GuestSaveGateReason) => void;

const GuestGateContext = createContext<GuestGate | null>(null);

export const GuestGateProvider = GuestGateContext.Provider;

export function useGuestGate(): GuestGate | null {
  return useContext(GuestGateContext);
}
