import "server-only";

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { viaDeckLink } from "@/lib/decks/deck-link";
import { SLUG_PATTERN } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// A renamed deck's old links (TODO DK5.14, migration 0155). A rename gives
// the deck a new slug (updateDeckAction: the slug follows the title) and the
// database keeps the one it left in deck_slug_history; /deck/<old slug> then
// answers a 308 to the deck's CURRENT slug — one hop, however many renames
// came between (every row names the deck, never the next slug).
//
// Precedence: the LIVE slug wins. The deck page reads the deck by its slug
// first and asks here only when no deck has it — and 0155 reserves an old
// slug for its deck while it redirects (another deck's insert or rename is
// refused with 23505, which the deck actions retry with a suffix), so a link
// shared to a renamed deck never lands on a stranger's.
//
// Reads go as the VIEWER (0155's policy follows 0151's link rule): no row
// is listable — every non-owner read must NAME the old slug in the header
// (the link the visitor holds), which this read always does. A public or
// unlisted deck's old slug then redirects for everyone (the deck is read by
// its id, 0151's other link), a private deck's for its owner alone. Anything else, a database 0155 has not reached included, is null:
// the page's 404, as before.
// ---------------------------------------------------------------------------

type HistoryClient = Awaited<ReturnType<typeof createClient>>;

/** The current slug of the deck that gave `slug` up, when the caller may
 *  open it — else null. Never the slug asked for (a live slug is the page's
 *  own; a redirect to itself would loop). */
export async function renamedDeckSlug(supabase: HistoryClient, slug: string): Promise<string | null> {
  if (!slug || slug.length > 80 || !SLUG_PATTERN.test(slug)) return null;
  try {
    const { data: history, error } = await viaDeckLink(
      supabase.from("deck_slug_history").select("deck_id").eq("old_slug", slug),
      slug,
    ).maybeSingle();
    if (error || !history) return null;
    const { data: deck } = await viaDeckLink(
      supabase.from("decks").select("slug").eq("id", history.deck_id),
      history.deck_id,
    ).maybeSingle();
    if (!deck || deck.slug === slug) return null;
    return deck.slug;
  } catch {
    return null;
  }
}

/** renamedDeckSlug for this request, read once (the page and its metadata
 *  both ask). */
export const findRenamedDeckSlug = cache(async (slug: string): Promise<string | null> => {
  if (!isSupabaseConfigured()) return null;
  return renamedDeckSlug(await createClient(), slug);
});
