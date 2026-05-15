# Phase 5 — Rendering & PNG Export

## Goal

Add high-quality card image export.

## Scope

Build:

- reusable rendering layer
- PNG export endpoint/server action
- download button
- card export storage
- export history record if simple
- share image preview metadata

## Rendering Strategy

The live preview and export should use the same card data model.

Recommended approach:

1. Keep React preview for live editing.
2. Create a server-side export pipeline.
3. Use SVG/HTML-to-image or Sharp-based composition.
4. Store generated exports in Supabase Storage.

## Export Requirements

- default PNG export
- HD PNG export if feasible
- export file named from card title/slug
- generated file stored in `card-exports`
- download action available on card page and editor

## Database Optional Table

### card_exports

- id uuid primary key
- card_id uuid references cards(id)
- owner_id uuid references auth.users(id)
- file_url text
- width int
- height int
- format text
- created_at timestamptz

## Acceptance Criteria

- User can export owned cards.
- Public cards can show rendered preview.
- Export matches live preview closely.
- Export works after deployment-compatible build.
- No official assets used.
- Build passes.

## Claude Instruction

Implement Phase 5 only. Do not add billing or premium gates. Do not build marketplace.
