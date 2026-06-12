# Chunk 09 — Set Drag-Reorder

## Goal

Let users drag cards within a set to reorder them. The `card_set_items`
table already has a `position` column — Phase 7 set it but never wired
a reorder UI. Once this lands, set pages feel like a deck builder.

## Scope

In scope:
- Drag-handle UI on each card in the set editor.
- Drag-and-drop reorder with optimistic UI.
- Server action that persists new positions in one transaction.
- Keyboard-accessible reordering (Space pick up, ↑/↓ move, Space drop).
- Touch support (long-press to drag).

Out of scope:
- Multi-select drag (drag one at a time).
- Cross-set drag (out of one set, into another) — that's a bigger
  feature.
- Drag from the dashboard into a set — chunk 08 handles bulk add.
- Sort presets (alphabetical, by rarity).

## Files to add / modify

- Package: add `@dnd-kit/core` and `@dnd-kit/sortable` to deps
- New: `components/sets/set-card-sortable.tsx` — sortable item wrapper
- Modify: `components/sets/set-card-manager.tsx`
  - Replace the static grid with `<DndContext>` + `<SortableContext>`
  - On drag end, compute the new ordered array and call the server action
  - Maintain optimistic state until the server confirms
- New action: `reorderSetCardsAction(setId: string, orderedItemIds: string[])`
  in `lib/sets/actions.ts`

## Implementation approach

- `@dnd-kit` is the modern accessible DnD lib — works for keyboard,
  touch, and pointer alike.
- Use a "position" column model: send the full ordered array of item ids
  on each drag end. The server zips it into a single UPDATE with a
  CASE expression (or batched updates) to set each row's `position` to
  its index in the array.
- Each sortable item shows a drag handle (Lucide `<GripVertical />`)
  visible on hover and always visible on touch.
- Optimistic update locally on drag-end; reconcile via `router.refresh`.
- If the server rejects (e.g. set isn't owned by the caller), roll back
  the optimistic state and toast the error.

## Acceptance criteria

- A user can grab the drag handle on a set card and drop it into a new
  slot.
- The order persists after refresh.
- Keyboard: Tab to handle, Space to lift, ↑/↓ to move, Space to drop.
- Touch: long-press to lift, drag to move.
- Reordering a set you don't own returns an error and no rows change.
- The set's `updated_at` is bumped on reorder.
- No flicker between optimistic and server-confirmed state.

## Dependencies

None.

## Estimated effort

~2.5 hours.

## Done when

Open a set with ≥3 cards, drag the third card to the first slot, refresh
— the order persists.
