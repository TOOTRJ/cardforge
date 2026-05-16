# Chunk 10 — Double-Faced Card (DFC) Support

## Goal

A CardForge card can optionally have a **back face** with its own
title / cost / type / rules / art. The preview shows a flip button to
toggle faces. Scryfall imports of DFCs auto-populate both faces.

This closes the "DFC art import uses front face only" functional gap
from the audit and unlocks a real-world card pattern users expect.

## Scope

In scope:
- Database column for the back face (jsonb with the same shape as the
  card's editable fields).
- Form UI to opt-in: a "Add back face" toggle in the editor that reveals
  a Back Face tab.
- Preview with flip button + animated 3D card flip.
- DFC Scryfall imports populate both faces.
- Export: render both faces (two PNGs returned from the export action).

Out of scope:
- More than 2 faces (no triple-face support).
- Modal DFC (where the back face is a different card type).
- Meld cards (combine two cards into one).
- Per-face visibility (whole card has one visibility).

## Files to add / modify

- Migration: `0014_card_back_face.sql` — add `back_face jsonb` to `cards`
  with no check constraints (validation happens at the app layer).
- Modify: `types/card.ts`, `types/supabase.ts` — add `back_face`
- Modify: `lib/validation/card.ts` — `backFaceSchema` (same shape as a
  trimmed card)
- Modify: `lib/cards/actions.ts` — accept + persist `back_face`
- Modify: `components/cards/card-preview.tsx` — flip button, back face
  render, CSS 3D flip animation
- Modify: `components/creator/card-creator-form.tsx` — Back Face tab
  conditional on `has_back_face` state
- Modify: `lib/scryfall/import-mapper.ts` — return `back_face` patch
  from `card.card_faces[1]`
- Modify: `app/api/scryfall/import-art/route.ts` — `mode: "art-back"`
  option
- Modify: `lib/render/card-image.tsx` — render both faces

## Implementation approach

- Store the back face as a single `jsonb` column instead of a join table
  to keep queries simple (one row = one card, both faces).
- Validation: `backFaceSchema` is a strict Zod object with the same
  fields the form exposes. Server actions parse it before persisting.
- The preview uses a CSS `transform-style: preserve-3d` + `rotateY()`
  flip; `staticInEditor` keeps it disabled inside the form.
- Form: a checkbox "This card has a back face" gates a new Tabs trigger.
  Tab content is a stripped-down version of the front form (no slug,
  no visibility, no template — those are card-level).
- Scryfall: if `card.card_faces?.length === 2`, the mapper builds two
  patches and the dialog imports both.

## Acceptance criteria

- A user can toggle "has back face" on, fill in the back face, and save.
- The preview shows a flip button bottom-right; clicking flips smoothly.
- A DFC Scryfall import (try "Delver of Secrets") auto-populates both
  faces and imports both art crops.
- Refresh persists both faces.
- Export downloads two PNGs (front + back) or a single combined image
  — design call to make during implementation.
- Existing single-face cards continue to work unchanged.

## Dependencies

None — independent feature.

## Estimated effort

~4 hours.

## Done when

Search Scryfall for "Delver of Secrets", import → both faces are
populated, the editor preview flips on click, the saved card persists
with both faces.
