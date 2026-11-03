// The creator hosted by another surface (TODO DK5.18): the deck page's edit
// drawer mounts the SAME CardCreatorForm — same steps, panels, save actions,
// payloads and leave dialog — and only these few things change:
//
//   - after a save the form hands control back (`onSaved`) where its page
//     would navigate (router.push / replace to the card, the editor, the
//     deck): the host decides what comes next — it stays on the card;
//   - the unsaved-changes guard pushes no Back sentinel and hears no
//     popstate: the host owns Back (its own `?edit=` history entry). It
//     still asks before the host closes or moves on (`bindLeave`), still
//     guards in-app links (the drawer's "Open full page ↗") and a reload;
//   - the creator reads its CONTAINER's width (`data-creator-host` + the
//     `creator-lg` / `creator-xl` variants, app/globals.css) instead of the
//     window's, its sticky parts stick to the host's scroll box, and the
//     focused field's scroll padding is set on that box (`scrollRoot`).
//
// Nothing in the payload builders reads the host: a save through the
// drawer sends what the full page sends (creator-host-payload.test.tsx).

export type CreatorHostSaved = {
  cardId: string;
  slug: string;
  /** The form's mode for this save. */
  mode: "create" | "edit" | "remix";
  /** A deck entry's card (deckRemix) was linked into the entry. */
  linked: boolean;
  /** A new card / remix: the deck the creator's deck box added it to
   *  (null: none, or that deck refused it). Absent on an edit. */
  deckId?: string | null;
};

/** The hosted creator's leave check (see `CreatorHost.bindLeave`). */
export type CreatorLeaveCheck = (proceed: () => void) => boolean;

export type CreatorHost = {
  /** A save succeeded: called where the full page would navigate. */
  onSaved: (saved: CreatorHostSaved) => void;
  /** The form hands the host its leave check (null on unmount): the host
   *  calls it before it closes or moves to another card. With changes it
   *  shows the creator's own leave dialog, runs `proceed` only on "Leave
   *  without saving" or a successful save, and answers true; without
   *  changes it runs `proceed` at once and answers false. */
  bindLeave: (ask: CreatorLeaveCheck | null) => void;
  /** "Cancel" on an edit / remix: close the host (asking first). */
  onCancel: () => void;
  /** The card was deleted from the editor (its Delete): the host closes. */
  onDeleted: () => void;
  /** Whether the host's box is wide enough for the creator's two-column
   *  arrangement (the `creator-lg` container query, measured) — null until
   *  it is measured. */
  wide: boolean | null;
  /** The host's scroll box: where a focused field's scroll padding goes. */
  scrollRoot: HTMLElement | null;
  /** "Save & next" beside Save: saves, then the host moves on. Null: none. */
  saveAndNext?: { label: string; onNext: () => void } | null;
  /** The leave dialog closed and the host is still open ("Keep editing"):
   *  the host puts the focus back inside itself (the element focused before
   *  it asked, else its heading) — never <body>. */
  focusHome?: () => void;
};
