# Chunk 13 — Scryfall Source Tracking

## Goal

When a card is imported from Scryfall, persist the source Scryfall id on
the card row. Unlocks:

- A "Also remixed by N others" chip on public card pages.
- Gallery filter "Remixes of <X>" for community lineage discovery.
- Future analytics ("which official cards inspire the most CardForge
  remixes?").

## Scope

In scope:
- New nullable column `cards.source_scryfall_id text` with a btree index.
- Server actions accept + persist the field.
- The Scryfall import dialog passes the id through to the form.
- A "Also remixed by N others" chip on public card detail pages.
- A gallery filter `?source=<scryfall_id>` for finding all remixes.

Out of scope:
- A reverse lookup that talks back to Scryfall (we only store the id).
- A "promote this card to canonical" admin tool.
- Per-source stats pages.
- Versioning when the upstream Scryfall card changes (the id is immutable).

## Files to add / modify

- Migration: `0015_scryfall_source.sql`
  - `alter table cards add column source_scryfall_id text`
  - `create index cards_source_scryfall_id_idx on cards (source_scryfall_id) where source_scryfall_id is not null`
- Modify: `types/supabase.ts`, `types/card.ts`
- Modify: `lib/validation/card.ts`
  - Optional `source_scryfall_id: z.string().uuid().optional()`
- Modify: `lib/cards/actions.ts` — accept + persist in create + update
- Modify: `components/creator/scryfall-import-dialog.tsx` — the
  `ScryfallImportPayload` already carries `source.scryfallId`; pass it
  through to the form
- Modify: `components/creator/card-creator-form.tsx`
  - Store the source id in a hidden field
  - On submit, include in the payload
- New: `lib/cards/source-queries.ts`
  - `countRemixesBySource(scryfallId): Promise<number>`
  - `listPublicRemixesBySource(scryfallId): Promise<CardSummary[]>`
- Modify: `app/(marketing)/card/[username]/[slug]/page.tsx` (or
  current path if chunk 11 hasn't landed)
  - Render an "Also remixed N times" chip when count ≥ 1
- Modify: `app/(marketing)/gallery/page.tsx`
  - Accept `?source=<id>` query param and filter

## Implementation approach

- The dialog already exposes `source.scryfallId` in
  `ScryfallImportPayload`. Just plumb it through:
  - Add `source_scryfall_id: string` to `FormValues`
  - Default to empty string
  - On import, `setValue("source_scryfall_id", payload.source.scryfallId, { shouldDirty: true })`
  - On submit, include if non-empty
- Public card page renders a Badge with a link to the filtered gallery.
- Gallery server query: add an optional `sourceScryfallId` parameter to
  `listPublicCards` that maps to `.eq("source_scryfall_id", id)`.

## Acceptance criteria

- A new card imported from Scryfall has its `source_scryfall_id` set.
- An existing user can re-import the same Scryfall card and the new
  card also gets the id.
- The public card page shows "Also remixed by N others" when ≥1 other
  card shares the source id.
- Clicking the chip navigates to `/gallery?source=<id>` and the
  gallery shows only remixes of that card.
- Cards not imported from Scryfall have `source_scryfall_id = null`.
- The field is editable in the form? **No** — it's metadata, not user
  content. Surface as read-only.

## Dependencies

None.

## Estimated effort

~2 hours.

## Done when

Import "Lightning Bolt" twice (as two different users or two different
cards), publish both, visit either card's public page — it shows
"Also remixed by 1 other"; clicking the chip lands on a filtered
gallery showing both.
