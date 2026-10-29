import { UUID_PATTERN } from "@/lib/ids";
import { SLUG_PATTERN } from "@/lib/validation/card";

// ---------------------------------------------------------------------------
// An unlisted deck is LINK-ONLY (TODO DK0.11, migration 0151): the database
// admits it to a read only when the request NAMES it — its slug or its id in
// the `x-pipglyph-deck` header (0151's requested_deck_link()) — so no list
// holds it, and its entries, likes and feedback follow it (their policies
// read the deck). Public decks and the owner's own read without it.
//
// Every read or write that reaches an unlisted deck as a VISITOR names it
// here: the deck page (lib/decks/queries.ts: the deck by its slug, its rows
// by its id), its share image, the like and the deck feedback. A new one does
// the same, or a visitor's read of an unlisted deck comes back empty. A
// public deck sent the header reads as it always did; a private deck is
// never admitted by it. Pure, client-safe.
// ---------------------------------------------------------------------------

/** The request header 0151's decks policy reads (lower case: PostgREST hands
 *  the database its headers' names lower-cased). */
export const DECK_LINK_HEADER = "x-pipglyph-deck";

type HeaderSettable<Q> = { setHeader(name: string, value: string): Q };

/** The query, naming the deck it reads by its link: a slug or an id. A
 *  value that is neither (a mangled URL) names nothing — the query goes as
 *  it was, and an unlisted deck stays out of it. */
export function viaDeckLink<Q extends HeaderSettable<Q>>(query: Q, link: string): Q {
  // An id as Postgres prints it (the policy compares `id::text`).
  if (UUID_PATTERN.test(link)) return query.setHeader(DECK_LINK_HEADER, link.toLowerCase());
  if (link.length <= 80 && SLUG_PATTERN.test(link)) return query.setHeader(DECK_LINK_HEADER, link);
  return query;
}
