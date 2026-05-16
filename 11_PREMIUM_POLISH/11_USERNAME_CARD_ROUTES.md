# Chunk 11 — Username-Prefixed Card Routes

## Goal

Switch public card URLs from `/card/[slug]` to
`/card/[username]/[slug]`. Today two users can each have a card with
slug `lightning-bolt`, and the public page resolves to whichever was
most-recently-updated — slug cybersquatting risk + confusing UX (M5
from the audit).

After this chunk, every public card lives at a username-namespaced URL
and the old `/card/[slug]` paths 301 to the canonical URL.

## Scope

In scope:
- New route `/card/[username]/[slug]`.
- A redirect from old `/card/[slug]` to the canonical URL when the card
  is owned by a user with a username.
- Every internal link helper updated.
- Sitemap reflects new URLs.
- OG image route stays untouched (it's keyed by card id).

Out of scope:
- A user setting that lets users alias their username (just one
  canonical username per profile).
- Profile-level slugs (no `/u/[username]` redirect to `/[username]`).
- Set URLs — those stay slug-based for now (separate chunk if needed).
- Username changes that retroactively rewrite URLs (cards keep their
  username at the time of the URL — but the simplest rule is "username
  in URL is current, redirect on mismatch").

## Files to add / modify

- New: `app/(marketing)/card/[username]/[slug]/page.tsx`
- Modify: `app/(marketing)/card/[slug]/page.tsx` — redirect-only stub
  that resolves the card by slug, finds the owner's username, and
  returns a `redirect()` to the canonical URL. Falls through to 404 if
  no username is set or the card is private.
- Modify: `lib/cards/queries.ts`
  - `getCardByOwnerAndSlug(username, slug)` — public detail lookup
  - Existing `getCardBySlugPublic` deprecated (used only for the
    redirect stub)
- Modify: every place that builds `/card/...` URLs:
  - `components/cards/card-preview.tsx` if it renders a link
  - `components/cards/like-button.tsx`
  - `components/cards/remix-button.tsx`
  - `components/gallery/...`
  - Server action revalidations in `lib/cards/actions.ts`
- Modify: `app/sitemap.ts` — emit username-namespaced URLs
- Modify: `lib/cards/actions.ts` — `revalidateCardPaths` uses the new
  format

## Implementation approach

- Add a `getCardLinkPath(card)` helper to `lib/cards/utils.ts` that
  returns the canonical URL. One place to update if the URL format
  changes again.
- The old `/card/[slug]/page.tsx` becomes a thin redirector:
  1. Lookup slug across all users
  2. If exactly one match has a username and is public/unlisted →
     `redirect(`/card/${username}/${slug}`)`
  3. Else → `notFound()`
- The new `/card/[username]/[slug]/page.tsx` does the canonical render.
- Sitemap iterates public cards and builds the new URL via the helper.

## Acceptance criteria

- Visiting `/card/<username>/<slug>` shows the card.
- Visiting `/card/<slug>` redirects to the canonical URL (301).
- All "View card" links in the app go to the new URL.
- Sitemap.xml emits the new URLs.
- OG image route still works (it's by id).
- A card whose owner has no username falls back to a 404 instead of
  resolving to an ambiguous owner.

## Dependencies

None directly, but recommend doing this BEFORE chunks that build new
link surface (chunk 06 command palette, chunk 08 bulk actions) to avoid
needing to update those new sites again.

## Estimated effort

~4 hours.

## Done when

Click any "View card" link in the app — URL is the new format. Hit the
old URL in a fresh tab — 301 to the canonical URL. Two users with the
same slug each resolve to their own card.
