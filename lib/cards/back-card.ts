// ---------------------------------------------------------------------------
// A card's v2 back face (back_card_id, 0041) is another of its OWNER's cards.
// The app has always checked that on save (lib/cards/actions.ts), but until
// migration 0127's cards_guard_back_card a PATCH through PostgREST could name
// any readable card — another user's public or unlisted one — and the card
// page's flip drew THEIR art under this card's name. The database refuses
// that now; a row written before it is skipped here (drawn with no back).
// Production's public + unlisted cards had none on 2026-09-29.
// ---------------------------------------------------------------------------

/** `back` when it belongs to `card`'s owner, else null. */
export function sameOwnerBackCard<T extends { owner_id: string }>(
  card: { owner_id: string },
  back: T | null | undefined,
): T | null {
  return back && back.owner_id === card.owner_id ? back : null;
}
