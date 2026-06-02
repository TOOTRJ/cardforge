// Pure storage-path helpers. Kept out of the "use server" modules (which may
// only export async server actions) so both the bake module and the card
// actions can import them.

/**
 * Deterministic path for a card's baked render in the card-renders bucket:
 * `{ownerId}/{cardId}.png`. Keyed on the card id, so it's unique per card and
 * never shared (unlike art_url, which remixes copy) — which is why a card's
 * render is always safe to delete.
 */
export function cardRenderPath(ownerId: string, cardId: string): string {
  return `${ownerId}/${cardId}.png`;
}
