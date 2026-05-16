# Chunk 08 — Bulk Dashboard Actions

## Goal

Let users multi-select cards on `/dashboard` and apply actions in batch:
- **Change visibility** (private / unlisted / public)
- **Add to a set** (existing or new)
- **Delete**

Today everything is one card at a time, which gets tedious once a user
has more than a dozen cards.

## Scope

In scope:
- Multi-select via click + Cmd/Ctrl-click + Shift-click range select.
- Sticky bulk-action bar at the bottom of the dashboard when ≥1 card is
  selected.
- Three actions: change visibility, add to set, delete.
- Server actions that mutate multiple cards in one transaction.
- "Select all" / "Clear selection" controls in the bar.

Out of scope:
- Drag-select with a rectangular marquee.
- Bulk edit beyond the three actions above (no batch title/cost edits).
- Bulk export to PNG zip.
- Pagination changes — selection clears on page change for simplicity.

## Files to add / modify

- Modify: `app/(app)/dashboard/page.tsx` — selection state lifted to a
  client component wrapper around the grid
- New: `components/creator/dashboard-grid.tsx` — `"use client"` grid
  with selection state
- New: `components/creator/dashboard-bulk-bar.tsx` — sticky action bar
- New: `components/sets/quick-add-to-set-dialog.tsx` — list of user's
  sets with a "+ New set" inline create
- Modify: `lib/cards/actions.ts`
  - `updateCardsVisibilityAction(cardIds: string[], visibility)`
  - `deleteCardsAction(cardIds: string[])`
- Modify: `lib/sets/actions.ts`
  - `addCardsToSetAction(setId: string, cardIds: string[])`
- Each new action does a single-trip ownership check (`owner_id =
  auth.uid()`) + a single update with `.in("id", cardIds)`.

## Implementation approach

- Selection state: `Set<string>` of card ids, lifted to the grid wrapper.
- Click handlers:
  - Plain click → toggle that one
  - Cmd/Ctrl-click → toggle without clearing others
  - Shift-click → range select from last-clicked to current
- The bulk bar renders only when `selection.size > 0`.
- Server actions verify every card id belongs to the caller via a
  pre-flight `select id, owner_id where id in (...)`; if any row's
  owner differs, abort the whole batch.
- After action completes, refresh the route and clear selection.

## Acceptance criteria

- Clicking one card selects it; clicking again deselects.
- Cmd-click toggles individuals without clearing.
- Shift-click selects a range.
- The sticky bar shows "N selected" with the three actions.
- "Make public" updates every selected card to public.
- "Add to set" opens a picker, lets the user create a new set inline.
- "Delete" shows a confirm dialog, then deletes all selected.
- Trying to bulk-action cards you don't own returns an error and no rows
  change.
- Selection clears after a successful action.

## Dependencies

Chunk 01 (Dialog primitive) — the add-to-set and delete-confirm dialogs
benefit from the upgraded primitive but can use the existing pattern in
a pinch.

## Estimated effort

~3 hours.

## Done when

Select five cards on the dashboard, hit "Make public", confirm — all
five flip to public and the gallery shows them on next refresh.
