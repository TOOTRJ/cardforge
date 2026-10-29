// ---------------------------------------------------------------------------
// The deck builder's beta banner (TODO DK10.2): "New deck builder: tell us
// what's missing", on the deck page and My Decks, for 30 days. Dependency-
// free and client-safe.
//
// OWNER: set DECK_BETA_BANNER_ENDS_AT to 30 days after the NEW deck page
// ships (TODO DK5). Until then it defaults to 30 days after this PR's merge
// day (2026-10-29 → 2026-11-28). The banner disappears for everyone at this
// instant; moving the date brings it back for viewers who dismissed it,
// because a dismissal stores the end date it dismissed.
// ---------------------------------------------------------------------------

export const DECK_BETA_BANNER_ENDS_AT = "2026-11-28T00:00:00Z";

/** Per-viewer dismissal, in this browser only (a convenience, never state
 *  that must persist). Holds the end date the viewer dismissed. */
export const DECK_BETA_BANNER_STORAGE_KEY = "pipglyph:deck-beta-banner:dismissed";

export function deckBetaBannerLive(
  now: number = Date.now(),
  endsAt: string = DECK_BETA_BANNER_ENDS_AT,
): boolean {
  const end = Date.parse(endsAt);
  return Number.isFinite(end) && now < end;
}
