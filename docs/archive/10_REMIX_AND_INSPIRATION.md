# Phase 10 — Remix & Inspiration (Scryfall integration)

## Goal

Let users seed the card creator with a real Magic: The Gathering card pulled
from the Scryfall API, then remix it inside CardForge.

## Important note on CLAUDE.md guardrails

The original CLAUDE.md product principles forbid using Wizards of the Coast
card art, frames, and trademarks. The project owner has explicitly
**overridden those guardrails for this phase** so the feature can:

- Display Wizards-owned card images inside the search dialog preview.
- Import Scryfall artwork into the user's `card-art` bucket.
- Seed `rules_text` / `flavor_text` verbatim from Scryfall's `oracle_text`
  and `flavor_text` fields.

End users are still responsible for their own re-use of the imported
material. The disclaimer page (`/disclaimer`) and the in-dialog footer
remind them that imported content remains under its original copyright.

## Scope

Phase 10 ships:

- A Scryfall search modal triggered from the Identity tab of the card
  creator.
- Server-side proxy routes for Scryfall (search / named / import-art).
- A field mapper that converts a Scryfall card object into the form's
  field shape.
- Per-user rate limiting against the new `scryfall_calls` table.
- A "Remixed from X" badge near the save bar so the user remembers the
  source.

Phase 10 does NOT ship:

- A second-source fallback (e.g. magicthegathering.io). Scryfall is
  complete enough on its own; magicthegathering.io was evaluated in PR 0
  and dropped (its `imageUrl` is conditional on `multiverseid`, which
  many cards lack).
- A "save as a remix lineage" link from the imported source. The
  `cards.parent_card_id` column points to other CardForge cards, not
  external Scryfall ids; cross-source lineage is out of scope.
- A bulk import or set-from-Scryfall feature. Card-by-card only.

## Files

### New

- `lib/scryfall/client.ts` — server-only fetcher with the politeness
  throttle, User-Agent header, and Zod-validated response schemas.
- `lib/scryfall/import-mapper.ts` — turns a Scryfall card into a form
  patch (`title`, `cost`, `card_type`, etc.).
- `lib/scryfall/rate-limit.ts` — per-user windowed quota helpers.
- `app/api/scryfall/search/route.ts` — typeahead proxy.
- `app/api/scryfall/named/route.ts` — single-card lookup with field
  mapping pre-applied.
- `app/api/scryfall/import-art/route.ts` — server fetches the image,
  validates the host, uploads to the user's bucket via their session.
- `components/creator/scryfall-import-dialog.tsx` — the typeahead modal.
- `supabase/migrations/0013_scryfall_rate_limit.sql` — `scryfall_calls`
  table + RLS.

### Modified

- `components/creator/card-creator-form.tsx` — renders the dialog
  trigger on the Identity tab, handles the import payload, shows the
  "Remixed from X" badge on the save bar.
- `types/supabase.ts` — adds the `scryfall_calls` table type.

## Rate limits (per user)

| Action | Per minute | Per day |
| --- | --- | --- |
| `search` | 60 | 2 000 |
| `named` | 30 | 500 |
| `import_art` | 10 | 100 |

The limiter fails OPEN on Supabase outages, matching the AI limiter
behavior so a database hiccup never wedges the editor.

## SSRF posture

- The `import-art` route accepts only a `scryfallId` from the client.
- The server re-fetches the card from Scryfall to recover the trusted
  image URL — clients can't supply an arbitrary URL.
- `fetchScryfallImage` host-locks the URL to `cards.scryfall.io` and
  `api.scryfall.com` before issuing a fetch.
- The download must come back with `Content-Type: image/*` and under
  8 MB or it's rejected.

## Field mapping notes

- Scryfall's `type_line` splits on the em-dash into supertype/type and
  subtypes. Multi-word supertypes (e.g. "Legendary Snow") are joined.
- Scryfall's `Instant` and `Sorcery` both collapse to our `spell` card
  type because the CardForge enum is intentionally small.
- Scryfall's `special` and `bonus` rarities collapse to `mythic`.
- Empty color identity becomes `colorless` so the form shows something
  meaningful.
- Double-faced cards (`card_faces` array) read the front face when the
  top-level fields are missing.

## Acceptance criteria

- Searching a name in the dialog returns matching cards within a couple
  hundred ms (subject to Scryfall's response time).
- Picking a card and clicking "Use as starting point" populates the
  form's Identity, Rules, and Art fields without clobbering anything
  the user has already typed in unrelated fields.
- The "Also import artwork" checkbox uploads the art crop into the
  user's `card-art` bucket via their own session, returns the public
  URL, and the form preview shows it immediately.
- The "Remixed from X" badge appears near the save bar and links to the
  Scryfall page for the source card.
- A user exceeding the per-minute search cap gets a 429 with
  `Retry-After`; the dialog surfaces the message via a toast.
